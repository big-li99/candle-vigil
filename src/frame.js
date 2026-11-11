// The world buffer: one 384x216 frame, composited exactly once per rendered screen frame.
// Screen shake moves the canvas with a CSS transform, never the buffer, so game art stays pixel-crisp.
import { createFrame, clearFrame, composite, backdrop } from "../vendor/pixelfx/src/core/index.js";

export const W = 384;
export const H = 216;
export const GROUND = 196;

export function createRenderer(canvas) {
  if (!canvas) throw new Error("frame: missing canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const frame = createFrame(W, H);
  const image = ctx.createImageData(W, H);
  const backdropArray = backdrop("sky", W, H, GROUND);

  let scale = 1;
  let shakeX = 0;
  let shakeY = 0;

  function layout() {
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
    canvas.style.transform = shakeX || shakeY ? `translate(${shakeX * scale}px, ${shakeY * scale}px)` : "";
  }

  function resize() {
    const fit = Math.min(window.innerWidth / W, window.innerHeight / H);
    const next = Math.max(1, Math.floor(fit));
    if (next !== scale) {
      scale = next;
      layout();
    }
  }

  /** Offset the canvas in world pixels; the buffer itself never moves. */
  function setShake(x = 0, y = 0) {
    shakeX = Math.round(x);
    shakeY = Math.round(y);
    layout();
  }

  /** Clear, draw the world, composite color + light once over the backdrop, then blit. */
  function render(drawWorld) {
    clearFrame(frame);
    drawWorld(frame);
    composite(frame, image.data, backdropArray);
    ctx.putImageData(image, 0, 0);
  }

  /** The final RGBA pixels, for verification hooks (not for game art). */
  function readPixels() {
    return ctx.getImageData(0, 0, W, H);
  }

  if (typeof window !== "undefined") window.addEventListener("resize", resize);
  resize();
  layout();

  return {
    canvas,
    ctx,
    frame,
    render,
    resize,
    readPixels,
    setShake,
    getScale: () => scale,
  };
}
