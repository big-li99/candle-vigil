// A wave transition, played in 0.85 s from the vendored `transitions/slash-wipe` (cold blue, not iris — that is
// M3's ending). The library's screen transitions are authored for a 320 x 180 stage; the game is 384 x 216, so
// the transition renders into its own small frame and is sampled up 5:6 into the world buffer. Nearest-neighbour
// only, so the art stays crisp. The module's own timeline is compressed to the brief's 0.6–1 s.
import { createFrame, clearFrame, painterFor, resolveOptions } from "../../vendor/pixelfx/src/core/index.js";
import { get as getAsset } from "../assets.js";
import { W, H } from "../frame.js";

const SRC_W = 320;
const SRC_H = 180;
export const TRANSITION_TIME = 0.85;

const xs = new Int32Array(W);
const ys = new Int32Array(H);
for (let x = 0; x < W; x++) xs[x] = Math.min(SRC_W - 1, Math.floor((x * SRC_W) / W));
for (let y = 0; y < H; y++) ys[y] = Math.min(SRC_H - 1, Math.floor((y * SRC_H) / H));

/** Add two packed ABGR light values channel by channel (the painter stores light as additive ABGR). */
function addLight(a, b) {
  const r = Math.min(255, (a & 255) + (b & 255));
  const g = Math.min(255, ((a >>> 8) & 255) + ((b >>> 8) & 255));
  const bl = Math.min(255, ((a >>> 16) & 255) + ((b >>> 16) & 255));
  return (255 << 24) | (bl << 16) | (g << 8) | r;
}

export function createTransition(mod = getAsset("transitions/slash-wipe"), time = TRANSITION_TIME) {
  const src = createFrame(SRC_W, SRC_H);
  let impl = null;
  let opts = null;
  let speed = 1;
  let left = 0;

  function start(seed = 3) {
    const meta = mod.meta ?? {};
    opts = resolveOptions(meta, { seed });
    impl = mod.create ? mod.create(opts) : null;
    speed = (meta.duration ?? time) / time; // compress the module's whole timeline into `time`
    left = time;
  }

  function update(dt) {
    if (left <= 0) return;
    left = Math.max(0, left - dt);
    if (impl?.update) impl.update(dt * speed);
  }

  function draw(frame) {
    if (left <= 0) return;
    clearFrame(src);
    const p = painterFor(src);
    p.place(0, 0);
    if (impl) impl.draw(p);
    else mod.draw(p, (1 - left / time) * (mod.meta?.duration ?? time), opts);

    // nearest-neighbour 5:6 upscale; a set colour also erases the glow under it (the cover hides the scene),
    // while a pure glint adds to the scene it is drawn over
    for (let y = 0; y < H; y++) {
      const srow = ys[y] * SRC_W;
      const drow = y * W;
      for (let x = 0; x < W; x++) {
        const si = srow + xs[x];
        const di = drow + x;
        const c = src.color[si];
        if (c) {
          frame.color[di] = c;
          frame.light[di] = src.light[si];
        } else if (src.light[si]) {
          frame.light[di] = addLight(frame.light[di], src.light[si]);
        }
      }
    }
  }

  return {
    start,
    update,
    draw,
    get active() {
      return left > 0;
    },
  };
}
