// M1 has one enemy: the slime. It walks the ground line in from the right, stops at the guard line in
// front of the player and bites the candle. It does not move by animation: the effect animates in place and
// the body is moved by rewriting x.
import { createFx } from "../../vendor/pixelfx/src/core/index.js";
import * as slimeFx from "../../vendor/pixelfx/src/fx/critters/slime.js";
import { W } from "../frame.js";

export const SLIME = "slime";
export const SLIME_SPEED = 18; // px/s
export const SPAWN_X = 384; // just off the right edge
export const GUARD_X = 76; // where it stops and starts biting
export const BITE_DAMAGE = 4;
export const BITE_INTERVAL = 0.5;
// The M1 brief says "hp 3"; the same brief's acceptance requires a slime to survive 12 damage (sword) and
// 26 damage (hammer) and to still be pushed back 20 px, which needs more than 26. DESIGN §2.7 reads as
// slime 3 / ghost 2 / skull 2 / eyeball 5 / boss 60 against spells of 12–40 — i.e. that column scaled ×10.
// 30 is the value that makes both documents' sentences true. CONFLICT flagged to the reviewer; one constant.
export const SLIME_HP = 30;
const PUSH_TIME = 0.14; // seconds to travel the knockback distance, whatever it is
const HIT_FLASH = 0.08;
const MAX_X = W - 16; // the knockback stops here, so a slime can never leave the screen
const FLASH_RAMP = ["#e8f2ff", "#ffffff"];

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
  let dead = false;

  function bite() {
    const p = world.player;
    world.combat.hit({
      x: p.x + 7,
      y: p.y - 22,
      damage: BITE_DAMAGE,
      target: p, // player.hurt drains the candle, breaks the cast and makes him flinch
      shake: 0.12,
      amp: 1,
      count: false, // the combo counts the player's hits, not the enemies'
    });
  }

  function update(dt) {
    if (dead) return; // it may still be on the field for the one frame the world stays frozen after the kill
    if (hurtT > 0) hurtT = Math.max(0, hurtT - dt);
    if (pushT > 0) {
      // knockback travels exactly `knock` px (speed fixed at the moment of the hit), then walking resumes
      const step = Math.min(dt, pushT);
      posX = Math.min(MAX_X, posX + pushV * step);
      pushT -= step;
    } else if (posX > GUARD_X) {
      posX = Math.max(GUARD_X, posX - SLIME_SPEED * dt);
    } else {
      biteT -= dt;
      if (biteT <= 0) {
        biteT += BITE_INTERVAL;
        bite();
      }
    }
    fx.options.x = posX;
    flash.options.x = posX;
    fx.update(dt);
    flash.update(dt);
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
    update,
    hurt,
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
    get dead() {
      return dead;
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
