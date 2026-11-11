// The boss of waves 5 and 10: a bone-fire lord built from two `critters/flying-skull` bodies and the
// `fire/fire-breath` cone. It walks in at 12 px/s, stops on the guard line, then breathes every 6 s after a
// 1.5 s tell (the cone looping in front of its head and brightening). The tell is the read: Space inside the
// last fraction of a second blocks it, anything else costs 15 candle. The breath never interrupts a cast —
// it is a punishment, not a lock-out. At half hp it calls three slimes once. All numbers are DESIGN §2.7 /
// the M2c brief.
import { createFx } from "../../vendor/pixelfx/src/core/index.js";
import * as skullFx from "../../vendor/pixelfx/src/fx/critters/flying-skull.js";
import * as breathFx from "../../vendor/pixelfx/src/fx/fire/fire-breath.js";
import { W, GROUND } from "../frame.js";
import { GUARD_X, FLY_Y } from "./enemy.js";

export const BOSS_HP = 200;
export const BOSS_SPEED = 12; // px/s (DESIGN §2.7)
export const BOSS_BREATH_EVERY = 6;
export const BOSS_TELEGRAPH = 1.5;
export const BOSS_BREATH_DAMAGE = 15;
export const BOSS_RECOIL = 6;
export const BOSS_SUMMON = 3;
export const BOSS_EMBERS = 10;

const HIT_FLASH = 0.08;
const MAX_X = W - 16;
const FLASH_RAMP = ["#e8f2ff", "#ffffff"];
const ECHO_DX = 11; // the second skull sits just behind the first, so the pair reads as one larger body
const ECHO_DY = -4;

export function createBoss({ x = W, y = FLY_Y, seed = 1, world }) {
  // A flyer's effect is anchored to the floor; `hover` lifts the body into its lane (the enemy module's rule).
  const skullOpts = { x, y: GROUND, seed, hover: GROUND - y };
  const main = createFx(skullFx, skullOpts);
  const echo = createFx(skullFx, { ...skullOpts, x: x + ECHO_DX, seed: seed + 1, hover: GROUND - y - ECHO_DY });
  // The same pair in white, drawn over the real body for a few frames when it is hit (DESIGN §2.11).
  const mainFlash = createFx(skullFx, { ...skullOpts, palette: FLASH_RAMP });
  const echoFlash = createFx(skullFx, {
    ...skullOpts,
    x: x + ECHO_DX,
    seed: seed + 1,
    hover: GROUND - y - ECHO_DY,
    palette: FLASH_RAMP,
  });

  let posX = x;
  let hp = BOSS_HP;
  let dead = false;
  let hurtT = 0;
  let slowT = 0;
  let slowMult = 1;
  let stunT = 0;
  // The brief's cadence is one breath every 6 s. The 1.5 s tell is part of that window, so the countdown that
  // starts after each resolve is 4.5 s and the next breath lands exactly 6 s after the last one.
  let breathCd = BOSS_BREATH_EVERY - BOSS_TELEGRAPH;
  let tele = 0;
  let summoned = false;
  const breaths = []; // the cone of the current tell, plus the last one fading out

  function headX() {
    return posX - 14;
  }

  function headY() {
    return y - 2;
  }

  function updateBreaths(dt) {
    for (let i = breaths.length - 1; i >= 0; i--) {
      const b = breaths[i];
      b.options.x = headX();
      b.options.y = headY();
      b.update(dt);
      if (b.done()) breaths.splice(i, 1);
    }
  }

  function startTelegraph() {
    tele = BOSS_TELEGRAPH;
    breathCd = BOSS_BREATH_EVERY - BOSS_TELEGRAPH; // after the tell, wait the rest of the 6 s window
    const inst = createFx(breathFx, { x: headX(), y: headY(), flip: true, seed: seed + 11, light: 0.25 });
    breaths.push(inst);
  }

  function resolveBreath() {
    tele = 0;
    for (const b of breaths) b.stop(); // the cone fades out over the library's 0.3 s tail
    world.onBossBreath?.(boss);
  }

  function update(dt) {
    if (dead) return;
    if (hurtT > 0) hurtT = Math.max(0, hurtT - dt);
    if (slowT > 0) {
      slowT = Math.max(0, slowT - dt);
      if (slowT === 0) slowMult = 1;
    }

    updateBreaths(dt);

    if (stunT > 0) {
      stunT = Math.max(0, stunT - dt);
    } else {
      // walk to the guard line, then hold there
      if (posX > GUARD_X + 0.5) {
        const speed = BOSS_SPEED * (slowT > 0 ? slowMult : 1);
        posX = Math.max(GUARD_X, posX - speed * dt);
      }
      // The breath only starts once it is at the line: from across the field the cone could not reach the player.
      if (posX <= GUARD_X + 0.5) {
        if (tele > 0) {
          tele = Math.max(0, tele - dt);
          const k = 1 - tele / BOSS_TELEGRAPH;
          for (const b of breaths) b.options.light = 0.25 + 1.35 * k; // the tell: the cone gets brighter
          if (tele === 0) resolveBreath();
        } else {
          breathCd -= dt;
          if (breathCd <= 0) startTelegraph();
        }
      }
    }

    main.options.x = posX;
    echo.options.x = posX + ECHO_DX;
    mainFlash.options.x = posX;
    echoFlash.options.x = posX + ECHO_DX;
    main.update(dt);
    echo.update(dt);
    mainFlash.update(dt);
    echoFlash.update(dt);
  }

  /** Called by combat.hit: hp, hit flash, the half-hp summon and the death. Knockback is ignored (it is a boss). */
  function hurt(damage, _knock = 0) {
    if (dead) return;
    hp -= damage;
    hurtT = HIT_FLASH;
    if (hp <= 0) {
      hp = 0;
      dead = true;
      for (const b of breaths) b.stop();
      world.onBossKill?.(boss);
      return;
    }
    if (!summoned && hp <= BOSS_HP * 0.5) {
      summoned = true;
      world.onBossHalf?.(boss);
    }
  }

  function slow(mult = 0.5, time = 3) {
    if (dead || time <= 0) return;
    slowT = Math.max(slowT, time);
    slowMult = Math.min(slowT > 0 ? slowMult : 1, mult);
  }

  function stun(time = 1) {
    if (dead || time <= 0) return;
    stunT = Math.max(stunT, time);
  }

  /** The shield's answer: 6 px back, then it walks in again. */
  function recoil(px = BOSS_RECOIL) {
    if (dead || px <= 0) return;
    posX = Math.min(MAX_X, posX + px);
  }

  /** The field's queue may not move the boss: it owns its own approach and its own stop. */
  function place() {}

  function draw(frame) {
    // back to front: the second skull, the main skull, their flashes, then the cone in front of the mouth
    echo.draw(frame, "back");
    echo.draw(frame, "front");
    main.draw(frame, "back");
    main.draw(frame, "front");
    if (hurtT > 0) {
      echoFlash.draw(frame, "back");
      echoFlash.draw(frame, "front");
      mainFlash.draw(frame, "back");
      mainFlash.draw(frame, "front");
    }
    for (const b of breaths) {
      b.draw(frame, "back");
      b.draw(frame, "front");
    }
  }

  const boss = {
    type: "boss",
    id: seed,
    update,
    hurt,
    slow,
    stun,
    recoil,
    place,
    draw,
    get x() {
      return posX;
    },
    get y() {
      return y;
    },
    get hp() {
      return Math.max(0, hp);
    },
    get maxHp() {
      return BOSS_HP;
    },
    get dead() {
      return dead;
    },
    get flying() {
      return true; // the poison zone skips flyers, so the boss never takes ground-poison ticks
    },
    get poisonImmune() {
      return false;
    },
    get deathFx() {
      return "explosions/small-explosion";
    },
    /** Seconds left of the current tell; 0 when it is not winding one up. */
    get telegraph() {
      return tele;
    },
    get summoned() {
      return summoned;
    },
    get speed() {
      return BOSS_SPEED * (slowT > 0 ? slowMult : 1);
    },
    get hitX() {
      return posX - 2;
    },
    get hitY() {
      return y - 8;
    },
  };
  return boss;
}
