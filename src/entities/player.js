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
export const BLOCK_WINDOW = 0.35; // DESIGN §2.4: the block is a short timed window, not a hold
export const BLOCK_CD = 1.2; // an empty block only costs this cooldown
const BITE_FLASH = 0.18; // the candle bar's red blink when a bite lands (HUD reads state.biteFlash)
const OUTLINE = hex("#050912");
const GUARD = hex("#9fe8ff");

export function createPlayer({
  x = PLAYER_X,
  y = PLAYER_Y,
  state,
  combat,
  mods = {}, // the live upgrade numbers (src/systems/upgrades.js); never copied, always read
  findTarget = null, // the frontmost single target for this spell (reach is the spell's business)
  findTargets = null, // every living target for an AoE
  onCast = null, // field hook for spells with no act (the poison zone)
  onBlock = null, // field hook for a successful block (shield effect, stats)
  audio = null, // the M3 synth palette; optional and never a dependency
  stats = {},
}) {
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
  let castSeq = 0; // bumped on every accepted cast; a skull watches this to rush an interrupt
  let reactT = 0; // the flinch after being bitten
  let armorT = 0; // grace period after an interrupt: bites still hurt, but cannot cancel
  let clock = 0;
  let blockT = 0; // seconds left of the current block window (0 = not guarding)
  let blockCd = 0; // seconds until Space can start another window
  let blockMax = BLOCK_WINDOW; // this window's length, for drawing the guard telegraph

  /** The cooldown one cast of spell i would start, after focus and storm. */
  function cooldownOf(sp) {
    const cut = sp.id === "bolt" ? mods.boltCdCut ?? 0 : 0;
    return Math.max(0.1, sp.cd * (mods.cdMult ?? 1) - cut);
  }

  /** Start a spell. Refused while busy, in recovery, short of mana, cooling down, or guarding. */
  function cast(index) {
    if (phase !== "idle") return false;
    if (blockT > 0) return false; // DESIGN §2.4: the block window refuses casts (it can still eat a bite)
    const sp = SPELLS[index];
    if (!sp) return false;
    if (cooldowns[index] > 0) return false;
    if (state.mana < sp.cost) return false;
    state.mana -= sp.cost;
    cooldowns[index] = cooldownOf(sp);
    spell = index;
    nextHit = 0;
    castSeq++;
    // Six spells, six voices (M3 brief). The instant spells speak now; the ones with a long performance speak
    // on their own hit window in resolveHits(), so the sound lands with the picture rather than with the keypress.
    if (sp.id === "slash" || sp.id === "poison" || sp.id === "heal") audio?.sfx(sp.id);

    if (sp.kind === "zone") {
      // A loop effect has no act to perform; the brief gives it a 0.3 s recovery instead. The field owns the
      // cloud's lifetime and ticks (see game.js), so the cast is complete the moment it is placed.
      act = null;
      phase = "recover";
      recoverT = sp.recovery ?? 0.3;
      onCast?.(sp, index);
      return true;
    }

    if (sp.kind === "heal") {
      // The candle is the whole heal: applied on the cast, capped, and deliberately unable to overflow.
      state.candle = Math.min(state.maxCandle, state.candle + (sp.heal ?? 0) * (mods.healMult ?? 1));
      if (mods.healMana > 0) state.mana = Math.min(state.maxMana, state.mana + mods.healMana);
    }

    // Bolt has to know where to put its strike before the act exists; every other act already knows.
    const target = sp.makeFx && findTarget ? findTarget(sp) : null;
    const mod = sp.makeFx ? sp.makeFx(x, target) : sp.fx;
    act = createAct(mod, { x, y, seed: ++seed });
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
   * Space starts a 0.35 s guard (0.5 s with swift). It may be raised in the middle of a long cast — that is the
   * whole point of the mechanic — but no new cast may start while it is up. An empty block is only the cooldown.
   */
  function block() {
    if (blockCd > 0) return false;
    blockMax = BLOCK_WINDOW + (mods.blockWindowBonus ?? 0);
    blockT = blockMax;
    blockCd = BLOCK_CD;
    return true;
  }

  /**
   * The candle is the only health pool. A bite inside the block window is caught: no candle loss, no interrupt,
   * the shield effect in front, and (with swift) mana back. Outside it, every bite drains the candle and makes
   * him flinch, but only a bite in the wind-up (before the act's first hit window) cancels the performance,
   * and never during armor.
   *
   * Returns "blocked" | "hurt" | "god" so the field can answer a boss breath with the shield or the hit flash.
   * `interrupt: false` is the boss's breath: it costs candle and still makes him flinch, but it never cuts a
   * cast (DESIGN/M2c: the boss's move is a punishment, not a lock-out). combat.hit passes the knockback as the
   * second argument, which keeps the default interrupt behaviour.
   */
  function hurt(damage, opts = {}) {
    if (state.god) return "god";
    if (blockT > 0) {
      blockT = 0; // one bite per window
      state.biteFlash = 0;
      if (mods.blockMana > 0) state.mana = Math.min(state.maxMana, state.mana + mods.blockMana);
      onBlock?.();
      return "blocked";
    }
    state.candle = Math.max(0, state.candle - damage);
    state.biteFlash = BITE_FLASH;
    audio?.sfx("bite"); // the low muffled thud, also the sound of a cast being cut short
    reactT = 0.22; // the visible flinch and candle-bar blink happen on every bite, interrupt or not
    const interrupt = typeof opts === "object" && opts !== null ? opts.interrupt !== false : true;
    if (!interrupt) return "hurt";
    if (armorT > 0) return "hurt";
    if (phase !== "cast" || !act) return "hurt";
    const firstHit = timings[spell]?.hits?.[0]?.t ?? 0;
    if (act.t >= firstHit) return "hurt"; // the first hit is out: this act must play to its end
    if (cancel("hurt")) {
      armorT = INTERRUPT_ARMOR;
      stats.interrupts = (stats.interrupts ?? 0) + 1;
    }
    return "hurt";
  }

  /**
   * Fire damage on the act's first hit window, once. Single spells resolve the frontmost target in reach;
   * an AoE resolves every living enemy, each with its own spark and number but one screen-wide freeze/flash.
   * `strikes` is the number of blows the spell lands inside that one window (DESIGN §2.6's two sword cuts):
   * they share the window and are resolved as one impact, so one cast still shows one number and one spark.
   */
  function resolveHits() {
    const sp = SPELLS[spell];
    if (!sp) return;
    const hit = timings[spell]?.hits?.[0];
    if (!hit || nextHit > 0) return;
    if (act.t < hit.t) return;
    nextHit = 1; // one damage window per cast, however many targets it reaches
    // Hammer, frost and lightning are heard when they land, whether or not anything is in reach (a bolt still
    // cracks into the ground; a whiffed hammer still smashes). The slash's swish was its cast cue; its lower
    // "thwack" is played only on an actual hit below.
    if (sp.id === "hammer" || sp.id === "nova" || sp.id === "bolt") audio?.sfx(sp.id);

    if (sp.kind === "aoe") {
      const targets = findTargets ? findTargets(sp) : [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        combat.hit({
          x: t.hitX,
          y: t.hitY,
          damage: sp.damage,
          target: t,
          // one hit-stop, one shake, one white flash for the spell; every target still gets its spark + number
          freeze: i === 0 ? hit.freeze : 0,
          shake: i === 0 ? hit.shake : 0,
          amp: i === 0 ? hit.amp : 0,
          screen: i === 0,
          count: i === 0,
        });
        if (sp.slow) t.slow?.(sp.slow.mult, sp.slow.time + (mods.slowBonus ?? 0));
      }
      return;
    }

    if (sp.kind !== "single") return;
    const target = findTarget ? findTarget(sp) : null;
    if (!target) return; // nothing in reach: the act's own dust and sparks are the miss feedback
    const slashMult = sp.id === "slash" ? mods.slashMult ?? 1 : 1;
    const damage = sp.damage * Math.max(1, sp.strikes ?? 1) * slashMult;
    const knock = (sp.knock ?? 0) * (sp.id === "hammer" ? mods.hammerKnockMult ?? 1 : 1);
    combat.hit({
      x: target.hitX,
      y: target.hitY,
      damage,
      knock,
      target,
      freeze: hit.freeze,
      shake: hit.shake,
      amp: hit.amp,
      heavy: !!sp.heavy,
    });
    if (sp.id === "slash") audio?.sfx("slashHit"); // the swish started the act; this is the lower "thwack"
    if (sp.id === "hammer" && mods.hammerStun > 0) target.stun?.(mods.hammerStun);
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
    if (blockT > 0) blockT = Math.max(0, blockT - dt);
    if (blockCd > 0) blockCd = Math.max(0, blockCd - dt);
    for (let i = 0; i < cooldowns.length; i++) cooldowns[i] = Math.max(0, cooldowns[i] - dt);
    if (phase === "recover") {
      recoverT -= dt;
      if (recoverT <= 0) {
        recoverT = 0;
        phase = "idle";
      }
    }
    if (phase !== "cast") state.mana = Math.min(state.maxMana, state.mana + (MANA_REGEN + (mods.manaRegen ?? 0)) * dt);
  }

  /** A complete run restart: no act, no recovery, no cooldown, no guard, no armor — the watchman re-armed. */
  function reset() {
    if (act?.fx?.stop) act.fx.stop();
    act = null;
    spell = -1;
    phase = "idle";
    recoverT = 0;
    nextHit = 0;
    armorT = 0;
    reactT = 0;
    blockT = 0;
    blockCd = 0;
    castSeq = 0;
    for (let i = 0; i < cooldowns.length; i++) cooldowns[i] = 0;
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

  /** The guard while the window is up: a thin pale arc in front, hidden the moment it is spent or expires. */
  function drawGuard(frame) {
    if (blockT <= 0) return;
    const p = painterFor(frame);
    const k = Math.min(1, blockT / Math.max(0.01, blockMax));
    p.place(x + 12, y - 24);
    p.arc(0, 0, 17, 2, -1.15, 1.15, GUARD, 0.22 + 0.4 * k);
    p.light(21, 0, GUARD, 0.12 * k);
  }

  function draw(frame) {
    if (act) act.draw(frame, { target: false });
    else drawIdle(frame);
    drawGuard(frame);
  }

  return {
    x,
    y,
    cast,
    cancel,
    block,
    hurt,
    reset,
    update,
    draw,
    /** The cooldown one cast of spell i would start right now (after focus/storm); the HUD wipe uses it. */
    cooldownFor: (i) => (SPELLS[i] ? cooldownOf(SPELLS[i]) : 0),
    /** True while a cast is still before its first hit window: the only time a bite can cut it. */
    get windup() {
      if (phase !== "cast" || !act) return false;
      const first = timings[spell]?.hits?.[0]?.t ?? 0;
      return act.t < first;
    },
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
    get blockActive() {
      return blockT > 0;
    },
    get blockCd() {
      return blockCd;
    },
    get blockWindow() {
      return BLOCK_WINDOW + (mods.blockWindowBonus ?? 0);
    },
    get castSeq() {
      return castSeq;
    },
  };
}
