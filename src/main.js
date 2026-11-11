// Boot + fixed-step loop. World updates at exactly 1/60 s; rendering follows requestAnimationFrame.
import { createRenderer, W, H } from "./frame.js";
import { createInput } from "./input.js";
import { createGame } from "./game.js";
import { createAudio } from "./audio.js";
import { createPlayground, initDebug } from "./debug.js";
import { painterFor, hex } from "../vendor/pixelfx/src/core/index.js";

const STEP = 1 / 60;
const MAX_STEPS = 4;

const canvas = document.getElementById("game");
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const stats = { fps: 0, hits: 0, kills: 0, freezes: 0, combo: 0, bestCombo: 0 };
const audio = createAudio();
const game = createGame({ input, renderer, stats, audio });
const playground = createPlayground();

// Browsers only allow an AudioContext to start after a gesture. The first key or click of the session creates
// and resumes it; every later sound is scheduled on the live context.
window.addEventListener("keydown", () => audio.unlock());
window.addEventListener("pointerdown", () => audio.unlock(), true);

let paused = false;
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsAt = performance.now();

function togglePause() {
  if (paused) paused = false;
  else pauseNow();
}

/** Pausing mid-shake would leave the canvas offset for good, so the pause always releases the shake. */
function pauseNow() {
  if (paused) return;
  paused = true;
  renderer.setShake(0, 0);
}

function step(dt) {
  // The mute switch belongs to the session, not to the field: it works on the title, during a run and while
  // paused, and it never doubles as the title's "any key".
  if (input.pressed("mute")) {
    audio.toggleMute();
    input.clearEdges();
    return;
  }

  if (paused) {
    // Pausing stops the world, not the picture: the snow, candle and torches keep their own animation.
    if (playground) playground.update(dt);
    else game.updateAmbient(dt);
    if (input.pressed("pause")) paused = false;
    input.clearEdges();
    return;
  }

  // P pauses the field or the fx playground; on the title any key simply starts the game, and the result pages
  // consume any key themselves (their "any key" must not be stolen by the pause).
  if ((playground || game.canPause) && input.pressed("pause")) {
    pauseNow();
    input.clearEdges();
    return;
  }

  if (playground) playground.update(dt);
  else game.update(dt, input);
  input.clearEdges();
}

function drawPaused(frame) {
  const p = painterFor(frame);
  // dim the frozen world first, then the existing PAUSED copy stays crisp on top of it
  p.rect(0, 0, W, H, hex("#05070d"), 0.55);
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
  if (playground || game.canPause) pauseNow();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (playground || game.canPause)) pauseNow();
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
