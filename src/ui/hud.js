// HUD pass. Always take a FRESH painter right before this runs: effects leave the shared painter placed
// somewhere else, and text would otherwise inherit that transform.
//
// Slots 1–2 show a thumbnail of the spell itself, rendered once from its own effect into a small frame and
// then downsampled. No image files, no hand-drawn icons: the HUD icon is the spell.
import { createFrame, createFx, clearFrame, painterFor, hex } from "../../vendor/pixelfx/src/core/index.js";
import { W, H } from "../frame.js";
import { SPELLS } from "../systems/spells.js";

const C = {
  plate: hex("#080d16"),
  plateEdge: hex("#24395b"),
  plateShade: hex("#0d1626"),
  text: hex("#dceaff"),
  textDim: hex("#9fb6d8"),
  warm: hex("#ffcf7a"),
  warmBar: hex("#ffb347"),
  warmEmpty: hex("#241a12"),
  danger: hex("#ff6a5a"),
  dangerBar: hex("#ff4a3d"),
  mana: hex("#b9c8ff"),
  manaBar: hex("#6f8dff"),
  manaEmpty: hex("#131a2e"),
  slotEdge: hex("#2a4166"),
  slotSide: hex("#16243a"),
  keyPlate: hex("#05070d"),
  wipe: hex("#05070d"),
};

const SLOT_W = 42;
const SLOT_H = 18;
const GAP = 4;
const SLOTS_X = 6;
const SLOTS_Y = 196;
const THUMB_W = 40;
const THUMB_H = 16;
const DOWN = 3; // the thumbnail is the effect at 1:1, sampled every 3rd pixel on both axes

const thumbs = new Map();

/** Render a spell's effect at thumbT into a 120x48 frame and keep the brightest pixel of each 3x3 block. */
function thumbnail(spell) {
  const src = createFrame(THUMB_W * DOWN, THUMB_H * DOWN);
  clearFrame(src);
  const [fx, fy] = spell.thumbFocus ?? [0, 0];
  const inst = createFx(spell.fx, {
    x: (THUMB_W * DOWN) / 2 - fx,
    y: (THUMB_H * DOWN) / 2 - fy,
    seed: 2,
  });
  const step = 1 / 60;
  const n = Math.max(1, Math.round((spell.thumbT ?? 0.1) / step));
  for (let i = 0; i < n; i++) inst.update(step);
  inst.draw(src, "back");
  inst.draw(src, "front");

  const out = new Uint32Array(THUMB_W * THUMB_H);
  for (let y = 0; y < THUMB_H; y++) {
    for (let x = 0; x < THUMB_W; x++) {
      let best = 0;
      let bestW = -1;
      for (let j = 0; j < DOWN; j++) {
        for (let i = 0; i < DOWN; i++) {
          const sx = x * DOWN + i;
          const sy = y * DOWN + j;
          const c = src.color[sy * src.w + sx];
          const l = src.light[sy * src.w + sx] & 0xffffff;
          // paint wins over glow; inside either, the brightest sample wins, so thin lines survive
          const wgt = c ? 4096 + (c >>> 24) : l ? (l & 255) + ((l >>> 8) & 255) + ((l >>> 16) & 255) : -1;
          if (wgt > bestW) {
            bestW = wgt;
            best = c || (l ? (255 << 24) | l : 0);
          }
        }
      }
      out[y * THUMB_W + x] = best;
    }
  }
  return out;
}

function thumbFor(spell) {
  let t = thumbs.get(spell.id);
  if (!t) thumbs.set(spell.id, (t = thumbnail(spell)));
  return t;
}

function blit(p, arr, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = arr[y * w + x];
      if (c) p.put(dx + x, dy + y, c, 1);
    }
  }
}

/** The light buffer is composited additively over everything, HUD included: punch it out under a plate. */
function clearLight(p, x, y, w, h) {
  const x1 = Math.max(0, x);
  const y1 = Math.max(0, y);
  const x2 = Math.min(p.w, x + w);
  const y2 = Math.min(p.h, y + h);
  for (let yy = y1; yy < y2; yy++) for (let xx = x1; xx < x2; xx++) p.L[yy * p.w + xx] = 0;
}

export function drawHud(frame, state, run = {}) {
  const spells = run.spells ?? SPELLS;
  const cooldowns = run.cooldowns ?? [];
  const p = painterFor(frame);

  // --- top-left: wave + embers, and the candle -------------------------------------
  const waveLabel = `WAVE ${state.wave}/10`;
  const emberLabel = `EMBER ${state.embers ?? 0}`;
  const waveW = p.measure(waveLabel, { font: "mini" })[0];
  const emberW = p.measure(emberLabel, { font: "mini" })[0];
  const plateW = Math.max(150, waveW + emberW + 28);
  clearLight(p, 6, 4, plateW, 30);
  p.rect(6, 4, plateW, 30, C.plate, 0.94);
  p.rect(6, 4, plateW, 1, C.plateEdge);
  p.rect(6, 33, plateW, 1, C.plateShade);

  p.text(waveLabel, 12, 8, C.text, { font: "mini" });
  p.text(emberLabel, 6 + plateW - 6, 8, C.warm, { font: "mini", align: "right" });

  const low = state.candle < 30;
  // a bite makes the bar blink red for a moment; that is the "you were bitten but not interrupted" cue
  const bitten = (state.biteFlash ?? 0) > 0;
  p.text("CANDLE", 12, 18, bitten || low ? C.danger : C.warm, { font: "mini" });
  const candleW = p.measure("CANDLE", { font: "mini" })[0];
  const barX = 12 + candleW + 5;
  const barW = Math.max(20, plateW - (barX - 6) - 26);
  const barY = 18;
  const barH = 5;
  if (bitten) p.rect(barX - 1, barY - 1, barW + 2, barH + 2, C.dangerBar);
  p.rect(barX, barY, barW, barH, C.warmEmpty);
  const candleFill = Math.max(0, Math.min(1, state.candle / state.maxCandle));
  p.rect(barX, barY, Math.round(barW * candleFill), barH, bitten || low ? C.dangerBar : C.warmBar);
  p.text(String(Math.round(state.candle)), 6 + plateW - 6, 18, bitten || low ? C.danger : C.warm, { font: "mini", align: "right" });

  // --- bottom row: four slots (1–2 bound) + mana, on the floor strip -----------------
  clearLight(p, 0, SLOTS_Y, W, H - SLOTS_Y);
  for (let i = 0; i < 4; i++) {
    const x = SLOTS_X + i * (SLOT_W + GAP);
    const y = SLOTS_Y;
    p.rect(x, y, SLOT_W, SLOT_H, C.plate, 0.94);
    p.rect(x, y, SLOT_W, 1, C.slotEdge);
    p.rect(x, y + SLOT_H - 1, SLOT_W, 1, C.plateShade);
    p.rect(x, y, 1, SLOT_H, C.slotSide);
    p.rect(x + SLOT_W - 1, y, 1, SLOT_H, C.slotSide);

    const spell = spells[i];
    if (spell) {
      blit(p, thumbFor(spell), THUMB_W, THUMB_H, x + 1, y + 1);
      // cooldown wipe: a dark curtain over the icon that shrinks away as the spell comes back
      const cd = cooldowns[i] ?? 0;
      if (cd > 0 && spell.cd > 0) {
        const h = Math.round(THUMB_H * Math.max(0, Math.min(1, cd / spell.cd)));
        if (h > 0) p.rect(x + 1, y + 1, THUMB_W, h, C.wipe, 0.78);
      }
    }

    // the key number on a dark chip, so it reads over the icon
    p.rect(x + 1, y + 1, 8, 8, C.keyPlate, 0.9);
    p.text(String(i + 1), x + 5, y + 2, spell ? C.text : C.textDim, { font: "mini" });
  }

  // --- bottom-right: mana -----------------------------------------------------------
  const manaX = SLOTS_X + 4 * SLOT_W + 3 * GAP + 4;
  const manaW = W - manaX - 6;
  const manaY = SLOTS_Y;
  const manaH = SLOT_H;
  p.rect(manaX, manaY, manaW, manaH, C.plate, 0.94);
  p.rect(manaX, manaY, manaW, 1, C.slotEdge);
  p.rect(manaX, manaY + manaH - 1, manaW, 1, C.plateShade);

  p.text(`MANA ${Math.round(state.mana)}`, manaX + 4, manaY + 3, C.mana, { font: "mini" });
  const manaBarX = manaX + 4;
  const manaBarY = manaY + 10;
  const manaBarW = manaW - 8;
  p.rect(manaBarX, manaBarY, manaBarW, 4, C.manaEmpty);
  const manaFill = Math.max(0, Math.min(1, state.mana / state.maxMana));
  p.rect(manaBarX, manaBarY, Math.round(manaBarW * manaFill), 4, C.manaBar);
}
