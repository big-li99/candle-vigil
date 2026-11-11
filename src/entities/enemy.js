// M1 has one enemy: the slime. It walks the ground line in from the right, stops at its place in the queue
// in front of the player and bites the candle. It does not move by animation: the effect animates in place
// and the body is moved by rewriting x.
import { createFx } from "../../vendor/pixelfx/src/core/index.js";
import * as slimeFx from "../../vendor/pixelfx/src/fx/critters/slime.js";
import { W } from "../frame.js";

export const SLIME = "slime";
export const SLIME_SPEED = 18; // px/s
export const SPAWN_X = 384; // just off the right edge
export const GUARD_X = 124; // the front of the queue: close enough to bite, far enough not to swallow the player
export const QUEUE_GAP = 34; // px between two waiting slimes (DESIGN §2.3)
export const BITE_DAMAGE = 3;
export const BITE_INTERVAL = 0.6;
export const SLIME_HP = 30; // DESIGN §2.7 (the M1 "3" column is this ×10, see M1 findings)
const PUSH_TIME = 0.14; // seconds to travel the knockback distance, whatever it is
const HIT_FLASH = 0.08;
const MAX_X = W - 16; // the knockback stops here, so a slime can never leave the screen
const FLASH_RAMP = ["#e8f2ff", "#ffffff"];
const LUNGE = 8; // the bite leans in this far, then comes back (visual only)
const LUNGE_TIME = 0.16;

export function createEnemy({ x = SPAWN_X, y = 196, seed = 1, type = SLIME, world }) {
  const fx = createFx(slimeFx, { x, y, seed });
  // The same slime again in white: drawn over the real one for a few frames when it is hit (DESIGN §2.11).
  // Same seed and same step sequence, so the two stay in the same pose.
  const flash = createFx(slimeFx, { x, y, seed, palette: FLASH_RAMP });

  let posX = x;
  let hp = SLIME_HP;
  let biteT = BITE_INTERVAL;
  let pushV = 0;
  let pushT = 0;
  let hurtT = 0;
  let lungeT = 0;
  let dead = false;
  let stopX = GUARD_X; // its place in the queue, assigned by the field every step
  let front = false; // only the slime at the guard line can reach the player

  function bite() {
    const p = world.player;
    lungeT = LUNGE_TIME;
    world.combat.hit({
      x: p.x + 7,
      y: p.y - 22,
      damage: BITE_DAMAGE,
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
    if (pushT > 0) {
      // knockback travels exactly `knock` px (speed fixed at the moment of the hit), then walking resumes
      const step = Math.min(dt, pushT);
      posX = Math.min(MAX_X, posX + pushV * step);
      pushT -= step;
    } else {
      // walk to the slot assigned this step; queued slimes wait without biting, so a crowd cannot lock the player
      const gap = posX - stopX;
      if (gap > 0.5) posX = Math.max(stopX, posX - SLIME_SPEED * dt);
      else if (gap < -0.5) posX = Math.min(stopX, posX + SLIME_SPEED * dt);
      else {
        posX = stopX;
        if (front) {
          biteT -= dt;
          if (biteT <= 0) {
            biteT += BITE_INTERVAL;
            bite();
          }
        }
      }
    }
    // the lean is presentation only: the queue slot and the bite timing never move with it
    const lunge = lungeT > 0 ? -LUNGE * Math.sin(Math.PI * (1 - lungeT / LUNGE_TIME)) : 0;
    fx.options.x = posX + lunge;
    flash.options.x = posX + lunge;
    fx.update(dt);
    flash.update(dt);
  }

  /** The field assigns one queue slot per slime each step: GUARD_X + 34 * (how many are in front of it). */
  function place(x, isFront) {
    stopX = x;
    front = isFront;
  }

  /** Called by combat.hit: everything that happens to this slime when it is struck. */
  function hurt(damage, knock = 0) {
    if (dead) return;
    hp -= damage;
    hurtT = HIT_FLASH;
    if (knock > 0) {
      pushV = knock / PUSH_TIME;
      pushT = PUSH_TIME;
    }
    if (hp <= 0) {
      dead = true;
      // the death itself: a cartoon poof at its feet and the ember it leaves behind
      world.combat.effect("spawn/poof", posX, y, seed + 3);
      world.combat.effect("pickups/collect-burst", posX, y - 4, seed + 5);
      world.onKill?.(enemy);
    }
  }

  function draw(frame) {
    fx.draw(frame, "back");
    fx.draw(frame, "front");
    if (hurtT > 0) {
      flash.draw(frame, "back");
      flash.draw(frame, "front");
    }
  }

  const enemy = {
    type,
    id: seed,
    update,
    hurt,
    draw,
    place,
    get x() {
      return posX;
    },
    get y() {
      return y;
    },
    get hp() {
      return Math.max(0, hp);
    },
    get dead() {
      return dead;
    },
    /** Debug/autotest only: seconds until this slime's next bite, Infinity when it is not the front one. */
    get biteIn() {
      return front && Math.abs(posX - stopX) <= 0.5 ? biteT : Infinity;
    },
    get hitX() {
      return posX;
    },
    get hitY() {
      return y - 16;
    },
  };
  return enemy;
}
