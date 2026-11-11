// The two spells of M1, as data. Timing is deliberately absent: windup, hit windows, hit-stop, shake and
// recovery are read from each effect's own act (CLAUDE.md rule 5), so the animation stays the source of truth.
import { actTiming } from "../../vendor/pixelfx/src/core/index.js";
import * as swordSlash from "../../vendor/pixelfx/src/fx/melee/sword-slash.js";
import * as hammerSmash from "../../vendor/pixelfx/src/fx/melee/hammer-smash.js";

export const SPELLS = [
  {
    id: "slash",
    name: "SWORD SLASH",
    fx: swordSlash,
    cost: 10,
    cd: 0.6,
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
    damage: 26,
    knock: 20,
    reach: 150,
    thumbT: 0.30, // the dome of force with its rocks in the air: the one frame that says "smash"
    thumbFocus: [24, -14],
  },
];

const TIMINGS = SPELLS.map((s) => actTiming(s.fx));

/** { windup, recovery, hits:[{t, freeze, shake, amp, push}] } for a spell index, straight from its act. */
export function timingOf(i) {
  return TIMINGS[i] ?? null;
}
