# CLAUDE.md — candle-vigil（烛火守夜）

A single-screen pixel action game built on **pixelfx** (MIT, patch-gg/pixelfx): every visual is code, no image files.
Design document: `DESIGN.md` — read it before touching code. Direction A, art = 雪夜冷蓝 (cold blue snow night),
delivery = local host now, static bundle to GitHub Pages at the end.

## Commands

```bash
npm run dev     # esbuild watch + static server on http://0.0.0.0:8788 (serves repo root)
npm run build   # bundle to dist/game.js (minified)
```

There is no test runner. Verification is done in a browser through the hooks below — keep them working at all times.

## Hard technical rules (each one has already cost time)

1. **World buffer is 384×216**, one `createFrame(384, 216)`, composited exactly once per frame with
   `composite(frame, img.data, backdropArray)`, then `putImageData` to the canvas and CSS-scaled by an **integer**
   factor (`image-rendering: pixelated`). Never draw with `ctx.drawImage`/`fillRect` for game art.
2. **Colors must go through `hex("#rrggbb")` or `rgb(r,g,b)`.** A bare `0xffe9c1` has alpha 0; `composite()` treats it
   as fully transparent over the backdrop and the pixels vanish with no error.
3. **One painter per frame.** `painterFor(frame)` returns a cached instance and resets its transform; every effect's
   `draw()` then calls `place(x, y)`. So fetch a **fresh** `painterFor(frame)` immediately before drawing HUD/labels.
4. **Acts own the character.** `createAct(mod, {x, y}).draw(frame, {target: false})` renders caster + effect without the
   demo dummy. While an act plays, do not draw the player yourself.
5. **Timing is data.** Damage windows, hit-stop, shake, knockback come from `actTiming(mod)` →
   `{ windup, recovery, hits:[{t, freeze, shake, amp, push}] }`. Never copy those numbers into the game by hand.
6. **Freeze is global.** When an act is frozen (`act.frozen` or a hit-stop timer), enemies and timers stop too;
   screen shake, white flash and the HUD keep updating, or the hit-stop reads as a stutter.
7. **Vendored code is read-only.** `vendor/pixelfx/` is a copy of the library at the commit in
   `vendor/VENDORED.md`. Never edit it; wrap or extend behaviour in `src/`. No new dependencies besides esbuild.
8. **Readability beats density.** On-screen enemies ≤ 8, one impact effect per hit, player drawn last with a dark
   outline, HUD on a dark plate. 20 effects on one screen is mush (measured).

## Verification hooks (do not remove)

`src/debug.js` exposes, on `window`:

```js
__game = { snapshot(), spawn(type, n), cast(i), setWave(n), skipUpgrade(), god(on), pause(), stats }
__report   // written ~2.5 s after load: { fps, consoleErrors, entities, scene, canvas, pixels }
```

`?fx=<category>/<name>` plays a single effect looped in isolation for eyeballing an asset.
`?autotest=1` runs a scripted session and must end with `<body data-autotest="pass">` or `"fail"` plus a reason.
Every milestone is accepted by reading `__report` in a real browser plus a screenshot — not by the report of what
was written. Keep the hooks honest: they must report real numbers.

## Git

- `main` is the default and always runs. Work on `feat/m0`, `feat/m1`, … branches, commit there.
- Commit messages: `m0: <what>`. One milestone per branch; do not mix milestones in a commit.
- Never commit `node_modules/`, `dist/` (dist is rebuilt for Pages), `*.log`, `tasks/*.json`.

## When unsure

If a mechanic is ambiguous or two implementations are plausible, output `CONFLICT: <reason>` and stop without
committing. Do not guess silently.
