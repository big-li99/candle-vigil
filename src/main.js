// Boot + fixed-step loop. World updates at exactly 1/60 s; rendering follows requestAnimationFrame.
import { createRenderer, W, H } from "./frame.js";
import { createInput } from "./input.js";
import { createGame } from "./game.js";
import { createPlayground, initDebug } from "./debug.js";
import { painterFor, hex } from "../vendor/pixelfx/src/core/index.js";

const STEP = 1 / 60;
const MAX_STEPS = 4;

const canvas = document.getElementById("game");
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const game = createGame({ input });
const playground = createPlayground();
const stats = { fps: 0, hits: 0, kills: 0, freezes: 0 };

let paused = false;
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsAt = performance.now();

function togglePause() {
  paused = !paused;
}

function step(dt) {
  if (paused) {
    if (input.pressed("pause")) paused = false;
    input.clearEdges();
    return;
  }

  // P pauses the field or the fx playground; on the title any key simply starts the game.
  if ((playground || game.scene === "field") && input.pressed("pause")) {
    paused = true;
    input.clearEdges();
    return;
  }

  if (playground) playground.update(dt);
  else game.update(dt, input);
  input.clearEdges();
}

function drawPaused(frame) {
  const p = painterFor(frame);
  p.text("PAUSED", W / 2, 92, hex("#ffffff"), {
    font: "big",
    scale: 2,
    align: "center",
    outline: hex("#05070d"),
    shadow: hex("#0b1424"),
  });
  p.text("PRESS P TO RESUME", W / 2, 116, hex("#9fe8ff"), {
    font: "mini",
    align: "center",
    outline: hex("#05070d"),
  });
}

function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;

  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    step(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;

  fpsFrames++;
  if (now - fpsAt >= 1000) {
    stats.fps = Math.round((fpsFrames * 1000) / (now - fpsAt));
    fpsFrames = 0;
    fpsAt = now;
  }

  renderer.render((frame) => {
    if (playground) playground.draw(frame);
    else game.draw(frame);
    if (paused) drawPaused(frame);
  });

  requestAnimationFrame(tick);
}

window.addEventListener("blur", () => {
  if (!paused && (playground || game.scene === "field")) paused = true;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !paused && (playground || game.scene === "field")) paused = true;
});
window.addEventListener("focus", () => {
  last = performance.now();
  acc = 0;
});

initDebug({
  game,
  playground,
  renderer,
  stats,
  isPaused: () => paused,
  togglePause,
});

requestAnimationFrame(tick);
