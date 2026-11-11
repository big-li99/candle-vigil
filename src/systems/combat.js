// Every hit in the game goes through here — spells and enemy bites alike. One hit is one impact effect, one
// rising number, one flash, one shake and one global freeze. Shake, flash, numbers and the combo are updated
// even while the world is frozen, otherwise the hit-stop reads as a stutter (CLAUDE.md rule 6).
import { createFx, painterFor, hex } from "../../vendor/pixelfx/src/core/index.js";
import { get as getAsset } from "../assets.js";

export const HIT_FREEZE_MIN = 0.05;
export const HIT_FREEZE_MAX = 0.12; // a longer stop than this reads as a hang, not an impact
export const NUMBER_FILL = hex("#fff3a6");
const NUMBER_OUTLINE = hex("#05070d");
const NUMBER_LIFE = 0.6;
const NUMBER_RISE = 11; // world px over the number's life
const FLASH_TIME = 1 / 60; // exactly the hit frame
const COMBO_HOLD = 2; // seconds without a hit before the combo resets

export function createCombat({ renderer = null, stats = {} } = {}) {
  stats.hits ??= 0;
  stats.freezes ??= 0;
  stats.combo ??= 0;
  stats.bestCombo ??= 0;
  const shakeOf = renderer && typeof renderer.setShake === "function" ? renderer : { setShake() {} };

  const effects = [];
  const numbers = [];
  let boxes = [];
  let freeze = 0;
  let flashT = 0;
  let shakeT = 0;
  let shakeDur = 0;
  let shakeAmp = 0;
  let combo = 0;
  let comboT = 0;
  let seed = 0;
  let lastShake = "";

  /** A one-shot effect owned by combat (impact spark, death poof, pickup burst). */
  function effect(id, x, y, seedIn) {
    const mod = getAsset(id);
    if (!mod) return null;
    const inst = createFx(mod, { x, y, seed: seedIn || ++seed });
    effects.push(inst);
    return inst;
  }

  /**
   * Resolve one hit: damage the target, stop the world, shake the screen, flash white, spark, number, combo.
   * freeze/shake/amp come straight from actTiming(fx).hits; a bite passes none.
   *
   * `fxImpacts: false` is the one small switch for a hit that is not an impact (enemy bites): it still damages
   * the target and shakes the screen, but leaves no spark, number, white flash, freeze, hit stat or combo.
   */
  function hit({
    x = 0,
    y = 0,
    damage = 0,
    knock = 0,
    target = null,
    freeze: fz = 0,
    shake = 0,
    amp = 0,
    count = true,
    fxImpacts = true,
  } = {}) {
    target?.hurt?.(damage, knock);

    if (shake > 0) {
      shakeDur = shake;
      shakeT = shake;
      shakeAmp = Math.max(1, amp);
    }
    if (!fxImpacts) return; // a bite's feedback is the shake it just set, the candle flash and the flinch

    freeze = Math.max(freeze, Math.min(HIT_FREEZE_MAX, Math.max(HIT_FREEZE_MIN, fz)));
    stats.hits++;
    stats.freezes++;
    flashT = FLASH_TIME;
    effect("impacts/hit-spark", x, y);
    // the number starts above the impact so it never sits on top of the enemy's own hit flash
    numbers.push({ x, y: y - 12, damage, t: 0 });
    if (count) {
      combo++;
      comboT = COMBO_HOLD;
      stats.combo = combo;
      stats.bestCombo = Math.max(stats.bestCombo, combo);
    }
  }

  function applyShake() {
    let sx = 0;
    let sy = 0;
    if (shakeT > 0 && shakeDur > 0) {
      const k = shakeAmp * (shakeT / shakeDur);
      const f = Math.floor(shakeT * 60);
      sx = Math.round(Math.sin(f * 2.4) * k);
      sy = Math.round(Math.cos(f * 3.7) * k * 0.7);
    }
    const key = sx + "," + sy;
    if (key === lastShake) return;
    lastShake = key;
    shakeOf.setShake(sx, sy);
  }

  function update(dt, frozen = false) {
    freeze = Math.max(0, freeze - dt);
    if (flashT > 0) flashT = Math.max(0, flashT - dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
    if (comboT > 0) {
      comboT = Math.max(0, comboT - dt);
      if (comboT === 0) {
        combo = 0;
        stats.combo = 0;
      }
    }
    // numbers and the impact effects are part of the world's clock, except numbers, which keep rising:
    // a frozen number would look like a stuck UI, not like impact.
    for (const n of numbers) n.t += dt;
    for (let i = numbers.length - 1; i >= 0; i--) if (numbers[i].t >= NUMBER_LIFE) numbers.splice(i, 1);
    if (!frozen) {
      for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].update(dt);
        if (effects[i].done()) effects.splice(i, 1);
      }
    }
    applyShake();
  }

  /** Impact effects first, then the numbers, always with a painter fetched after the effects placed theirs. */
  function draw(frame) {
    for (const inst of effects) {
      inst.draw(frame, "back");
      inst.draw(frame, "front");
    }
    const p = painterFor(frame);
    boxes = [];
    for (const n of numbers) {
      const text = String(Math.round(n.damage));
      const [w, h] = p.measure(text, { font: "mini" });
      const left = Math.round(n.x - w / 2);
      const top = Math.round(n.y - NUMBER_RISE * (n.t / NUMBER_LIFE));
      p.text(text, left, top, NUMBER_FILL, { font: "mini", outline: NUMBER_OUTLINE });
      boxes.push({ x: left - 1, y: top - 1, w: w + 2, h: h + 2 });
    }
  }

  /** The one-frame white flash. Drawn last, over the HUD, so the whole frame pops (DESIGN §3.2). */
  function drawFlash(frame) {
    if (flashT <= 0) return;
    const p = painterFor(frame);
    p.rect(0, 0, frame.w, frame.h, hex("#ffffff"), 0.42);
  }

  return {
    hit,
    effect,
    update,
    draw,
    drawFlash,
    numberBoxes: () => boxes,
    effectCount: () => effects.length,
    get freeze() {
      return freeze;
    },
    get flash() {
      return flashT;
    },
    get shakeLeft() {
      return shakeT;
    },
    get combo() {
      return combo;
    },
  };
}
