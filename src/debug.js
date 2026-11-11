// Verification hooks and the ?fx / ?autotest modes. Everything here reports real numbers measured at runtime.
import { createFx, createAct, painterFor, hex } from "../vendor/pixelfx/src/core/index.js";
import { get as getAsset } from "./assets.js";
import { W, H } from "./frame.js";
import { NUMBER_FILL } from "./systems/combat.js";

const params = new URLSearchParams(location.search);
const errors = [];
const warnings = [];

const rawError = console.error.bind(console);
const rawWarn = console.warn.bind(console);
const fmt = (args) => args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");

console.error = (...args) => {
  errors.push(fmt(args));
  rawError(...args);
};
console.warn = (...args) => {
  warnings.push(fmt(args));
  rawWarn(...args);
};
window.addEventListener("error", (e) => errors.push(e.message || "window error"));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason ?? "unhandled rejection")));

/** The ?fx=<category>/<name> playground, or null when the query has no fx id. */
export function createPlayground() {
  const id = params.get("fx");
  if (!id) return null;

  const mod = getAsset(id);
  const meta = mod?.meta ?? null;
  const isAct = !!mod?.act;
  let inst = null;

  function stage() {
    if (!mod) return;
    const opts = { x: W / 2, y: H / 2, seed: 3 };
    inst = isAct ? createAct(mod, opts) : createFx(mod, opts);
  }
  stage();

  function draw(frame) {
    if (inst) {
      if (isAct) inst.draw(frame, { target: false });
      else {
        inst.draw(frame, "back");
        inst.draw(frame, "front");
      }
    }

    const p = painterFor(frame);
    const lines = mod
      ? [
          `FX ${id.toUpperCase()}`,
          `NAME ${String(meta.name).toUpperCase()}`,
          `${meta.loop ? "LOOP" : "ONE SHOT"}  DUR ${meta.duration}S  SIZE ${meta.size[0]}X${meta.size[1]}`,
        ]
      : [`FX ${id.toUpperCase()}`, "UNKNOWN EFFECT"];

    let width = 0;
    for (const line of lines) width = Math.max(width, p.measure(line, { font: "mini" })[0]);
    width += 12;
    const height = lines.length * 7 + 6;
    p.rect(6, 4, width, height, hex("#080d16"), 0.94);
    p.rect(6, 4, width, 1, hex("#24395b"));
    p.rect(6, height + 3, width, 1, hex("#0d1626"));
    lines.forEach((line, i) => {
      p.text(line, 12, 8 + i * 7, hex(i === 0 ? "#dceaff" : i === 1 ? "#ffcf7a" : "#9fb6d8"), { font: "mini" });
    });
  }

  return {
    scene: "fx",
    id,
    update(dt) {
      if (!inst) return;
      inst.update(dt);
      if (inst.done()) stage();
    },
    draw,
    entityCount: () => 0,
    snapshot(stats) {
      return {
        scene: "fx",
        fx: id,
        wave: 0,
        candle: 0,
        mana: 0,
        enemies: [],
        casting: false,
        cooldowns: [],
        fps: stats ? stats.fps : 0,
      };
    },
  };
}

/** Install window.__game, __report (~2.5 s after load) and the ?autotest run. */
export function initDebug({ game, playground, renderer, stats, isPaused, togglePause }) {
  const view = playground ?? game;
  const live = playground ? null : game; // the field's actions, or nothing in the fx playground

  window.__game = {
    snapshot: () => view.snapshot(stats),
    spawn: (type = "slime", n = 1, x) => (live ? live.spawn(type, n, x) : 0),
    cast: (i = 0) => (live ? live.cast(i) : false),
    setWave: (n) => game.setWave(n),
    skipUpgrade: () => false,
    god: (on) => {
      game.state.god = !!on;
      return game.state.god;
    },
    pause: () => {
      togglePause();
      return isPaused();
    },
    stats,
  };

  function report() {
    const px = renderer.readPixels().data;
    let lit = 0;
    let topLeft = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const j = (y * W + x) * 4;
        if (px[j] + px[j + 1] + px[j + 2] > 90) {
          lit++;
          if (x < 200 && y < 44) topLeft++;
        }
      }
    }
    return {
      fps: stats.fps,
      consoleErrors: errors.length,
      consoleWarnings: warnings.length,
      entities: view.entityCount(),
      scene: view.scene,
      canvas: [renderer.canvas.width, renderer.canvas.height],
      pixels: { lit, topLeft },
      cssScale: renderer.getScale(),
      stats: {
        hits: stats.hits,
        kills: stats.kills,
        freezes: stats.freezes,
        interrupts: stats.interrupts || 0,
        combo: stats.combo,
        bestCombo: stats.bestCombo,
        damageNumberPixels: stats.damageNumberPixels || 0,
      },
      errorSamples: errors.slice(0, 5),
      warningSamples: warnings.slice(0, 5),
    };
  }

  window.__report = null;
  setTimeout(() => {
    window.__report = report();
    if (params.has("autotest")) window.__report.autotest = { result: "pending", reason: "" };
  }, 2500);

  if (params.has("autotest")) runAutotest({ game, playground, renderer, stats, report });

  return { report };
}

/**
 * The scripted M1.5 session, in two measured acts:
 *   1. one slime inside sword reach is killed by one cast (one number, one spark, kills + 1);
 *   2. a slime bites during a hammer wind-up, the cast is interrupted, and the very next cast still lands
 *      (the armor rule) — the exact deadlock M1 shipped with.
 * Every assertion is a measured number: counters the game incremented, the world buffer's own pixels, the
 * canvas transform.
 */
function runAutotest({ game, playground, renderer, stats, report }) {
  if (playground) return;

  const killsBefore = stats.kills;
  const interruptsBefore = stats.interrupts || 0;
  let nearKilled = false;
  let guardSpawned = false;
  let hammerCast = false;
  let sawInterrupt = false;
  let hitsAfterInterrupt = 0;
  let followUpCast = false;
  let followUpLanded = false;

  setTimeout(() => {
    if (game.scene === "title") game.enterField();
  }, 400);

  // A slime well inside sword reach (56 + 140 = 196), so the fight does not depend on walking distance.
  setTimeout(() => {
    if (game.scene === "field") game.spawn("slime", 1, 160);
  }, 500);

  // Press "1" until the near slime dies; a refused cast costs nothing.
  const caster = setInterval(() => {
    if (game.scene === "field" && !nearKilled) game.cast(0);
  }, 150);

  // Once the near kill is measured, put one slime on the guard line. Its first bite is due 0.6 s later;
  // the director casts the slow hammer just before it, so the bite lands inside the wind-up, then casts the
  // fast slash as soon as the interrupt counter moves.
  setTimeout(() => {
    if (game.scene !== "field") return;
    game.spawn("slime", 1, 124);
    guardSpawned = true;
  }, 2500);

  const director = setInterval(() => {
    if (game.scene !== "field") return;
    if (!nearKilled && stats.kills > killsBefore) nearKilled = true;

    if (guardSpawned && nearKilled && !hammerCast) {
      for (const e of game.enemies) {
        if (e.dead) continue;
        // biteIn is the front slime's own countdown, so this is deterministic rather than a guessed delay
        if (e.biteIn < 0.1 && game.player.phase === "idle" && game.cast(1)) {
          hammerCast = true;
          break;
        }
      }
    }
    if (hammerCast && !sawInterrupt && stats.interrupts > interruptsBefore) {
      sawInterrupt = true;
      hitsAfterInterrupt = stats.hits;
    }
    if (sawInterrupt && !followUpCast && game.cast(0)) followUpCast = true;
    if (followUpCast && !followUpLanded && stats.hits > hitsAfterInterrupt) followUpLanded = true;
  }, 16);

  // Damage numbers are measured, not assumed: count the digits' own fill color inside the box combat
  // reported for the number it just drew. The world buffer is read when the renderer exposes it (the light
  // buffer is added later at composite time, so the colour there is exactly what p.text wrote); the canvas
  // is the fallback, with a tolerance because glow is added on top of it.
  const fillR = NUMBER_FILL & 255;
  const fillG = (NUMBER_FILL >>> 8) & 255;
  const fillB = (NUMBER_FILL >>> 16) & 255;
  const fillU = NUMBER_FILL >>> 0; // the colour buffer is Uint32 and the constant is a signed int32
  const probe = setInterval(() => {
    const combat = game.combat;
    if (!combat || typeof combat.numberBoxes !== "function") return;
    const boxes = combat.numberBoxes();
    if (!boxes.length) return;
    const world = renderer.frame;
    const canvasPx = world ? null : renderer.readPixels().data;
    let n = 0;
    for (const b of boxes) {
      const x1 = Math.max(0, b.x);
      const x2 = Math.min(W, b.x + b.w);
      const y1 = Math.max(0, b.y);
      const y2 = Math.min(H, b.y + b.h);
      for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
          if (world) {
            const wx = x - (world.ox | 0);
            const wy = y - (world.oy | 0);
            if (wx >= 0 && wy >= 0 && wx < world.w && wy < world.h && world.color[wy * world.w + wx] === fillU) n++;
          } else {
            const j = (y * W + x) * 4;
            if (Math.abs(canvasPx[j] - fillR) < 8 && Math.abs(canvasPx[j + 1] - fillG) < 8 && Math.abs(canvasPx[j + 2] - fillB) < 8) n++;
          }
        }
      }
    }
    if (n > (stats.damageNumberPixels || 0)) stats.damageNumberPixels = n;
  }, 80);

  setTimeout(() => {
    clearInterval(caster);
    clearInterval(director);
    clearInterval(probe);

    const r = report();
    const reasons = [];
    if (r.consoleErrors !== 0) reasons.push(`${r.consoleErrors} console error(s)`);
    if (!(r.fps > 55)) reasons.push(`fps ${r.fps} <= 55`);
    if (r.canvas[0] !== W || r.canvas[1] !== H) reasons.push(`canvas ${r.canvas.join("x")} != ${W}x${H}`);
    if (r.cssScale !== Math.floor(r.cssScale) || r.cssScale < 1) reasons.push(`non-integer css scale ${r.cssScale}`);
    if (r.scene !== "field") reasons.push(`scene ${r.scene} != field`);
    if (r.pixels.topLeft <= 0) reasons.push("no HUD pixels in top-left band");
    // M1.5 feel assertions
    if (!nearKilled) reasons.push("near target was not killed (kills did not increase)");
    if (!(stats.kills >= 1)) reasons.push(`kills ${stats.kills} < 1`);
    if (!(stats.hits >= 1)) reasons.push(`hits ${stats.hits} < 1`);
    if (!(stats.freezes >= 1)) reasons.push(`freezes ${stats.freezes} < 1`);
    if (!(stats.damageNumberPixels > 0)) reasons.push("no damage-number pixels on the canvas");
    if (!sawInterrupt) reasons.push("no bite interrupted a wind-up (interrupt path not exercised)");
    if (sawInterrupt && !followUpLanded) reasons.push("cast after bite interrupt did not land (stats.hits did not increase)");
    // the shake must have fully released: renderer.setShake(0, 0) leaves no transform behind
    if (renderer.canvas.style.transform !== "") reasons.push(`canvas transform "${renderer.canvas.style.transform}" not cleared`);

    const pass = reasons.length === 0;
    document.body.dataset.autotest = pass ? "pass" : "fail";
    document.body.dataset.autotestReason = pass ? "ok" : reasons.join("; ");
    if (window.__report) {
      window.__report.consoleErrors = errors.length;
      window.__report.fps = stats.fps;
      window.__report.stats = {
        hits: stats.hits,
        kills: stats.kills,
        freezes: stats.freezes,
        interrupts: stats.interrupts || 0,
        combo: stats.combo,
        bestCombo: stats.bestCombo,
        damageNumberPixels: stats.damageNumberPixels || 0,
      };
      window.__report.candle = game.snapshot(stats).candle;
      window.__report.autotest = {
        result: pass ? "pass" : "fail",
        reason: pass ? "ok" : reasons.join("; "),
        nearTargetKilled: nearKilled,
        castAfterInterrupt: followUpLanded,
      };
    }
  }, 6500);
}
