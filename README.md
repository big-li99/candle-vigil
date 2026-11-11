# Candlelight Vigil · 烛火守夜

A single-screen pixel action game where **you cannot move**. You are the night watch: the candle behind you is the
only life you have, and every spell you know takes 0.75–7 seconds to perform. Cast at the wrong moment and the dark
interrupts you.

Every visual is code — 24 effects from [pixelfx](https://github.com/patch-gg/pixelfx) (MIT), drawn into one
384×216 framebuffer with `color` + additive `light` buffers, composited once per frame. No sprite sheets, no images.

## Play

```bash
npm install       # esbuild only
npm run dev       # http://0.0.0.0:8788
npm run build     # dist/game.js (minified, ~200 KB)
```

Open the URL, press any key. Snow night, ten waves, two bosses, three upgrades per wave.

### Controls

| Key | Action |
|---|---|
| `1` | Sword slash — two cuts of 15, the panic button |
| `2` | Hammer smash — 26 + knockback |
| `3` | Frost nova — 30 to everything on screen, slow |
| `4` | Lightning strike — 60 to the frontmost enemy, any distance |
| `5` | Poison cloud — a 5 s zone at x=220, ghosts are immune |
| `6` | Holy heal — +18 candle |
| `Space` | Block — 0.35 s window, stops a bite or a boss breath without breaking your cast |
| `Esc` | Cut your own cast short (mana is gone, cooldown stays) |
| `P` | Pause |
| `M` | Mute |

The rules that make it a game: being bitten during the **wind-up** interrupts the spell (once it has struck, it always
finishes); enemies queue at the guard line instead of stacking; the candle is your only health bar.

## Design

`DESIGN.md` holds the whole design: why a stationary protagonist, the effect-to-spell mapping with durations and hit
windows, the wave table, the hit-stop recipe, the render order, and what was measured in the browser
(60 fps with 20 concurrent effects in one 384×216 buffer).

## Layout

```
index.html            one canvas
src/frame.js          world frame, backdrop, integer scaling, screen shake
src/main.js           fixed 1/60 step + rAF
src/entities/         player (stationary caster), enemies, boss
src/systems/          spells (data + act hit windows), combat (hit-stop/shake/numbers), waves, upgrades
src/ui/hud.js         candle, mana, six slots, boss bar
src/debug.js          window.__game hooks, ?fx=<id> playground, ?autotest=1
vendor/pixelfx/       pinned copy of the library (read-only, see VENDORED.md)
tasks/                the milestone briefs the game was built from
```

Verification is scripted: `?autotest=1` runs a session and writes `window.__report` (fps, console errors, pixel
counts, kills, blocks) plus `<body data-autotest="pass">`.

## Credits

- Effects and character rig: [pixelfx](https://github.com/patch-gg/pixelfx) by [Patch](https://patch.gg), MIT.
  Parts of pixelfx adapt Hugo Duprez's open-source VFX (MIT) and Hollow Crown's source (MIT); see
  `vendor/pixelfx/NOTICE.md`.
- Code of this game: MIT, see `LICENSE`.
- Built with Claude Code, verified in a real browser.

## 中文速览

不能移动的守夜人，用六个法术守住身后的烛火，撑过 10 波。`1–6` 施法、`空格` 格挡、`Esc` 中断、`P` 暂停、`M` 静音。
起手被打断、出手必打完；怪会排队而不是叠成一坨。整份设计与实测数据见 `DESIGN.md`。
