// The lightning strike is a plain effect (no `act` of its own), but the game's casting rules read every hit
// window from actTiming(). The library already pairs it with a caster act in moves/lightning-call.js: that move
// is the data source for the poses and the hit window. We only re-chain the same strike at a chosen offset, so
// the bolt lands on the frontmost enemy instead of the move's fixed target at +130 px. Vendor stays untouched.
import { chain } from "../../vendor/pixelfx/src/core/index.js";
import * as lightningCall from "../../vendor/pixelfx/src/fx/moves/lightning-call.js";
import * as strike from "../../vendor/pixelfx/src/fx/lightning/lightning-strike.js";

export const meta = { ...lightningCall.meta, name: "Lightning strike" };
export const act = lightningCall.act;

/** A lightning act whose bolt comes down `dx` px to the right of the caster. */
function make(dx) {
  return { meta, act, create: chain([{ fx: strike, t: 0, x: dx }]) };
}

/** The icon/preview version: the bolt centred on the caster. */
export const boltFx = make(0);

/** The performed version: dx is measured from the caster, so the strike lands where the target stands. */
export function makeBolt(dx) {
  return make(Math.max(0, dx));
}
