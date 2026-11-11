// Every effect the game is allowed to play, explicitly imported so the bundle only contains these.
// Keys are the ids from DESIGN.md section 4 (plus weather/snow, which the stage needs).
import * as swordSlash from "../vendor/pixelfx/src/fx/melee/sword-slash.js";
import * as hammerSmash from "../vendor/pixelfx/src/fx/melee/hammer-smash.js";
import * as frostNova from "../vendor/pixelfx/src/fx/ice/frost-nova.js";
import * as lightningStrike from "../vendor/pixelfx/src/fx/lightning/lightning-strike.js";
import * as poisonCloud from "../vendor/pixelfx/src/fx/nature/poison-cloud.js";
import * as heal from "../vendor/pixelfx/src/fx/holy/heal.js";

import * as slime from "../vendor/pixelfx/src/fx/critters/slime.js";
import * as ghost from "../vendor/pixelfx/src/fx/critters/ghost.js";
import * as eyeball from "../vendor/pixelfx/src/fx/critters/eyeball.js";
import * as flyingSkull from "../vendor/pixelfx/src/fx/critters/flying-skull.js";

import * as hitSpark from "../vendor/pixelfx/src/fx/impacts/hit-spark.js";
import * as critHit from "../vendor/pixelfx/src/fx/impacts/crit-hit.js";
import * as hitFlash from "../vendor/pixelfx/src/fx/impacts/hit-flash.js";
import * as shieldBlock from "../vendor/pixelfx/src/fx/impacts/shield-block.js";
import * as poof from "../vendor/pixelfx/src/fx/spawn/poof.js";
import * as disintegrate from "../vendor/pixelfx/src/fx/spawn/disintegrate.js";
import * as smallExplosion from "../vendor/pixelfx/src/fx/explosions/small-explosion.js";
import * as plasmaExplosion from "../vendor/pixelfx/src/fx/explosions/plasma-explosion.js";

import * as collectBurst from "../vendor/pixelfx/src/fx/pickups/collect-burst.js";
import * as powerStar from "../vendor/pixelfx/src/fx/pickups/power-star.js";
import * as comboCounter from "../vendor/pixelfx/src/fx/ui/combo-counter.js";
import * as levelUp from "../vendor/pixelfx/src/fx/ui/level-up.js";

import * as candle from "../vendor/pixelfx/src/fx/fire/candle.js";
import * as torch from "../vendor/pixelfx/src/fx/fire/torch.js";
import * as fireBreath from "../vendor/pixelfx/src/fx/fire/fire-breath.js";
import * as iris from "../vendor/pixelfx/src/fx/transitions/iris.js";
import * as slashWipe from "../vendor/pixelfx/src/fx/transitions/slash-wipe.js";

import * as snow from "../vendor/pixelfx/src/fx/weather/snow.js";

const REGISTRY = {
  "melee/sword-slash": swordSlash,
  "melee/hammer-smash": hammerSmash,
  "ice/frost-nova": frostNova,
  "lightning/lightning-strike": lightningStrike,
  "nature/poison-cloud": poisonCloud,
  "holy/heal": heal,

  "critters/slime": slime,
  "critters/ghost": ghost,
  "critters/eyeball": eyeball,
  "critters/flying-skull": flyingSkull,

  "impacts/hit-spark": hitSpark,
  "impacts/crit-hit": critHit,
  "impacts/hit-flash": hitFlash,
  "impacts/shield-block": shieldBlock,
  "spawn/poof": poof,
  "spawn/disintegrate": disintegrate,
  "explosions/small-explosion": smallExplosion,
  "explosions/plasma-explosion": plasmaExplosion,

  "pickups/collect-burst": collectBurst,
  "pickups/power-star": powerStar,
  "ui/combo-counter": comboCounter,
  "ui/level-up": levelUp,

  "fire/candle": candle,
  "fire/torch": torch,
  "fire/fire-breath": fireBreath,
  "transitions/iris": iris,
  "transitions/slash-wipe": slashWipe,

  "weather/snow": snow,
};

/** The effect module for an id, or null. */
export function get(id) {
  return REGISTRY[id] ?? null;
}

export function has(id) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

export function ids() {
  return Object.keys(REGISTRY);
}
