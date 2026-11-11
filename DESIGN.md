# 烛火守夜 · Candlelight Vigil
### 基于 pixelfx 的浏览器像素动作游戏 —— 设计文档 v0.1

> 素材库：https://patch-gg.github.io/pixelfx/ （MIT，244 个代码生成的像素特效 + 12 段成套招式 + 角色骨架）
> 引擎：无框架，纯 ESM + Canvas2D + esbuild 打包 · 内部分辨率 384×216 · 单人单机 · 12–18 分钟一局
> 开发方式：Claude Code 在宿主机上写码，我下指令、跑起来验、逐里程碑提交
>
> **已拍板（v0.2）**：方向 A《烛火守夜》 · 画风 **雪夜冷蓝** · 先在宿主机本地跑通，**最后推 GitHub Pages**

---

## 0. 一页速览

| 项 | 值 |
|---|---|
| 类型 | 横版守夜 / 施法节奏动作（single-screen defense） |
| 核心张力 | **你不能移动，但你的每个法术都要演 0.75–7 秒**，怪贴到脸就会打断你 |
| 目标 | 守住烛火 10 波，见到夜尽 |
| 操作 | `1–4` 施法 · `空格` 格挡 · `Esc` 中断咏唱 · 鼠标/触屏也留一套 |
| 一局时长 | 通关 12–15 分钟；失败一局 3–6 分钟 |
| 内容量 | 6 个法术 · 4 种杂兵 + 1 个 Boss · 10 波 · 10 张升级卡 |
| 技术栈 | ESM + Canvas2D + esbuild，无框架，~1500 行 |
| 工作量 | 4 个里程碑，Claude 侧约 5–7 小时机时 |

---

## 1. 素材能力盘点（设计的地基，已实测）

### 1.1 库给的东西（已经跑通验证）

- 每个特效是一个 JS 文件，`createFx(mod, {x,y,flip,seed,palette})` 出一个实例，`update(dt)` / `draw(frame,"back"|"front")` / `done()`。
- **61 个特效带"表演"（act）**：起手、命中、收招、命中定格（hitstop）、震屏、目标被击退/上色，全是纯数据：
  ```js
  actTiming(mod) => { windup, recovery, hits:[{t, freeze, shake, amp, push, skin}], poses }
  ```
  这意味着**伤害判定点不用手调**，直接读 `hits[].t` 对齐动画帧。
- **12 段成套招式**（`moves/*`）：用 `createAct(mod,{x,y})` 播，角色会自己前冲、挥砍、命中目标。`draw(frame,{target:false})` 可以关掉它自带的假人靶，只留施法者与特效。
- 12 只 `critters/*`（史莱姆、幽灵、眼球、火焰骷髅…）是循环动画，可以当敌人，靠改 `x/y` 移动。
- `ui/*`（伤害数字、连击、升级）、`pickups/*`（余烬拾取）、`transitions/*`（转场）、`impacts/*`（打击）齐全。
- 内置两套像素字体（mini 3×5 / big 5×7），可直接往帧缓冲里写字做 HUD。
- 帧模型：`{color, light}` 双缓冲，`composite(frame, rgba, backdrop)` 一次合成 —— 亮部是加色发光，所以火看起来"烫"。

### 1.2 库不给我们、必须靠设计绕开的东西

| 缺什么 | 影响 | 设计上的对策 |
|---|---|---|
| **没有走路循环**（角色只有站姿和招式姿态） | 做不了自由移动的动作游戏 | 玩家就是**不能移动**的守夜人，这是核心设定而非妥协 |
| 字体只有英文字形 | HUD 打不出中文 | HUD 全英文（CANDLE / MANA / WAVE），中文只出现在标题页与文档 |
| 特效不能缩放 | 做不了"大 Boss 小怪"的体积差 | Boss 靠**血量条 + 特效叠加 + 数量**表达威胁 |
| 特效画布可能比屏幕大（最宽 480） | 部分招式会被裁边 | 只选 ≤384 宽的法术；边缘裁切在黑底上不可见 |
| 状态类特效（燃烧/冰冻）是画在**默认假人**身上 | 贴着我们的敌人用不了 | 敌人上状态用"减速/持续伤害数值 + 颜色闪"表达，不用 status/* 的贴皮 |

### 1.3 已实测（我跑的通，不是估的）

在容器里起了一个 384×216 的单帧缓冲原型，同一帧里画 1 个 act + 20 个循环特效 + 命中特效 + 三行 HUD 文字：

- WebGL 之外纯 JS 合成：**59–60 fps**（20 特效同屏），合成 83k 像素/帧毫无压力；
- `createAct(..., {target:false})` 确实只出施法者，没有多余假人；
- 踩到 3 个坑，已写进技术约束（见 §3.5）。

---

## 2. 玩法设计

### 2.1 一句话 & 情绪目标

> 你是烛火旁不能离开的守夜人。你唯一会的事，是让黑暗里的东西**在光里烧起来**。
> 情绪曲线：安静的黑 → 一只怪 → 手忙脚乱 → 一次巨大的雷击把整排东西抹掉（爽）→ 油尽灯枯的一波 → 天亮了。

### 2.2 核心循环（30 秒一个节拍）

```
怪从右侧出现 → 你判断"用哪一招、现在放吗" → 施法开始（表演 0.75～7 秒）
   ├─ 怪走到 x<64 → 打断你的咏唱 + 咬烛火
   ├─ 你提前收手（Esc，损失蓝）→ 换快招
   └─ 命中 → 定格 + 震屏 + 伤害数字 + 连击
→ 清完一波 → 烛火回一点 → 3 选 1 升级 → 下一波更狠
```

### 2.3 屏幕布局（384×216）

```
┌──────────────────────────────────────────────┐
│ WAVE 3/10        ❤ 烛火 78/100               │  ← HUD，深色底板
│                  ▓▓▓▓▓▓▓▓░░░  余烬 12        │
│                                              │
│                       ﹏ 飞行怪（y-24）        │
│   [玩家]  ═══════════ 地面战线 ═══════════════│
│  x=56,y=196                                  │
│   烛火 x=24                                  │
│ [1剑斩][2锤击][3冰霜][4闪电]   MANA ▓▓▓░░    │  ← 技能槽 + 法力
└──────────────────────────────────────────────┘
```

- 地面线 `y=196`，敌人从 `x=384` 向**守夜人身前**走，速度 18–55 px/s。
- 玩家固定 `x=56, y=196`；敌人走到 `x=124`（警戒线）停住开始啃咬（烛火 −3 / 0.6s），后面来的按 34px 间距排队 —— **不许叠在同一个点上**（M1 实测：6 只叠在一点会把玩家整个人吞掉）。
- 烛火 `x=24`，是唯一血池。
- 同屏敌人上限 8（实测 20 个就糊，见风险 R2）。

### 2.4 操作

| 键 | 作用 |
|---|---|
| `1 2 3 4` | 施放对应法术（有蓝 + 冷却好了才能按） |
| `空格` | 格挡：0.35 秒窗口，挡掉一次伤害且**不打断咏唱**（高手用它在长咏唱中途扛一下） |
| `Esc` | 中断咏唱：立刻收招，蓝不退，该技能 CD 照走（防止无脑取消） |
| `P` / 点击 | 暂停 |

设计说明：**没有移动键**。所有操作都是"什么时候该贪、什么时候该收"。

### 2.5 施法 = 表演（把 act 数据变成玩法）

每个法术绑定一个 pixelfx 特效，时长/起手/命中/收招全部来自它的 act：

```js
const spec = { fx: hammerSmash, cost: 22, cd: 3, dmg: 26, knock: 20 };
// 施放：
const perform = createAct(spec.fx, { x: PLAYER.x, y: PLAYER.y, seed: ++seed });
// 每帧：perform.update(dt)；perform 的内部冻结会自动生效（perform.frozen）
// 伤害：t 跨过 actTiming(spec.fx).hits[i].t 的那一帧结算
```

三条规则：

1. **起手会被打断，出手不会**：只有 `act.t < 第一段命中时刻` 时被咬才 `fx.stop()`（蓝不退、CD 照走）；一旦第一段打出去，这一招就会演完。打断后 **1.0 秒免打断**（怪照样咬烛火），否则一群怪贴身 = 永远放不出招（M1 实测的死锁）。
2. **长咏唱自己会定格**（库的 hitstop 会冻结一切）：命中那一下整个世界停 0.05–0.2 秒，玩家能"感觉到"伤害。
3. **收招期间不能施放下一招**（`actTiming().recovery`），所以连招要靠 CD 与法力错开，不是狂按。

### 2.6 法术表（6 个，带 4 个上场）

| 槽 | 法术 | pixelfx 特效 | 时长 | 法力 | CD | 效果 |
|---|---|---|---|---|---|---|
| 1 | 剑斩 | `melee/sword-slash` (0.75s) | 0.75s | 10 | 0.6s | 两段命中 × 15（共 30），**正好一发秒一只史莱姆**；唯一能救火的小招 |
| 2 | 锤击 | `melee/hammer-smash` (2s) | 2s | 22 | 3s | 单体 26 伤 + 击退 20px（把贴脸的怪锤回队列尾） |
| 3 | 冰霜新星 | `ice/frost-nova` (3.4s) | 3.4s | 34 | 8s | 全场 30 伤 + 减速 50% / 3s（清成群，长咏唱最危险） |
| 4 | 闪电打击 | `lightning/lightning-strike` (3s) | 3s | 30 | 6s | 单体 60 伤，打最前一只（劈 BOSS 与厚皮） |
| 5 | 蚀骨毒云 | `nature/poison-cloud` (loop) | 持续 5s | 26 | 7s | 在地面 x=220 铺一片，20 伤/秒（幽灵免疫） |
| 6 | 圣愈 | `holy/heal` | 2s | 40 | 12s | 烛火 +18（不输出，纯粹的取舍） |

- **六个槽全开（1–6）**，没有解锁：法力与冷却本身就是取舍，多一个解锁系统只会让前 4 波更空。升级卡只改数值与行为，不换招。
- 命中判定：以施法者 `x` 为原点，单体取战线最前目标；AoE 取全场。

### 2.7 敌人表

| 敌人 | pixelfx | 速度 | HP | 行为 | 掉落 |
|---|---|---|---|---|---|
| 史莱姆 | `critters/slime` | 18 px/s | 30 | 直走，咬烛火 3 / 0.6s | 1 余烬 |
| 幽灵 | `critters/ghost` | 30 | 20 | 直走，**免疫毒云** | 1 |
| 火焰骷髅 | `critters/flying-skull` | 55 | 20 | 悬浮 `y-24`，冲得最快，起手阶段优先打断咏唱 | 2 |
| 眼球 | `critters/eyeball` | 22 | 50 | 厚皮，慢，一次咬 12 | 3 |
| 骨焰之主（Boss） | `critters/flying-skull` ×2 + `fire/fire-breath` | 12 | 200 | 每 6 秒喷一次扇形（伤害 15），血量 50% 时召唤 3 史莱姆 | — |

死亡表现：`spawn/poof`（小怪）/ `spawn/disintegrate`（眼球）/ `explosions/small-explosion`（Boss）+ `pickups/collect-burst` 掉余烬。

### 2.8 波次与难度曲线（10 波，约 13 分钟）

| 波 | 构成 | 新东西 |
|---|---|---|
| 1 | 史莱姆 ×5 | 教学：剑斩与打断 |
| 2 | 史莱姆 ×6 + 幽灵 ×2 | 幽灵免疫毒云（第 4 波才有毒云，留伏笔） |
| 3 | 幽灵 ×4 + 骷髅 ×3 | 骷髅快、会打断 |
| 4 | 眼球 ×1 + 史莱姆 ×6 | 厚皮 + 解锁毒云 |
| **5** | **Boss** | 血条、扇形喷火、召唤 |
| 6 | 骷髅 ×5 + 眼球 ×1 | 压缩施法窗口 |
| 7 | 幽灵 ×4 + 眼球 ×2 | 解锁圣愈：开始有"修灯"的压力 |
| 8 | 全类型 ×12（分两批） | 同屏上限考验 |
| 9 | 眼球 ×3 + 骷髅 ×4 | 纯硬仗 |
| **10** | **Boss ×1 + 全类型** | 终局 |

波间隔 6 秒，15 秒内点完升级卡，否则自动选第一张。

### 2.9 升级（每波后 3 选 1，共 10 张）

专注（施法速度 +20%）· 法力涌动（回蓝 +4/s）· 锋刃（剑斩 +30%）· 大地之怒（锤击击退翻倍 + 眩晕 1s）· 凛冬（减速延长 2s）· 雷暴（闪电 CD −2s）· 蚀骨（毒云范围 +40%、持续 +2s）· 圣火（治疗 +50% 且回 5 蓝）· 余烬护符（烛火上限 +25 并回满）· 疾风（格挡窗口 +0.15s，挡成功回 8 蓝）

卡面用 `painter.text` + 一个 `pickups/power-star` 图标，选中时放 `pickups/collect-burst`。

### 2.10 失败 / 通关 / 记录

- 烛火归零：`transitions/iris` 收拢 → 结算（到达波次、击杀、最高连击）→ 重开。
- 通过第 10 波：`ui/level-up` + 天色转亮 → "夜尽" 结局字幕。
- `localStorage` 存最高波次与最短通关时间。

### 2.11 打击感配方（这一层决定"是不是像个游戏"）

| 层 | 实现 | 来源 |
|---|---|---|
| 命中定格 | 全局冻结 `hits.stop` 秒（世界不更新，震屏与白闪继续） | act 数据 |
| 震屏 | `amp` 像素抖动，`shake` 秒衰减；整幅画面偏移 | `perform.shake` |
| 白闪 | 命中那一帧把 color 缓冲整片刷白，下一帧恢复 | 自写 3 行 |
| 敌闪 | 敌人被击中 0.08 秒叠白/描边 | 自写 |
| 伤害数字 | `painter.text` 数字上浮（真数值）；大暴击再补一个 `impacts/crit-hit` | 字体 + 特效 |
| 连击 | 3 连以上弹 `ui/combo-counter`（x5 那张），位置在右上 | 特效 |
| 击杀 | `spawn/poof` + 余烬飞向 HUD + 音高递增的"叮" | 特效 + WebAudio |
| 音效 | 全部 WebAudio 合成（方波/噪声包络），无音频文件 | 自写 ~80 行 |

---

## 3. 技术设计

### 3.1 栈与目录

```
candle-vigil/
├── index.html                 # 一个 canvas + 居中缩放样式
├── package.json               # esbuild 打包 / serve / 三条脚本
├── vendor/pixelfx/            # 从 patch-gg/pixelfx 复制的 src/core + 用到的 ~14 个 fx
│   └── VENDORED.md            # 记录来源 commit（可复现，不跟库升级）
├── src/
│   ├── main.js                # 启动、主循环、缩放、暂停
│   ├── frame.js               # 384×216 世界缓冲 + composite + 屏幕震动偏移
│   ├── input.js               # 键盘 + 触屏 → 意图
│   ├── game.js                # 状态机：title / wave / upgrade / gameover / ending
│   ├── entities/enemy.js      # 敌人：移动、受击、死亡、掉落
│   ├── entities/player.js     # 站桩施法者：施法中/收招/格挡
│   ├── systems/spells.js      # 6 个法术的数据 + act 伤害窗口结算
│   ├── systems/combat.js      # 定格、震屏、白闪、伤害数字、连击
│   ├── systems/waves.js       # 波次表、生成器、Boss 阶段
│   ├── systems/upgrades.js    # 升级卡池与选取
│   ├── ui/hud.js              # 烛火条、法力、技能槽、波次
│   ├── audio.js               # WebAudio 合成音
│   └── debug.js               # window.__game 测试钩子、?autotest=1
└── dist/                      # esbuild 产物（git 忽略）
```

### 3.2 一帧的渲染顺序（顺序就是层级，pixelfx 没有 z-index）

```
1  clearFrame(世界缓冲)
2  backdrop("sky", 384, 216, 196) 铺底（雪夜：夜空渐变 + 星点；地面改冷蓝）
   + weather/snow.js 循环飘雪（画在最前层之下，低亮度）
3  环境：烛火（fire/candle 循环，暖光在冷色场上唯一的暖源）、墙火（fire/torch ×2）
4  地面特效：毒云等（draw "back"）
5  敌人（按 y 再按 x 排序，后面的先画）
6  玩家（施法中由 act 画；站立时 drawActor + 呼吸 3fps）
7  特效 front 层 + 命中特效
8  HUD：新取一个 painter 写文字与条
9  全屏转场 / 白闪
10 composite(frame, img.data, backdropArray) → putImageData → CSS 整数倍放大
```

- 内部 384×216，CSS `image-rendering: pixelated`，按窗口取**整数倍**（3× = 1152×648，5× = 1920×1080），余量做黑边。
- 固定步长 1/60 更新（累加器，最多补 4 帧），渲染跟随 rAF。

### 3.3 时间与冻结

```js
// 世界只在自己 unfrozen 时前进；act 内部冻结不阻止震屏与白闪
const frozen = combat.freeze > 0 || player.act?.frozen;
if (!frozen) { enemies.update(dt); player.update(dt); castTimers(dt); }
combat.update(dt); // 震屏/白闪永远走
```

### 3.4 关键接口（给 Claude 的契约）

```js
// spells.js
export const SPELLS = [{ id:"slash", fx: swordSlash, cost:10, cd:0.6, damage:12,
  kind:"single" /* single | aoe | zone | heal */, onHit(hit){} }, ...];

// player.js
player.cast(spell) -> boolean        // 蓝不够/CD/收招中 → false
player.cancel()                      // Esc
player.update(dt)                    // 读 act.t，跨过 hits[].t 时触发命中
// 命中结算：const hits = actTiming(spell.fx).hits

// combat.js
combat.hit({x, y, damage, knock})    // 定格/震屏/白闪/数字/连击/音效一条龙
combat.freeze, combat.shakeXY

// debug.js（自动化验收用，必须实现）
window.__game = {
  snapshot(),                 // {wave, candle, mana, enemies:[{type,hp,x}], casting, fps}
  spawn(type, n=1), cast(i), setWave(n), skipUpgrade(), god(true),
  pause(), stats: {fps, hits, kills, freezes}
};
// ?autotest=1 跑 60 秒脚本化对局，结束写 window.__report 与 <body data-autotest="pass|fail">
```

### 3.5 已踩到的 3 个坑（都要写进 CLAUDE.md）

1. **颜色必须过 `hex()` / `rgb()`**。库的颜色是 ARGB，裸写 `0xffe9c1` 的 alpha 是 0，`composite()` 之后**整段文字完全不可见**（我踩了，查了 20 分钟）。
2. **同一个 frame 只有一个 painter 实例**，`painterFor(frame)` 每次都 `reset()` 并改变换。HUD 必须在所有特效绘制完之后**重新取一次** painter 再写字，否则文字会跟着最后一个特效的坐标跑。
3. **`createAct().draw(frame, {target:false})`** 才能关掉招式自带的假人靶；伤害时点一律用 `actTiming(mod).hits[].t`，别手抄数字。

另外：单个特效画布可能比 384 宽，选法术时看 `meta.size`，超出的接受边缘裁切。

### 3.6 性能预算（实测基线）

- 合成：83k 像素/帧，20 个特效同时画 **59–60 fps**（容器内 Chromium）。
- 预算：同屏敌人 ≤ 8，同屏 act ≤ 2，循环特效 ≤ 6；粒子上限靠减少实例而非改库。

### 3.7 自动化验收（我会真跑，不看自述）

里程碑每完成一次，我这边执行：

1. 宿主机 `npm run build` + 静态服务；
2. 容器里用浏览器打开 `http://<host>:8788/?autotest=1`，读 `window.__report`
   （fps、击杀数、命中数、烛火曲线、console 错误数）；
3. 截图目视：角色/敌人/特效/HUD 是否都在、有没有黑屏或叠成糊；
4. `git diff` 逐文件看一遍再提交。

---

## 4. 素材映射清单（14 个文件）

| 用途 | id |
|---|---|
| 大招/招式 | `melee/sword-slash` `melee/hammer-smash` `ice/frost-nova` `lightning/lightning-strike` `nature/poison-cloud` `holy/heal` |
| 敌人 | `critters/slime` `critters/ghost` `critters/eyeball` `critters/flying-skull` |
| 命中/死亡 | `impacts/hit-spark` `impacts/crit-hit` `impacts/hit-flash` `impacts/shield-block` `spawn/poof` `spawn/disintegrate` `explosions/small-explosion` |
| 拾取/UI | `pickups/collect-burst` `pickups/power-star` `ui/combo-counter` `ui/level-up` |
| 环境/转场 | `fire/candle` `fire/torch` `fire/fire-breath` `transitions/iris` |

共 24 个，只 vendor 这些 + `src/core/`（体积可控，约 400KB 源码）。

---

## 5. 开发计划（Claude 执行，我验收）

| 里程碑 | 内容 | 验收（真跑） | 预估 |
|---|---|---|---|
| **M0 骨架** | 仓库、vendor、esbuild、世界缓冲与缩放、输入、背景、`?fx=` 特效试玩页、`__game` 钩子 | 60fps；`?fx=sword-slash` 能循环播放任意特效；0 console 错误 | 0.5–1h |
| **M1 手感** | 玩家站桩施法（剑斩/锤击）、1 种敌人、命中定格/震屏/白闪/伤害数字、烛火血量、被打断 | 按住 1 能打死怪；被打断时有明确反馈；定格可感知；截图目视正常 | 1–2h |
| **M2 完整** | 6 法术、4 敌种、10 波、Boss、升级卡、HUD、三态流程 | `?autotest=1` 60 秒跑完：击杀>0、无异常、波次推进；手动通到第 5 波 | 2–3h |
| **M3 打磨** | 音效、转场、连击、结算/存档、平衡、README、标题页 | 通关 10 波（或用 debug 跳到第 10 波）跑完结局；三档难度自测表 | 1–2h |

每期的指令方式（宿主机 `~/.local/bin/claude`）：

```
claude -p "$(cat tasks/M1.md)" --permission-mode acceptEdits \
  --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm *)" --max-turns 60 \
  --output-format json
```

- 每期一个 `tasks/M_n.md`，写清验收标准与"不确定就输出 `CONFLICT: 原因` 并停下"。
- 每期结束我跑 build + 浏览器验收 + `git diff` review，再 `git commit`（分支 `feat/m0`…，`main` 只放可跑的合并点）。
- 新特效不自己发明：需要时把 `pixelfx` 的 skill 装进 `~/.claude/skills/`（仓库里已有 `skills/pixelfx`），让它按库的质量标准做。

---

## 6. 验收标准（Definition of Done）

**必须全过：**

- [ ] 60 fps ±3（384×216，8 敌 + 2 act 同屏），无一帧超过 33ms 的卡顿
- [ ] 0 console error / warning
- [ ] 6 个法术都能施放、有蓝耗、有 CD、伤害窗口与动画对齐（用 `hits[].t` 抽帧核对）
- [ ] 被打断、格挡、取消三条路径都有明确特效与音效反馈
- [ ] 10 波可通（允许用 debug 跳波加速验证），Boss 有血条与两个阶段
- [ ] 升级卡 10 张全部可生效（用 `__game` 断言数值变化）
- [ ] 失败与通关两条结局都能走到，`localStorage` 记录正确
- [ ] `npm run build` 产物 < 1.5MB，直开 `index.html` 可玩（file:// 除外）
- [ ] README 有：怎么跑、按键表、素材来源与 MIT 声明

**不做（这一版明确砍掉）：** 移动端适配、存档云同步、多角色、无尽模式、音乐（只有音效）、中文本地化 HUD。

---

## 7. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| **长咏唱=罚站，不好玩** | 中 | M1 先只做两个快招验证手感；如果 10 分钟内不好玩，把冰霜/闪电改成"瞬发+长 CD"，法术表跟着调（数据都在 `spells.js` 一处） |
| 同屏糊成一团（已实测 20 特效会糊） | 高 | 敌上限 8、玩家加暗色描边、HUD 加深色底板、命中粒子只留一份 |
| 库升级破坏接口 | 低 | vendor 固定 commit，不跟升级；需要新特效再单独拷 |
| 招式特效被屏幕裁边 | 中 | 只选 ≤384 宽的法术；裁边处事先在 `?fx=` 里看过 |
| 数值不平衡 | 高 | `?autotest=1` 跑"挂机/正常/全开"三组模拟，看每波烛火曲线再调 |
| 音效吵到人 | 低 | 默认音量 0.35，`M` 静音，记忆到 localStorage |

---

## 8. 备选方案（如果不想走 A）

| 方案 | 一句话 | 优点 | 缺点 | 工作量 |
|---|---|---|---|---|
| **A 烛火守夜（推荐）** | 不能移动的法师守一支蜡烛 | 完全贴库的能力面；长短咏唱的取舍是原创玩法；内容密度高 | 站桩，可能不够"动作" | 5–7h |
| B 拼刀决斗 | 1v1 读招→格挡→反击 | 只做 1 个场景，30 分钟能出原型；act 的起手数据天然适合"读招" | 内容少，5 分钟腻 | 1.5–2h |
| C 自动战斗挂机 | 双方自动放招，你只看 | 展示效果最爽，几乎零平衡 | 不是游戏，是播放器 | 1h |
| D 塔防 | 沿路放法术塔 | 用得上 projectile 全家 | 操作偏放置，和"表演"张力弱 | 4h |

---

## 9. 已拍板的决定（v0.2）

1. **方向**：A 烛火守夜
2. **画风**：雪夜冷蓝 —— 夜空渐变 `backdrop("sky")` + 冷蓝地面 + `weather/snow.js` 飘雪；暖色只留给烛火与火焰类法术（冷暖对比就是"光"的意义）
3. **交付**：先宿主机本地跑通；全部里程碑完成后打 `dist/` 静态包推 GitHub Pages

**Pages 的现实约束**（现在说清，免得到时卡住）：宿主机没有 `gh` CLI，也没有你的 GitHub 凭据。所以最后一步只有两种走法：

- **A**：你把仓库建好，给我一个远端地址 + 一个有 `repo` 权限的 token（写进宿主机环境变量，不落 git 配置），我来推 `gh-pages` 分支；
- **B**：我把 `dist/` 和 `gh-pages` 分支准备好，并在 README 里写好三条命令，你在自己机器上 `git push`。

两种都能到 Pages，B 更省事也更安全，我默认按 B 准备，你到时一句话切换。

**素材合规**：代码与特效 MIT，页面底部固定一行 `effects by pixelfx (MIT) · built with Claude Code`；不改 vendored 源码。

---

## 10. 变更记录

- v0.2（2026-11-11）：定方向/画风/交付；渲染顺序加飘雪层；补 Pages 约束与素材声明
- v0.1（2026-11-11）：首版，含 384×216 单帧缓冲实测数据与三个坑

---

*文档 v0.1 · 2026-11-11 · 素材：pixelfx (MIT, patch.gg) · 设计与实现：Claude Code + Hermes 验收*
