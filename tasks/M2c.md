# M2c — BOSS、失败与通关、存档（一局游戏要能结束）

基线：`main` 已含 10 波、升级卡、格挡。现在要做的是"这一局怎么结束"：第 5/10 波换成 BOSS，烛火归零有结算，
第 10 波清完有通关，最高纪录写进 `localStorage`。**不做音效、不做发布**（M3）。

## 1. BOSS「骨焰之主」（第 5 波与第 10 波）

- 新敌人类型 `boss`：`critters/flying-skull` 作本体 + HP **200**，速度 12px/s，走到警戒线（124）停下。
- 本体上方画血条（HUD 顶部居中，宽 180px，暗色底 + 橙色填充 + `BOSS` 小字），只在 BOSS 活着时显示。
- **每 6 秒一次吐息**：1.5 秒前摇（`fire/fire-breath` 在头前循环、越来越亮 → 这就是"读招"），然后：
  - 玩家这 1.5 秒内按 `Space` 格挡成功（窗口命中在吐息落地那一刻）→ 烛火不掉、放 `impacts/shield-block`、BOSS 被反震 6px；
  - 没挡住 → 烛火 **−15**、0.3s 震屏、`impacts/hit-flash` 打在玩家身上。**不打断正在进行的吟唱**（BOSS 的招是惩罚不是锁死）。
- **血量 ≤ 50%** 时召唤 3 只 slime（只触发一次），播放一次 `lightning/thunderclap` 或 `explosions/plasma-explosion` 作提示。
- 死亡：`explosions/small-explosion` + 0.5s 白闪 + 全屏震屏 + 掉 10 余烬。
- 第 5 波只出 BOSS；第 10 波 = BOSS + 之前那批混编（先 BOSS，20 秒后开始出小怪）。

## 2. 失败（烛火 0）

- 立刻停止刷怪与敌人行动，`transitions/iris` 收拢（0.8s 内播完，可以加速），保持 0.5s，再放大回来。
- 结算页：`WAVE n/10`、`SLAIN xx`、`BEST COMBO xx`、`TIME mm:ss`、`PRESS ANY KEY`。
- 任意键 → 完整重开第 1 波：敌人清空、升级修饰清零、烛火/法力回满、连击清零。**不要只重置一半**。

## 3. 通关（第 10 波清完）

- `ui/level-up`（在玩家脚下）+ 全屏 0.6s 白闪 + 背景往亮里推一档（`backdrop` 换成更亮的 sky 或叠一层冷蓝渐变）。
- 结局页：`NIGHT ENDS`、`TIME mm:ss`、`SLAIN xx`、`BEST COMBO xx`、`PRESS ANY KEY` → 回标题。
- 标题页显示 `BEST WAVE x/10` 与 `BEST TIME mm:ss`（`localStorage`，键名 `candle-vigil:best`，存 `{wave,time}`）。

## 4. 快照与自动化

`__game.snapshot()` 增加：`boss: {hp, max, telegraph}` 或 `null`、`state: "playing"|"over"|"ending"`、`best: {wave,time}`。
新增 `__game.damageCandle(n)`（自动化用，直接扣血走正常失败流程）、`__game.killAll()`。

## 验收（我真浏览器逐条跑）

- [ ] `__game.setWave(5)` 后 BOSS 出现并有血条；打它掉血；50% 时召唤 3 只 slime（只触发一次）
- [ ] 吐息前摇可见（火舌），不格挡 → 烛火 −15；格挡 → 烛火不掉且出现护盾特效
- [ ] `__game.damageCandle(100)` → iris 收拢 → 结算页 → 任意键完整重开（烛火 100、法力 100、无敌人、mods 清空）
- [ ] 走完全部 10 波（或 `setWave(10)` 打完 BOSS + 小怪）→ 结局页；回标题后 `BEST WAVE 10`
- [ ] `localStorage['candle-vigil:best']` 里有 `{wave:10,time:...}`
- [ ] BOSS + 6 小怪同屏：60fps、0 console error、画面不糊（截图目视）
- [ ] `?autotest=1` pass，新增断言：BOSS 出现/掉血/召唤、失败流程、结局流程、重开后状态干净

## 规则

- 分支 `feat/m2c`，commit `m2c: boss, run end states, best record`。
- 不动 `vendor/`，不加依赖，不做音效/发布。
- 数值照 `DESIGN.md` §2.7/§2.8；要改先 `CONFLICT: <原因>`。
