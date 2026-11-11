// Architecture spike: many effects + an act + HUD text in ONE world frame, composited once per frame.
import { hex, createFrame, clearFrame, createFx, createAct, composite, backdrop, painterFor, drawActor, stockActor, actTiming, FONTS, clearFrame as cf } from "./src/core/index.js";
import * as slime from "./src/fx/critters/slime.js";
import * as ghost from "./src/fx/critters/ghost.js";
import * as skull from "./src/fx/critters/flying-skull.js";
import * as combo from "./src/fx/moves/sword-combo.js";
import * as nova from "./src/fx/ice/frost-nova.js";
import * as lightning from "./src/fx/lightning/lightning-strike.js";
import * as hitSpark from "./src/fx/impacts/hit-spark.js";
import * as poison from "./src/fx/nature/poison-cloud.js";

const W = 384, H = 216, GROUND = 176;
const canvas = document.getElementById("c");
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext("2d");
const frame = createFrame(W, H, 0, 0);
const img = ctx.createImageData(W, H);
const bg = backdrop("ground", W, H, GROUND);

// one cast: the sword combo, its own dummy target suppressed, feet at (64, GROUND)
const cast = createAct(combo, { x: 64, y: GROUND, seed: 3 });
const timing = actTiming(combo);
// enemies drawn in place, moved by the game
const mobs = [
  createFx(slime, { x: 250, y: GROUND, seed: 1 }),
  createFx(ghost, { x: 300, y: GROUND, seed: 2 }),
  createFx(skull, { x: 340, y: GROUND, seed: 4 }),
  createFx(poison, { x: 200, y: GROUND, seed: 5 }),
];
const impacts = [];
const STRESS = new URLSearchParams(location.search).has("stress");
if (STRESS) for (let i = 0; i < 16; i++) {
  const src = [slime, ghost, skull, poison][i % 4];
  mobs.push(createFx(src, { x: 60 + i * 19, y: GROUND - (i % 3) * 10, seed: 10 + i }));
}
const bigCast = STRESS ? createAct(nova, { x: 110, y: GROUND, seed: 9 }) : null;
if (bigCast) bigCast.update(0.4);
let t = 0, frames = 0, fpsAt = 0, fps = 0, hitFired = 0;

function loops(dt) {
  cast.update(dt);
  if (bigCast) bigCast.update(dt);
  for (const m of mobs) m.update(dt);
  for (const i of impacts) i.update(dt);
  if (hitFired === 0 && timing && cast.t >= timing.hits[0].t) {
    hitFired = 1;
    impacts.push(createFx(hitSpark, { x: 200, y: GROUND - 20, seed: 7 }));
  }
  if (cast.done() && !impacts.length) {
    // restage so the spike keeps running
    cast.t;
  }
  t += dt;
}

function draw() {
  clearFrame(frame);
  const p = painterFor(frame);
  // back layers first
  for (const m of mobs) m.draw(frame, "back");
  for (const i of impacts) i.draw(frame, "back");
  cast.draw(frame, { target: false });
  if (bigCast) bigCast.draw(frame, { target: false });            // caster + effect, no stock dummy
  for (const m of mobs) m.draw(frame, "front");
  for (const i of impacts) i.draw(frame, "front");
  // HUD text: a fresh painter, so the transform is identity (effects left it placed elsewhere)
  const tp = painterFor(frame);
  tp.text("WAVE 1/10", 8, 6, hex("#ffe9c1"), { font: "big" });
  tp.text("candle 84/100", 8, 16, hex("#9fe8ff"));
  tp.text("mana 62", 8, 24, hex("#8fa0ff"));
  // composite color + light once, over the backdrop
  composite(frame, img.data, bg);
  ctx.putImageData(img, 0, 0);
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  loops(dt); draw();
  frames++;
  if (now - fpsAt > 1000) { fps = frames * 1000 / (now - fpsAt); frames = 0; fpsAt = now; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- self report for automated checking
window.__report = null;
setTimeout(() => {
  const d = img.data;
  let lit = 0, glow = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 90) lit++; }
  for (let i = 0; i < frame.light.length; i++) if (frame.light[i]) glow++;
  const nonBg = (() => { let n = 0; const c = frame.color; for (let i = 0; i < c.length; i++) if (c[i] || frame.light[i]) n++; return n; })();
  window.__report = {
    fps: Math.round(fps), litPixels: lit, nonBgPixels: nonBg, glowPixels: glow,
    castT: +cast.t.toFixed(2), castFrozen: cast.frozen, castShake: cast.shake,
    windup: timing.windup, recovery: +timing.recovery.toFixed(2), hits: timing.hits.map(h => h.t),
    mobsDrawn: mobs.length, impacts: impacts.length,
    canvas: [canvas.width, canvas.height],
  };
}, 3000);
