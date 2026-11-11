// The six spells of M2a, as data. Timing is deliberately absent: windup, hit windows, hit-stop, shake and
// recovery are read from each effect's own act (CLAUDE.md rule 5), so the animation stays the source of truth.
// `kind` is the only behaviour switch the player needs: single | aoe | zone | heal.
import { actTiming } from "../../vendor/pixelfx/src/core/index.js";
import * as swordSlash from "../../vendor/pixelfx/src/fx/melee/sword-slash.js";
import * as hammerSmash from "../../vendor/pixelfx/src/fx/melee/hammer-smash.js";
import * as frostNova from "../../vendor/pixelfx/src/fx/ice/frost-nova.js";
import * as poisonCloud from "../../vendor/pixelfx/src/fx/nature/poison-cloud.js";
import * as heal from "../../vendor/pixelfx/src/fx/holy/heal.js";
import { boltFx, makeBolt } from "./bolt-fx.js";

export const SPELLS = [
  {
    id: "slash",
    name: "SWORD SLASH",
    fx: swordSlash,
    cost: 10,
    cd: 0.6,
    kind: "single",
    // DESIGN §2.6: two cuts of 15 = 30, exactly one slime. The vendored act exposes a single hit window
    // (actTiming(swordSlash).hits has one entry at t=0.06), so both cuts land in that window and combat
    // resolves them as one impact: one number (30), one spark, one combo step — the M1.5 acceptance.
    damage: 15,
    strikes: 2,
    knock: 6,
    reach: 140,
    thumbT: 0.10, // the frame the HUD thumbnail is rendered from: the crescent at full sweep
    thumbFocus: [6, -26], // what the thumbnail should be centred on, in the effect's local px
  },
  {
    id: "hammer",
    name: "HAMMER SMASH",
    fx: hammerSmash,
    cost: 22,
    cd: 3.0,
    kind: "single",
    damage: 26,
    knock: 20,
    heavy: true, // the M3 feel budget: 0.14 s stop, 2 px shake
    reach: 150,
    thumbT: 0.30, // the dome of force with its rocks in the air: the one frame that says "smash"
    thumbFocus: [24, -14],
  },
  {
    id: "nova",
    name: "FROST NOVA",
    fx: frostNova,
    cost: 34,
    cd: 8,
    kind: "aoe",
    damage: 30,
    slow: { mult: 0.5, time: 3 }, // DESIGN §2.6: −50% for 3 s; movement only, never the hit test
    thumbT: 0.78, // the three rings of crystals at full bloom
    thumbFocus: [0, -24],
  },
  {
    id: "bolt",
    name: "LIGHTNING STRIKE",
    fx: boltFx,
    cost: 30,
    cd: 6,
    kind: "single",
    damage: 60,
    heavy: true, // same ceiling as the hammer: a lightning strike may stop the world for 0.14 s, not longer
    reach: Infinity, // "frontmost, distance ignored" (DESIGN §2.6)
    // The strike is re-chained at the target's x; no target means it still plays, centred 130 px out (a whiff).
    makeFx: (casterX, target) => makeBolt(target ? target.x - casterX : 130),
    thumbT: 0.92, // the bolt in the channel, one beat after it lands
    thumbFocus: [0, -52],
  },
  {
    id: "poison",
    name: "POISON CLOUD",
    fx: poisonCloud,
    cost: 26,
    cd: 7,
    kind: "zone",
    damage: 10, // per tick, DESIGN §2.6's 20 damage/s split into 0.5 s ticks
    // A loop effect has no act, so it is cast instantly; only the 0.3 s recovery is performed (M2a brief).
    recovery: 0.3,
    zone: { x: 220, left: 150, right: 300, duration: 5, tick: 0.5 },
    thumbT: 1.8, // the miasma at full body, not the thin first frame
    thumbFocus: [0, -20],
  },
  {
    id: "heal",
    name: "HOLY HEAL",
    fx: heal,
    cost: 40,
    cd: 12,
    kind: "heal",
    heal: 18, // the candle, capped at maxCandle; no damage
    thumbT: 0.7, // petals open and the hoop halfway up
    thumbFocus: [0, -24],
  },
];

const TIMINGS = SPELLS.map((s) => (s.kind === "zone" ? null : actTiming(s.fx)));

/** { windup, recovery, hits:[{t, freeze, shake, amp, push}] } for a spell index, straight from its act. */
export function timingOf(i) {
  return TIMINGS[i] ?? null;
}
