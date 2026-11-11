// Verification hooks and the ?fx / ?autotest modes. Everything here reports real numbers measured at runtime.
import { createFx, createAct, painterFor, hex } from "../vendor/pixelfx/src/core/index.js";
import { get as getAsset } from "./assets.js";
import { W, H } from "./frame.js";

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
        fps: stats ? stats.fps : 0,
      };
    },
  };
}

/** Install window.__game, __report (~2.5 s after load) and the ?autotest run. */
export function initDebug({ game, playground, renderer, stats, isPaused, togglePause }) {
  const view = playground ?? game;

  window.__game = {
    snapshot: () => view.snapshot(stats),
    spawn: () => 0,
    cast: () => false,
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
      errorSamples: errors.slice(0, 5),
      warningSamples: warnings.slice(0, 5),
    };
  }

  window.__report = null;
  setTimeout(() => {
    window.__report = report();
    if (params.has("autotest")) window.__report.autotest = { result: "pending", reason: "" };
  }, 2500);

  if (params.has("autotest")) {
    // A scripted session: leave the title, then measure the running field.
    setTimeout(() => {
      if (game.scene === "title") game.enterField();
    }, 700);

    setTimeout(() => {
      const r = report();
      const reasons = [];
      if (r.consoleErrors !== 0) reasons.push(`${r.consoleErrors} console error(s)`);
      if (!(r.fps > 55)) reasons.push(`fps ${r.fps} <= 55`);
      if (r.canvas[0] !== W || r.canvas[1] !== H) reasons.push(`canvas ${r.canvas.join("x")} != ${W}x${H}`);
      if (r.cssScale !== Math.floor(r.cssScale) || r.cssScale < 1) reasons.push(`non-integer css scale ${r.cssScale}`);
      if (r.scene !== "field") reasons.push(`scene ${r.scene} != field`);
      if (r.pixels.topLeft <= 0) reasons.push("no HUD pixels in top-left band");

      const pass = reasons.length === 0;
      document.body.dataset.autotest = pass ? "pass" : "fail";
      document.body.dataset.autotestReason = pass ? "ok" : reasons.join("; ");
      if (window.__report) {
        window.__report.autotest = {
          result: pass ? "pass" : "fail",
          reason: pass ? "ok" : reasons.join("; "),
        };
      }
    }, 3400);
  }
}
