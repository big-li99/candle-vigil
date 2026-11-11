// Every hit in the game goes through here — spells and enemy bites alike. One hit is one impact effect, one
// rising number, one flash, one shake and one global freeze. Shake, flash, numbers and the combo are updated
// even while the world is frozen, otherwise the hit-stop reads as a stutter (CLAUDE.md rule 6).
import { createFx, painterFor, hex } from "../../vendor/pixelfx/src/core/index.js";
import { get as getAsset } from "../assets.js";

export const HIT_FREEZE_MIN = 0.05;
export const HIT_FREEZE_MAX = 0.08; // an ordinary hit's stop; longer reads as a hang, not an impact
export const HIT_FREEZE_HEAVY = 0.14; // hammer, lightning and a killing blow: the M3 ceiling
export const SHAKE_MAX = 0.2; // no impact shake may outlast this (M3 brief)
export const MAX_ONE_SHOTS = 12; // concurrent poofs/sparks/bursts; loops (the poison cloud) are exempt
export const NUMBER_FILL = hex("#fff3a6");
const NUMBER_OUTLINE = hex("#05070d");
const NUMBER_LIFE = 0.6;
const NUMBER_RISE = 11; // world px over the number's life
const MAX_NUMBERS = 4; // concurrent rising numbers; past this, a hit only sparks (M2a brief)
const FLASH_TIME = 1 / 60; // exactly the hit frame
const COMBO_HOLD = 2; // seconds without a hit before the combo resets

export function createCombat({ renderer = null, stats = {} } = {}) {
  stats.hits ??= 0;
  stats.freezes ??= 0;
  stats.combo ??= 0;
  stats.bestCombo ??= 0;
  stats.numbersShown ??= 0;
  stats.numbersCapped ??= 0;
  stats.maxNumbers ??= 0;
  stats.lastFreeze ??= 0;
  stats.lastShakeDur ??= 0;
  stats.lastShakeAmp ??= 0;
  const shakeOf = renderer && typeof renderer.setShake === "function" ? renderer : { setShake() {} };

  const effects = []; // { inst, layer }; layer "back" is drawn under the enemies (poison cloud)
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

  /**
   * A one-shot or looping effect owned by combat (impact spark, death poof, pickup burst, poison cloud).
   * `layer: "back"` means it is drawn before the enemies (ground effects); the default is the impact layer,
   * drawn over them with the numbers.
   */
  function effect(id, x, y, seedIn, { layer = "front" } = {}) {
    const mod = getAsset(id);
    if (!mod) return null;
    const inst = createFx(mod, { x, y, seed: seedIn || ++seed });
    effects.push({ inst, layer, loop: !!mod.meta?.loop });
    // Long fights used to accumulate every poof and collect burst still on screen: ~40 live one-shots is
    // the difference between 60 fps and 38. Loops (the poison cloud) are never evicted.
    let oneShots = 0;
    for (const e of effects) if (!e.loop) oneShots++;
    for (let i = 0; oneShots > MAX_ONE_SHOTS && i < effects.length; ) {
      if (effects[i].loop) { i++; continue; }
      effects.splice(i, 1);
      oneShots--;
    }
    return inst;
  }

  /**
   * Resolve one hit: damage the target, stop the world, shake the screen, flash white, spark, number, combo.
   * freeze/shake/amp come straight from actTiming(fx).hits; a bite passes none.
   *
   * `fxImpacts: false` is the one small switch for a hit that is not an impact (enemy bites): it still damages
   * the target and shakes the screen, but leaves no spark, number, white flash, freeze, hit stat or combo.
   * `screen: false` keeps the spark and the number but skips the global freeze and white flash — the extra
   * targets of an AoE, and every poison tick, must not each stop the world.
   *
   * `heavy: true` (hammer, lightning) uses the 0.14 s freeze ceiling and a 2 px shake; everything else is an
   * ordinary 0.05–0.08 s stop at 1 px. The act's own numbers remain the source; this only keeps them inside the
   * feel budget the M3 brief measured.
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
    screen = true,
    heavy = false,
  } = {}) {
    target?.hurt?.(damage, knock);

    if (shake > 0) {
      shakeDur = Math.min(SHAKE_MAX, shake);
      shakeT = shakeDur;
      shakeAmp = Math.max(1, Math.min(heavy ? 2 : 1, Math.round(amp) || 1));
      stats.lastShakeDur = Math.round(shakeDur * 1000) / 1000;
      stats.lastShakeAmp = shakeAmp;
    }
    if (!fxImpacts) return; // a bite's feedback is the shake it just set, the candle flash and the flinch

    if (screen) {
      const cap = heavy ? HIT_FREEZE_HEAVY : HIT_FREEZE_MAX;
      freeze = Math.max(freeze, Math.min(cap, Math.max(HIT_FREEZE_MIN, fz)));
      stats.lastFreeze = Math.round(freeze * 1000) / 1000;
      stats.freezes++;
      flashT = FLASH_TIME;
    }
    stats.hits++;
    effect("impacts/hit-spark", x, y);
    // the number starts above the impact so it never sits on top of the enemy's own hit flash.
    // No more than four at once: a fifth simultaneous hit keeps its spark but does not add to the mush.
    if (numbers.length < MAX_NUMBERS) {
      numbers.push({ x, y: y - 12, damage, t: 0 });
      stats.numbersShown++;
      stats.maxNumbers = Math.max(stats.maxNumbers, numbers.length);
    } else {
      stats.numbersCapped++;
    }
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

  /** A pure screen shake, for events that are not a damage hit (the boss breath landing, the boss death). */
  function shake(seconds = 0.2, amp = 2) {
    if (seconds <= 0) return;
    shakeDur = Math.min(SHAKE_MAX, seconds);
    shakeT = shakeDur;
    shakeAmp = Math.max(1, Math.min(3, Math.round(amp) || 1));
    stats.lastShakeDur = Math.round(shakeDur * 1000) / 1000;
    stats.lastShakeAmp = shakeAmp;
  }

  /** A complete run restart: no leftover impact, number, freeze, shake or combo. */
  function reset() {
    effects.length = 0;
    numbers.length = 0;
    boxes = [];
    freeze = 0;
    flashT = 0;
    shakeT = 0;
    shakeDur = 0;
    shakeAmp = 0;
    combo = 0;
    comboT = 0;
    stats.combo = 0;
    stats.bestCombo = 0;
    applyShake();
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
        effects[i].inst.update(dt);
        if (effects[i].inst.done()) effects.splice(i, 1);
      }
    }
    applyShake();
  }

  /** Effects on one layer, each in both of its own sub-layers. */
  function drawEffects(frame, layer) {
    for (const e of effects) {
      if (e.layer !== layer) continue;
      e.inst.draw(frame, "back");
      e.inst.draw(frame, "front");
    }
  }

  /** Ground effects (the poison cloud) go under the enemies; call this before they are drawn. */
  function drawBack(frame) {
    drawEffects(frame, "back");
  }

  /** Impact effects first, then the numbers, always with a painter fetched after the effects placed theirs. */
  function draw(frame) {
    drawEffects(frame, "front");
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
    shake,
    reset,
    update,
    draw,
    drawBack,
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
