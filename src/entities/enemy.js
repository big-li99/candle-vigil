// The four enemy types of M2a, as one parameterised body: same walk/queue/bite/flash/death machinery, different
// numbers and effect. An enemy does not animate its own movement: the critter effect loops in place and the body
// is moved by rewriting x (the flying lane also owns a y).
import { createFx } from "../../vendor/pixelfx/src/core/index.js";
import * as slimeFx from "../../vendor/pixelfx/src/fx/critters/slime.js";
import * as ghostFx from "../../vendor/pixelfx/src/fx/critters/ghost.js";
import * as skullFx from "../../vendor/pixelfx/src/fx/critters/flying-skull.js";
import * as eyeballFx from "../../vendor/pixelfx/src/fx/critters/eyeball.js";
import { W, GROUND } from "../frame.js";

export const SPAWN_X = 384; // just off the right edge
export const GUARD_X = 124; // the front of the queue: close enough to bite, far enough not to swallow the player
export const QUEUE_GAP = 34; // px between two waiting enemies in the same lane (DESIGN §2.3)
export const FLY_Y = GROUND - 26; // the flying lane (M2a brief); only flyers queue here

/** DESIGN §2.7 / the M2a brief. `hitY` is measured from the enemy's own lane y. */
export const ENEMY_TYPES = {
  slime: {
    fx: slimeFx,
    hp: 30,
    speed: 18,
    bite: 3,
    interval: 0.6,
    deathFx: "spawn/poof",
    hitY: -16,
  },
  ghost: {
    fx: ghostFx,
    hp: 20,
    speed: 30,
    bite: 3,
    interval: 0.6,
    poisonImmune: true,
    deathFx: "spawn/poof",
    hitY: -22,
  },
  skull: {
    fx: skullFx,
    hp: 20,
    speed: 55,
    bite: 5,
    interval: 0.5,
    flying: true,
    interruptPriority: true, // this one rushes its bite when a wind-up starts
    deathFx: "spawn/poof",
    hitY: 0,
  },
  eyeball: {
    fx: eyeballFx,
    hp: 50,
    speed: 22,
    bite: 12,
    interval: 1.2,
    deathFx: "spawn/disintegrate", // DESIGN §2.7: the thick one comes apart instead of popping
    hitY: -44,
  },
};

const PUSH_TIME = 0.14; // seconds to travel the knockback distance, whatever it is
const HIT_FLASH = 0.08;
const MAX_X = W - 16; // the knockback stops here, so an enemy can never leave the screen
const FLASH_RAMP = ["#e8f2ff", "#ffffff"];
const LUNGE = 8; // the bite leans in this far, then comes back (visual only)
const LUNGE_TIME = 0.16;
const SKULL_RUSH = 0.15; // a skull at the line bites this soon after a wind-up begins

export function createEnemy({ x = SPAWN_X, y, seed = 1, type = "slime", world }) {
  const T = ENEMY_TYPES[type] ?? ENEMY_TYPES.slime;
  const laneY = y ?? (T.flying ? FLY_Y : GROUND);
  // A flyer's effect is still anchored to the floor (its own shadow and fire must sit on the floor), and its
  // internal hover carries the body up to the lane: hover 26 puts the skull at y, not at GROUND.
  const fxOptions = { x, y: T.flying ? GROUND : laneY, seed };
  if (T.flying) fxOptions.hover = GROUND - laneY;
  const fx = createFx(T.fx, fxOptions);
  // The same creature again in white, drawn over the real one for a few frames when it is hit (DESIGN §2.11).
  // Same seed, and it is fast-forwarded to the body's own phase on the hit, so the two stay in the same pose.
  // Created lazily: a white copy stepped every frame for every enemy is the single most expensive thing on
  // screen (it doubled the cost of a full wave and cost frames on the spawn burst).
  let flash = null;
  function flashNow() {
    if (flash) return flash;
    flash = createFx(T.fx, { ...fxOptions, palette: FLASH_RAMP });
    flash.update(fx.t);
    return flash;
  }

  let posX = x;
  let hp = T.hp;
  let biteT = T.interval;
  let pushV = 0;
  let pushT = 0;
  let hurtT = 0;
  let lungeT = 0;
  let slowT = 0;
  let slowMult = 1;
  let stunT = 0; // EARTH WRATH: no walking and no biting for this long (knockback still travels)
  let dead = false;
  let stopX = GUARD_X; // its place in the queue, assigned by the field every step
  let front = false; // only the front of its own lane can reach the player
  let rushedCast = -1; // the last player cast this skull already rushed a bite for

  function bite() {
    const p = world.player;
    lungeT = LUNGE_TIME;
    world.combat.hit({
      x: p.x + 7,
      y: p.y - 22,
      damage: T.bite,
      target: p, // player.hurt drains the candle, makes him flinch and (only in the wind-up) breaks the cast
      shake: 0.12,
      amp: 1,
      count: false, // the combo counts the player's hits, not the enemies'
      fxImpacts: false, // a bite is not an impact: no spark, no number, no flash, no freeze, no hit stat
    });
  }

  function update(dt) {
    if (dead) return; // it may still be on the field for the one frame the world stays frozen after the kill
    if (hurtT > 0) hurtT = Math.max(0, hurtT - dt);
    if (lungeT > 0) lungeT = Math.max(0, lungeT - dt);
    if (slowT > 0) {
      slowT = Math.max(0, slowT - dt);
      if (slowT === 0) slowMult = 1;
    }
    if (stunT > 0) stunT = Math.max(0, stunT - dt);
    if (pushT > 0) {
      // knockback travels exactly `knock` px (speed fixed at the moment of the hit), then walking resumes
      const step = Math.min(dt, pushT);
      posX = Math.min(MAX_X, posX + pushV * step);
      pushT -= step;
    } else if (stunT <= 0) {
      // walk to the slot assigned this step; queued enemies wait without biting, so a crowd cannot lock the player
      const gap = posX - stopX;
      const speed = T.speed * (slowT > 0 ? slowMult : 1);
      if (gap > 0.5) posX = Math.max(stopX, posX - speed * dt);
      else if (gap < -0.5) posX = Math.min(stopX, posX + speed * dt);
      else {
        posX = stopX;
        if (front) {
          // a skull is the interrupter: when a wind-up starts, it rushes its next bite (once per cast).
          // Everyone else simply keeps their cadence; their bite only lands when they are at the line anyway.
          const p = world.player;
          if (T.interruptPriority && p && p.windup && p.castSeq !== rushedCast) {
            rushedCast = p.castSeq;
            biteT = Math.min(biteT, SKULL_RUSH);
          }
          biteT -= dt;
          if (biteT <= 0) {
            biteT += T.interval;
            bite();
          }
        }
      }
    }
    // the lean is presentation only: the queue slot and the bite timing never move with it
    const lunge = lungeT > 0 ? -LUNGE * Math.sin(Math.PI * (1 - lungeT / LUNGE_TIME)) : 0;
    fx.options.x = posX + lunge;
    fx.update(dt);
    // the white copy only exists while it is actually being shown
    if (flash && hurtT > 0) {
      flash.options.x = posX + lunge;
      flash.update(dt);
    }
  }

  /** The field assigns one queue slot per enemy each step: GUARD_X + 34 * (how many are in front in its lane). */
  function place(x, isFront) {
    stopX = x;
    front = isFront;
  }

  /** Frost nova's slow: a movement multiplier for `time` seconds. Hit tests stay exactly where they were. */
  function slow(mult = 0.5, time = 3) {
    if (dead || time <= 0) return;
    slowT = Math.max(slowT, time);
    slowMult = Math.min(slowT > 0 ? slowMult : 1, mult);
  }

  /** EARTH WRATH's stun: stand still (no walk, no bite) for `time` seconds. Movement speed is untouched. */
  function stun(time = 1) {
    if (dead || time <= 0) return;
    stunT = Math.max(stunT, time);
    biteT = Math.max(biteT, time); // the bite cadence resumes after the stun, not in the middle of it
  }

  /** Called by combat.hit: everything that happens to this enemy when it is struck. */
  function hurt(damage, knock = 0) {
    if (dead) return;
    hp -= damage;
    hurtT = HIT_FLASH;
    flashNow();
    if (knock > 0) {
      pushV = knock / PUSH_TIME;
      pushT = PUSH_TIME;
    }
    if (hp <= 0) {
      dead = true;
      // the death itself: its own effect at its body, and the ember it leaves behind
      world.combat.effect(T.deathFx, posX, laneY, seed + 3);
      world.combat.effect("pickups/collect-burst", posX, laneY - 4, seed + 5);
      world.onKill?.(enemy);
    }
  }

  function draw(frame) {
    fx.draw(frame, "back");
    fx.draw(frame, "front");
    if (hurtT > 0 && flash) {
      flash.draw(frame, "back");
      flash.draw(frame, "front");
    }
  }

  const enemy = {
    type,
    id: seed,
    update,
    hurt,
    slow,
    stun,
    draw,
    place,
    get x() {
      return posX;
    },
    get y() {
      return laneY;
    },
    get hp() {
      return Math.max(0, hp);
    },
    get dead() {
      return dead;
    },
    get flying() {
      return !!T.flying;
    },
    get poisonImmune() {
      return !!T.poisonImmune;
    },
    get deathFx() {
      return T.deathFx;
    },
    /** Current movement speed in px/s (after a slow); debug/verification only. */
    get speed() {
      return T.speed * (slowT > 0 ? slowMult : 1);
    },
    get slowT() {
      return slowT;
    },
    get stunned() {
      return stunT > 0;
    },
    /** Debug/autotest only: seconds until this enemy's next bite, Infinity when it is not the front of its lane. */
    get biteIn() {
      return front && Math.abs(posX - stopX) <= 0.5 ? biteT : Infinity;
    },
    get hitX() {
      return posX;
    },
    get hitY() {
      return laneY + T.hitY;
    },
  };
  return enemy;
}
