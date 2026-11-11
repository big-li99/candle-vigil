// The intermission card table: three dark plates, a looping power-star icon above each name, one line of small
// text under it, and the auto-pick countdown. Text goes through painter.text on a painter fetched after the
// icons have placed theirs (CLAUDE.md rule 3). The rects are exported so the field can burst a collected card.
import { createFx, painterFor, hex } from "../../vendor/pixelfx/src/core/index.js";
import { get as getAsset } from "../assets.js";
import { W, H } from "../frame.js";
import { upgradeById, MAX_STACK } from "../systems/upgrades.js";

const CARD_W = 110;
const CARD_H = 100;
const CARD_Y = 56;
const GAP = 12;
const CARD_X0 = Math.floor((W - (CARD_W * 3 + GAP * 2)) / 2);

const C = {
  veil: hex("#05070d"),
  plate: hex("#0b1220"),
  plateTop: hex("#1b2c47"),
  edge: hex("#3d5a84"),
  edgeHot: hex("#9fe8ff"),
  text: hex("#dceaff"),
  dim: hex("#7f9cc4"),
  warm: hex("#ffcf7a"),
  key: hex("#05070d"),
  stack: hex("#46618a"),
};

/** The card rects, in screen pixels. */
export const CARD_RECTS = [0, 1, 2].map((i) => ({
  x: CARD_X0 + i * (CARD_W + GAP),
  y: CARD_Y,
  w: CARD_W,
  h: CARD_H,
}));

export function createCardOverlay() {
  let icons = [];

  function show(cards) {
    icons = cards.map((id, i) =>
      createFx(getAsset("pickups/power-star"), { x: CARD_RECTS[i].x + CARD_W / 2, y: CARD_RECTS[i].y + 58, seed: 3 + i }),
    );
  }

  function clear() {
    icons = [];
  }

  function update(dt) {
    for (const icon of icons) icon.update(dt);
  }

  function draw(frame, { cards, timer, stacks }) {
    if (!cards.length) return;
    let p = painterFor(frame);
    // dim only the play area: the candle/wave plate and the spell bar stay crisp and readable behind the cards
    p.rect(0, 36, W, H - 36 - 21, C.veil, 0.62);
    p.text("LEVEL UP - CHOOSE ONE", W / 2, 40, C.text, {
      font: "big",
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });

    for (let i = 0; i < cards.length; i++) {
      const r = CARD_RECTS[i];
      p.rect(r.x, r.y, r.w, r.h, C.plate, 0.97);
      p.rect(r.x, r.y, r.w, 1, C.plateTop);
      p.rect(r.x, r.y, 1, r.h, C.edge);
      p.rect(r.x + r.w - 1, r.y, 1, r.h, C.edge);
      p.rect(r.x, r.y + r.h - 1, r.w, 1, C.edge);
      p.rect(r.x + 1, r.y + 1, 8, 8, C.key, 0.92);
      p.text(String(i + 1), r.x + 4, r.y + 2, C.edgeHot, { font: "mini" });
    }

    // the star is an effect: drawn between the plates and the text, so a fresh painter is fetched after it
    for (const icon of icons) {
      icon.draw(frame, "back");
      icon.draw(frame, "front");
    }

    p = painterFor(frame);
    for (let i = 0; i < cards.length; i++) {
      const r = CARD_RECTS[i];
      const u = upgradeById(cards[i]);
      if (!u) continue;
      const cx = r.x + r.w / 2;
      p.text(u.name, cx, r.y + 64, C.text, { font: "big", align: "center" });
      p.text(u.desc, cx, r.y + 80, C.dim, { font: "mini", align: "center" });
      p.text(`STACK ${stacks?.[u.id] ?? 0}/${MAX_STACK}`, cx, r.y + 90, C.stack, { font: "mini", align: "center" });
    }

    p.text(`AUTO PICK IN ${Math.max(1, Math.ceil(timer))}`, W / 2, 166, C.warm, {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
  }

  return { show, clear, update, draw };
}
