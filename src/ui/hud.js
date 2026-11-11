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
  slotCoolEdge: hex("#111a29"), // cooling down: the border goes dark
  slotCoolSide: hex("#0b111c"),
  dangerEdge: hex("#ff6a5a"), // not enough mana: the border goes red
  dangerSide: hex("#7a2a24"),
  keyPlate: hex("#05070d"),
  wipe: hex("#05070d"),
  plateBase: hex("#060a12"),
  bossPlate: hex("#0e0a08"),
  bossEdge: hex("#a8541a"),
  bossEmpty: hex("#2a1508"),
  bossFill: hex("#ff8a2a"),
  bossText: hex("#ffcf7a"),
};

const BOSS_BAR_W = 180; // the M2c brief's width
const BOSS_BAR_H = 12;
const BOSS_BAR_Y = 36; // just under the top-left plate, so it cannot cover the wave / candle readout

const MARGIN = 6;
const SLOT_H = 18;
const GAP = 3;
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

/**
 * The boss's health: a 180 px dark plate dead centre at the top, an orange fill and the word BOSS. It is drawn
 * only while a boss is alive, and a fresh painter is not needed because it is called from the HUD pass.
 */
function drawBossBar(p, boss) {
  const x = Math.round((W - BOSS_BAR_W) / 2);
  const y = BOSS_BAR_Y;
  const max = Math.max(1, boss.max ?? 1);
  const fill = Math.max(0, Math.min(1, (boss.hp ?? 0) / max));
  clearLight(p, x, y, BOSS_BAR_W, BOSS_BAR_H);
  p.rect(x, y, BOSS_BAR_W, BOSS_BAR_H, C.bossPlate, 0.94);
  p.rect(x, y, BOSS_BAR_W, 1, C.bossEdge);
  p.rect(x, y + BOSS_BAR_H - 1, BOSS_BAR_W, 1, C.bossEmpty);
  p.text("BOSS", x + 4, y + 2, C.bossText, { font: "mini", outline: C.plate });
  p.text(`${Math.ceil(boss.hp ?? 0)}/${max}`, x + BOSS_BAR_W - 4, y + 2, C.bossText, {
    font: "mini",
    align: "right",
    outline: C.plate,
  });
  const barX = x + 4;
  const barY = y + 8;
  const barW = BOSS_BAR_W - 8;
  p.rect(barX, barY, barW, 3, C.bossEmpty);
  p.rect(barX, barY, Math.round(barW * fill), 3, C.bossFill);
}

export function drawHud(frame, state, run = {}) {
  const spells = run.spells ?? SPELLS;
  const cooldowns = run.cooldowns ?? [];
  const cdMax = run.cdMax ?? [];
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

  // --- top-centre: the boss bar, only while a boss is alive --------------------------
  if (run.boss) drawBossBar(p, run.boss);

  // --- bottom row: six slots + mana, on one dark plate --------------------------------
  // Six slots always exist (no unlock system). The widths are laid out from the mana panel's measured label,
  // so the whole row fits 384 px without the icons shrinking below their 40 px thumbnail.
  const n = spells.length;
  const manaWanted = Math.max(74, p.measure(`MANA ${state.maxMana}`, { font: "mini" })[0] + 8);
  const slotW = Math.max(
    40,
    Math.min(46, Math.floor((W - MARGIN * 2 - GAP - manaWanted - GAP * (n - 1)) / Math.max(1, n))),
  );
  const slotsW = n * slotW + Math.max(0, n - 1) * GAP;
  const manaX = MARGIN + slotsW + GAP;
  const manaW = W - manaX - MARGIN;

  clearLight(p, 0, SLOTS_Y - 1, W, H - (SLOTS_Y - 1));
  p.rect(0, SLOTS_Y - 1, W, H - (SLOTS_Y - 1), C.plateBase, 0.96);
  p.rect(0, SLOTS_Y - 1, W, 1, C.plateEdge);

  for (let i = 0; i < n; i++) {
    const x = MARGIN + i * (slotW + GAP);
    const y = SLOTS_Y;
    const spell = spells[i];
    const cd = cooldowns[i] ?? 0;
    // "why can't I press it": cooling down = a dark rim, short of mana = a red rim
    const cooling = cd > 0;
    const lowMana = !!spell && state.mana < spell.cost;
    const edge = cooling ? C.slotCoolEdge : lowMana ? C.dangerEdge : C.slotEdge;
    const side = cooling ? C.slotCoolSide : lowMana ? C.dangerSide : C.slotSide;

    p.rect(x, y, slotW, SLOT_H, C.plate, 0.96);
    p.rect(x, y, slotW, 1, edge);
    p.rect(x, y + SLOT_H - 1, slotW, 1, edge);
    p.rect(x, y, 1, SLOT_H, side);
    p.rect(x + slotW - 1, y, 1, SLOT_H, side);

    if (spell) {
      const thumbX = x + Math.floor((slotW - THUMB_W) / 2);
      blit(p, thumbFor(spell), THUMB_W, THUMB_H, thumbX, y + 1);
      // cooldown wipe: a dark curtain over the icon that shrinks away as the spell comes back
      const full = cdMax[i] ?? spell.cd;
      if (cooling && full > 0) {
        const h = Math.round(THUMB_H * Math.max(0, Math.min(1, cd / full)));
        if (h > 0) p.rect(thumbX, y + 1, THUMB_W, h, C.wipe, 0.78);
      }
    }

    // the key number on a dark chip, so it reads over the icon (drawn after the wipe, always legible)
    p.rect(x + 1, y + 1, 8, 8, C.keyPlate, 0.9);
    p.text(String(i + 1), x + 4, y + 2, spell ? C.text : C.textDim, { font: "mini" });
  }

  // --- bottom-right: mana -----------------------------------------------------------
  const manaY = SLOTS_Y;
  const manaH = SLOT_H;
  p.rect(manaX, manaY, manaW, manaH, C.plate, 0.96);
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
