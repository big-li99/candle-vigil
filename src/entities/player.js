// The night watch. He cannot walk: he stands at x=56 and performs. A cast is the effect's own act, and its
// damage fires on the act's hit windows (never on a hand-copied time). A bite during the wind-up cuts the
// performance short (no mana back, the cooldown still went); once the first hit has landed the act plays
// out, and one second of armor after an interrupt means a crowd can no longer lock him out of casting.
import {
  createAct,
  actTiming,
  painterFor,
  drawActor,
  stockActor,
  HERO2,
  DUMMY_PAL,
  hex,
} from "../../vendor/pixelfx/src/core/index.js";
import { SPELLS } from "../systems/spells.js";

export const PLAYER_X = 56;
export const PLAYER_Y = 196;
export const MANA_REGEN = 10; // per second; stops for the whole cast, resumes in recovery
export const INTERRUPT_ARMOR = 1.0; // after one interrupt the next bite cannot cut a cast for this long
const BITE_FLASH = 0.18; // the candle bar's red blink when a bite lands (HUD reads state.biteFlash)
const OUTLINE = hex("#050912");

export function createPlayer({ x = PLAYER_X, y = PLAYER_Y, state, combat, findTarget = null, stats = {} }) {
  // The acts are authored on the 2x actor (meta.actor = 2), so the idle body is that same character:
  // otherwise he would double in size the moment he starts casting.
  const body = stockActor(2);
  const cooldowns = SPELLS.map(() => 0);
  const timings = SPELLS.map((s) => actTiming(s.fx));

  let act = null;
  let spell = -1;
  let phase = "idle"; // idle | cast | recover
  let recoverT = 0;
  let nextHit = 0;
  let seed = 0;
  let reactT = 0; // the flinch after being bitten
  let armorT = 0; // grace period after an interrupt: bites still hurt, but cannot cancel
  let clock = 0;

  /** Start a spell. Refused while busy, in recovery, short of mana, or while that spell is cooling down. */
  function cast(index) {
    if (phase !== "idle") return false;
    const sp = SPELLS[index];
    if (!sp) return false;
    if (cooldowns[index] > 0) return false;
    if (state.mana < sp.cost) return false;
    state.mana -= sp.cost;
    cooldowns[index] = sp.cd;
    spell = index;
    nextHit = 0;
    act = createAct(sp.fx, { x, y, seed: ++seed });
    phase = "cast";
    return true;
  }

  /** The act is over (or was cut): its own tail is the recovery in which casts are refused. */
  function finishCast() {
    const t = timings[spell]?.recovery ?? 0;
    act = null;
    phase = t > 0 ? "recover" : "idle";
    recoverT = t;
  }

  /** Cut the performance short (Esc, or being bitten). No mana refund; the cooldown already started. */
  function cancel(reason = "cancel") {
    if (reason === "hurt") reactT = 0.22;
    if (phase !== "cast" || !act) return false;
    act.fx.stop();
    finishCast();
    return true;
  }

  /**
   * The candle is the only health pool. Every bite drains it and makes him flinch, but only a bite in the
   * wind-up (before the act's first hit window) cancels the performance, and never during armor.
   */
  function hurt(damage) {
    if (state.god) return;
    state.candle = Math.max(0, state.candle - damage);
    state.biteFlash = BITE_FLASH;
    reactT = 0.22; // the visible flinch and candle-bar blink happen on every bite, interrupt or not
    if (armorT > 0) return;
    if (phase !== "cast" || !act) return;
    const firstHit = timings[spell]?.hits?.[0]?.t ?? 0;
    if (act.t >= firstHit) return; // the first hit is out: this act must play to its end
    if (cancel("hurt")) {
      armorT = INTERRUPT_ARMOR;
      stats.interrupts = (stats.interrupts ?? 0) + 1;
    }
  }

  /**
   * Fire damage on the act's own hit windows, once each, on the frontmost enemy in reach. `strikes` is the
   * number of blows the spell lands inside one window (DESIGN §2.6's two sword cuts); they share the act's
   * single window and are resolved as one impact, so one cast still shows one number and one spark.
   */
  function resolveHits() {
    const sp = SPELLS[spell];
    const hits = timings[spell]?.hits ?? [];
    const damage = sp.damage * Math.max(1, sp.strikes ?? 1);
    while (nextHit < hits.length && act.t >= hits[nextHit].t) {
      const h = hits[nextHit++];
      const target = findTarget ? findTarget(sp) : null;
      if (!target) continue; // nothing in reach: the act's own dust and sparks are the miss feedback
      combat.hit({
        x: target.hitX,
        y: target.hitY,
        damage,
        knock: sp.knock,
        target,
        freeze: h.freeze,
        shake: h.shake,
        amp: h.amp,
      });
    }
  }

  function update(dt, frozen = false) {
    if (reactT > 0) reactT = Math.max(0, reactT - dt);
    if (!frozen) clock += dt;

    if (act) {
      // The act has its own hit-stop; it must keep ticking during it, or it would never thaw.
      if (!frozen || act.frozen) {
        act.update(dt);
        if (!frozen) resolveHits();
        if (act.done()) finishCast();
      }
    }

    if (frozen) return;
    armorT = Math.max(0, armorT - dt);
    for (let i = 0; i < cooldowns.length; i++) cooldowns[i] = Math.max(0, cooldowns[i] - dt);
    if (phase === "recover") {
      recoverT -= dt;
      if (recoverT <= 0) {
        recoverT = 0;
        phase = "idle";
      }
    }
    if (phase !== "cast") state.mana = Math.min(state.maxMana, state.mana + MANA_REGEN * dt);
  }

  function drawIdle(frame) {
    const p = painterFor(frame);
    const bob = reactT > 0 ? 0 : Math.floor(clock * 3) % 2;
    const jolt = reactT > 0 && Math.floor(clock * 60) % 2 ? 2 : 0; // the flinch: two frames of shake
    p.place(x + jolt, y - bob);
    p.ellipse(0, 0, 11, 2, OUTLINE, 0.55);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      p.sprite(HERO2, DUMMY_PAL, body.x + dx, body.y + dy, { tint: OUTLINE });
    }
    drawActor(p, body);
  }

  function draw(frame) {
    if (act) act.draw(frame, { target: false });
    else drawIdle(frame);
  }

  return {
    x,
    y,
    cast,
    cancel,
    hurt,
    update,
    draw,
    get casting() {
      return phase === "cast";
    },
    get phase() {
      return phase;
    },
    get act() {
      return act;
    },
    get cooldowns() {
      return cooldowns;
    },
    get armor() {
      return armorT;
    },
    get mana() {
      return state.mana;
    },
  };
}
