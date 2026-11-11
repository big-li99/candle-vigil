// HUD pass. Always take a FRESH painter right before this runs: effects leave the shared painter placed
// somewhere else, and text would otherwise inherit that transform.
import { painterFor, hex } from "../../vendor/pixelfx/src/core/index.js";
import { W, H } from "../frame.js";

const C = {
  plate: hex("#080d16"),
  plateEdge: hex("#24395b"),
  plateShade: hex("#0d1626"),
  text: hex("#dceaff"),
  textDim: hex("#9fb6d8"),
  warm: hex("#ffcf7a"),
  warmBar: hex("#ffb347"),
  warmEmpty: hex("#241a12"),
  mana: hex("#b9c8ff"),
  manaBar: hex("#6f8dff"),
  manaEmpty: hex("#131a2e"),
  slotEdge: hex("#2a4166"),
  slotSide: hex("#16243a"),
};

export function drawHud(frame, state) {
  const p = painterFor(frame);

  // --- top-left: wave + candle bar ------------------------------------------------
  const waveLabel = `WAVE ${state.wave}/10`;
  const waveW = p.measure(waveLabel, { font: "mini" })[0];
  const plateW = Math.max(132, waveW + 16);
  p.rect(6, 4, plateW, 30, C.plate, 0.94);
  p.rect(6, 4, plateW, 1, C.plateEdge);
  p.rect(6, 33, plateW, 1, C.plateShade);

  p.text(waveLabel, 12, 8, C.text, { font: "mini" });

  p.text("CANDLE", 12, 18, C.warm, { font: "mini" });
  const candleW = p.measure("CANDLE", { font: "mini" })[0];
  const barX = 12 + candleW + 5;
  const barW = Math.max(20, plateW - (barX - 6) - 24);
  const barY = 18;
  const barH = 5;
  p.rect(barX, barY, barW, barH, C.warmEmpty);
  const candleFill = Math.max(0, Math.min(1, state.candle / state.maxCandle));
  p.rect(barX, barY, Math.round(barW * candleFill), barH, C.warmBar);
  p.text(String(Math.round(state.candle)), 6 + plateW - 6, 18, C.warm, { font: "mini", align: "right" });

  // --- bottom row: four skill slots + mana, on the floor strip so they never cover the actors ---
  const slotW = 30;
  const slotH = 18;
  const gap = 4;
  const slotsX = 6;
  const slotsY = 196;
  for (let i = 0; i < 4; i++) {
    const x = slotsX + i * (slotW + gap);
    p.rect(x, slotsY, slotW, slotH, C.plate, 0.94);
    p.rect(x, slotsY, slotW, 1, C.slotEdge);
    p.rect(x, slotsY + slotH - 1, slotW, 1, C.plateShade);
    p.rect(x, slotsY, 1, slotH, C.slotSide);
    p.rect(x + slotW - 1, slotsY, 1, slotH, C.slotSide);
    const label = String(i + 1);
    const labelH = p.measure(label, { font: "big" })[1];
    p.text(label, x + slotW / 2, slotsY + Math.round((slotH - labelH) / 2), C.textDim, { font: "big", align: "center" });
  }

  // --- bottom-right: mana ---------------------------------------------------------
  const manaX = slotsX + 4 * slotW + 3 * gap + 4;
  const manaW = W - manaX - 6;
  const manaY = slotsY;
  const manaH = slotH;
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
