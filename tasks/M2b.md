# M2b — 波次循环 + 三选一升级 + 格挡（BOSS 留给 M2c）

基线 `main` 已含 6 法术 / 4 敌人。本里程碑把"一局游戏"的骨架搭起来：波次表、波间隔、升级卡、格挡。
**不做 BOSS、不做结局、不做存档**（M2c）。

## 1. 波次表（`src/systems/waves.js`，数据驱动）

按 `DESIGN.md` §2.8 十条波次写死成数组，字段自定，但每波要能表达"出什么、出几只、间隔多少"：

| 波 | 内容 | 出怪间隔 |
|---|---|---|
| 1 | slime ×5 | 2.6s |
| 2 | slime ×6, ghost ×2 | 2.4s |
| 3 | ghost ×4, skull ×3 | 1.8s |
| 4 | eyeball ×1, slime ×6 | 3.0s |
| 5 | **精英波占位**：eyeball ×2, skull ×4 | 2.2s（M2c 换成 BOSS）|
| 6 | skull ×5, eyeball ×1 | 1.6s |
| 7 | ghost ×4, eyeball ×2 | 2.4s |
| 8 | 混编 12 只（slime/ghost/skull 各 4，分两批） | 1.4s |
| 9 | eyeball ×3, skull ×4 | 1.8s |
| 10 | **终局占位**：eyeball ×3, skull ×6 | 1.4s（M2c 换成 BOSS + 混编）|

规则：
- 同屏活体上限 6（第 8 波放宽到 8），满了就等，不要挤爆屏幕。
- 清空条件：该波队列全部出完 **且** 场上无活敌。
- 波间 6 秒喘息：烛火 +8（不超上限），弹出 3 张升级卡，`1/2/3` 选，`Enter` 取第一张，倒数结束自动取第一张。
- 波次推进时用 `transitions/*` 里任一全屏转场做一次 0.6–1s 的过渡（不要用 iris，那是 M3 的结局用）。

## 2. 升级卡（`src/systems/upgrades.js`）

十张，效果必须真的作用到数值上（能被 `__game.snapshot()` 查出来）：

| id | 卡面 | 效果 |
|---|---|---|
| focus | FOCUS | 所有法术 CD ×0.8 |
| flow | MANA FLOW | 回蓝 +4/s |
| edge | SHARP EDGE | 剑斩伤害 +30% |
| quake | EARTH WRATH | 锤击击退 ×2，命中附加 1s 眩晕 |
| winter | WINTER | 减速时长 +2s |
| storm | STORM | 闪电 CD −2s |
| bone | BONE EATER | 毒云半径 +40%、持续 +2s |
| sacred | SACRED FIRE | 治疗 +50%，并回 5 法力 |
| charm | EMBER CHARM | 烛火上限 +25 并回满 |
| swift | SWIFT | 格挡窗口 +0.15s，格挡成功回 8 法力 |

- 三张不重复；同一张可以重复出现（取两次叠加到上限，别无限叠）。
- 卡面用 `painter.text` 画名字 + 一行小字说明，配 `pickups/power-star` 图标；选中时放 `pickups/collect-burst`。

## 3. 格挡（`Space`）

- 按下即开始 0.35s 窗口（升级后 0.5s），冷却 1.2s，期间不能施法但**可以**在被咬时生效。
- 成功格挡：`impacts/shield-block` 在身前，烛火不掉、咏唱不被打断、+8 法力（仅升级后）。
- 空放：没有惩罚，只是进冷却（免得玩家囤）。
- 格挡不做"完美弹反"——M3 再说。

## 4. 快照与自动化（必须扩）

`__game.snapshot()` 增加：`waveState: "spawning"|"intermission"|"over"`、`cards: ["focus","edge","flow"]`（仅 waveState 为 intermission 时有内容）、`block: {active, cd}`、`mods`（当前加成的扁平 key→value）。
`__game.pickCard(i)` / `__game.skipUpgrade()` 要能真的选卡；`__game.setWave(n)` 跳到第 n 波开头（给自动化用）。

## 验收（我真浏览器逐条跑）

- [ ] 第一波出 5 只史莱姆，间隔 ~2.6s；清完自动进波间，出现 3 张卡
- [ ] 按 1 选卡后卡消失、下一波开始，且该卡效果能在 `mods` 与实测数值上看到（例：focus 后剑斩 CD 变短）
- [ ] 连续推进到第 4 波，HUD 的 `WAVE n/10` 同步；同屏活体不超过 6
- [ ] 第 8 波同屏能到 8 只且 60fps
- [ ] `Space` 在怪咬下来的瞬间按下：烛火不掉、角色不被打断、出现护盾特效；冷却 1.2s 内再按无效
- [ ] 波间 6s 不选卡会自动选第一张
- [ ] `?autotest=1` pass，并新增断言：波次推进、卡生效、格挡挡下一次伤害
- [ ] 0 console error，fps ≈ 60

## 规则

- 分支 `feat/m2b`，commit `m2b: waves, upgrades, block`。
- 不动 `vendor/`，不加依赖，不做 BOSS/结局/存档/音效。
- 数值以 `DESIGN.md` 为准；要改先 `CONFLICT: <原因>`。
