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
    pickCard: (i = 0) => (live ? live.pickCard(i) : false),
    skipUpgrade: () => (live ? live.skipUpgrade() : false),
    block: () => (live ? live.block() : false),
    god: (on) => {
      game.state.god = !!on;
      return game.state.god;
    },
    /** Test setup only: put the candle at a known value so the heal check can start from 50. */
    candle: (v) => {
      if (!live) return 0;
      const n = Math.max(0, Math.min(game.state.maxCandle, Number(v)));
      if (Number.isFinite(n)) game.state.candle = n;
      return game.state.candle;
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
        blocks: stats.blocks || 0,
        cardsPicked: stats.cardsPicked || 0,
        wavesCleared: stats.wavesCleared || 0,
        combo: stats.combo,
        bestCombo: stats.bestCombo,
        damageNumberPixels: stats.damageNumberPixels || 0,
        numbersShown: stats.numbersShown || 0,
        numbersCapped: stats.numbersCapped || 0,
        maxNumbers: stats.maxNumbers || 0,
        maxNumberBoxes: stats.maxNumberBoxes || 0,
        killsByType: stats.killsByType || {},
        deathFx: stats.deathFx || {},
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

  if (params.has("autotest")) {
    // The scripted run owns the field; the placeholder spawner would otherwise add slimes between assertions.
    if (!playground) game.state.spawnPaused = true;
    runAutotest({ game, playground, renderer, stats, report });
  }

  return { report };
}

/**
 * The scripted M2a session. It keeps the M1.5 feel checks (a near kill, an interrupt in a wind-up, and the
 * very next cast still landing) and adds measured checks for the six spells, the four enemies, the poison
 * immunity and an eight-body frame. Only a real browser can judge the picture; every number below is read
 * back from the running game, never assumed.
 *
 * The test owns the field: the placeholder spawner is paused, mana is topped up before a cast so a long
 * script can afford six spells, and two cooldowns are cleared for repeat casts (the whiff and the heal cap).
 * Every cost and cooldown it reports is still measured across the real game.cast() call, before any world
 * step could regenerate mana.
 */
function runAutotest({ game, playground, renderer, stats, report }) {
  if (playground) return;

  const errorsAtStart = errors.length;
  const castable = [false, false, false, false, false, false];
  const costs = [null, null, null, null, null, null];
  const cooldowns = [0, 0, 0, 0, 0, 0];
  const flags = {
    nearKilled: false,
    hammerCast: false,
    sawInterrupt: false,
    followUpCast: false,
    followUpLanded: false,
    novaCast: false,
    novaKills: 0,
    maxNovaNumbers: 0,
    boltCast: false,
    boltFarKill: false,
    whiffCast: false,
    whiffPlaying: false,
    whiffDone: false,
    whiffNoHits: false,
    poisonCast: false,
    poisonCastPhase: "",
    poisonSlimeDamaged: false,
    poisonGhostUnhurt: false,
    poisonTicks: 0,
    ghostKilled: false,
    healCast: false,
    healFrom50: null,
    healCapCast: false,
    healCap: null,
    types: {},
    mixedAlive: 0,
    mixedFps: 0,
    mixedErrors: 0,
    // M2b: waves, cards, block
    waveStart: false,
    waveSpawnInterval: 0,
    waveCleared: false,
    cardsShown: [],
    cardsUnique: false,
    cardsAfterPick: -1,
    candleBreath: null,
    cardPicked: false,
    cardChangedMods: false,
    waveAfterCard: 0,
    modsAfterCard: null,
    focusCd: null,
    capSix: 0,
    capSixHeld: 0,
    capEight: 0,
    wave8Fps: 0,
    wave4: false,
    blockPressed: false,
    blockAbsorbed: false,
    blockCandleHeld: false,
    blockCastHeld: false,
    blockNoInterrupt: false,
    blockSecondRefused: false,
    blockCd: 0,
    blockEffects: 0,
  };
  let finished = false;
  let hard = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => game.snapshot(stats);
  const alive = (type) => game.enemies.filter((e) => !e.dead && (!type || e.type === type));

  async function waitFor(cond, timeoutMs, tick) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      if (tick) tick();
      if (cond()) return true;
      await sleep(16);
    }
    return !!cond();
  }

  /** A cast with its cost and cooldown measured across it; mana is topped up first so the script can afford it. */
  function startCast(i) {
    game.state.mana = 100;
    const before = snap();
    const ok = game.cast(i);
    const after = snap();
    if (ok) {
      castable[i] = true;
      costs[i] = Math.round((before.mana - after.mana) * 100) / 100;
      cooldowns[i] = after.cooldowns[i] ?? 0;
    }
    return ok;
  }

  // Damage numbers are measured, not assumed: count the digits' own fill colour inside the box combat
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
    if (boxes.length > (stats.maxNumberBoxes || 0)) stats.maxNumberBoxes = boxes.length;
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

  function finish(reasons) {
    if (finished) return;
    finished = true;
    clearInterval(probe);
    if (hard) clearTimeout(hard);
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
        blocks: stats.blocks || 0,
        cardsPicked: stats.cardsPicked || 0,
        wavesCleared: stats.wavesCleared || 0,
        combo: stats.combo,
        bestCombo: stats.bestCombo,
        damageNumberPixels: stats.damageNumberPixels || 0,
        numbersShown: stats.numbersShown || 0,
        numbersCapped: stats.numbersCapped || 0,
        maxNumbers: stats.maxNumbers || 0,
        maxNumberBoxes: stats.maxNumberBoxes || 0,
        killsByType: stats.killsByType || {},
        deathFx: stats.deathFx || {},
      };
      window.__report.candle = game.snapshot(stats).candle;
      window.__report.autotest = {
        result: pass ? "pass" : "fail",
        reason: pass ? "ok" : reasons.join("; "),
        flags,
      };
    }
  }

  hard = setTimeout(() => {
    finish([`autotest timed out after 110 s (scene ${game.scene}, phase ${game.player.phase})`]);
  }, 110000);

  (async () => {
    try {
      // --- M1.5 baseline: near kill, interrupt in the wind-up, next cast lands ----------
      await sleep(400);
      if (game.scene === "title") game.enterField();
      await sleep(80);

      const kills0 = stats.kills;
      game.spawn("slime", 1, 160);
      flags.nearKilled = await waitFor(
        () => {
          if (game.player.phase !== "idle") return false;
          if (!castable[0]) startCast(0);
          return stats.kills > kills0;
        },
        5000,
      );

      game.spawn("slime", 1, 124);
      const interrupts0 = stats.interrupts || 0;
      const ready = await waitFor(() => {
        const s = alive("slime").find((e) => e.biteIn < 0.12);
        return !!s && game.player.phase === "idle";
      }, 5000);
      if (ready) flags.hammerCast = startCast(1);
      flags.sawInterrupt = flags.hammerCast && (await waitFor(() => (stats.interrupts || 0) > interrupts0, 2000));
      if (flags.sawInterrupt) {
        const hits0 = stats.hits;
        flags.followUpCast = await waitFor(() => {
          if (game.player.phase !== "idle") return false;
          return startCast(0);
        }, 2000);
        if (flags.followUpCast) flags.followUpLanded = await waitFor(() => stats.hits > hits0, 2500);
      }
      await waitFor(() => alive().length === 0, 2500);

      // --- frost nova: three slimes side by side, one cast, three numbers --------------
      game.state.god = true;
      await waitFor(() => game.player.phase === "idle", 2000);
      const novaKills0 = stats.kills;
      game.spawn("slime", 3, 180);
      await sleep(40);
      flags.novaCast = startCast(2);
      await waitFor(() => stats.kills >= novaKills0 + 3, 3000, () => {
        flags.maxNovaNumbers = Math.max(flags.maxNovaNumbers, game.combat.numberBoxes().length);
      });
      flags.novaKills = stats.kills - novaKills0;
      if (game.player.phase === "cast") game.player.cancel("autotest");
      await waitFor(() => game.player.phase === "idle", 1500);

      // --- bolt: the farthest enemy is hit; an empty cast still plays out -------------
      await waitFor(() => alive().length === 0, 2000);
      const boltKills0 = stats.kills;
      game.spawn("slime", 1, 350);
      await sleep(40);
      flags.boltCast = startCast(3);
      flags.boltFarKill = await waitFor(() => stats.kills > boltKills0, 3000);
      if (game.player.phase === "cast") game.player.cancel("autotest");
      await waitFor(() => game.player.phase === "idle", 1500);

      game.player.cooldowns[3] = 0; // test-only: the real cooldown was measured above; this one is the whiff
      const whiffHits0 = stats.hits;
      flags.whiffCast = startCast(3);
      await sleep(1000);
      flags.whiffPlaying = game.player.phase === "cast";
      flags.whiffDone = await waitFor(() => game.player.phase === "idle", 3500);
      flags.whiffNoHits = stats.hits === whiffHits0;

      // --- poison: the slime loses hp in the cloud, the ghost walks through untouched --
      await waitFor(() => alive().length === 0, 2000);
      game.spawn("slime", 1, 220);
      game.spawn("ghost", 1, 230);
      await sleep(40);
      const slime0 = alive("slime")[0];
      const ghost0 = alive("ghost")[0];
      const slimeHp0 = slime0 ? slime0.hp : -1;
      const ghostHp0 = ghost0 ? ghost0.hp : -1;
      flags.poisonCast = startCast(4);
      flags.poisonCastPhase = game.player.phase; // "recover": a loop effect has no act
      const hitsBeforePoison = stats.hits;
      await sleep(2000);
      const slimeNow = alive("slime")[0];
      const ghostNow = alive("ghost")[0];
      flags.poisonSlimeDamaged = !slimeNow || slimeNow.hp < slimeHp0;
      flags.poisonGhostUnhurt = !!ghostNow && ghostNow.hp === ghostHp0;
      flags.poisonTicks = stats.hits - hitsBeforePoison;

      const ghostKills0 = stats.killsByType.ghost ?? 0;
      for (let tries = 0; tries < 8 && alive("ghost").length; tries++) {
        await waitFor(() => game.player.phase === "idle", 1500);
        if (startCast(0)) await waitFor(() => alive("ghost").length === 0, 1800);
        else await sleep(80);
      }
      flags.ghostKilled = (stats.killsByType.ghost ?? 0) > ghostKills0;

      // --- heal: 50 -> 68, and never past the cap ------------------------------------
      await waitFor(() => alive().length === 0, 2000);
      await waitFor(() => game.player.phase === "idle", 1500);
      game.state.candle = 50;
      flags.healCast = startCast(5);
      await sleep(60);
      flags.healFrom50 = snap().candle;
      if (game.player.phase === "cast") game.player.cancel("autotest");
      await waitFor(() => game.player.phase === "idle", 1000);
      game.state.candle = 95;
      game.player.cooldowns[5] = 0; // test-only: the cap check is a second heal inside the 12 s cooldown
      flags.healCapCast = startCast(5);
      await sleep(60);
      flags.healCap = snap().candle;
      if (game.player.phase === "cast") game.player.cancel("autotest");
      await waitFor(() => game.player.phase === "idle", 1000);

      // --- every enemy type: spawn, correct hp/y, kill it with a real spell -----------
      for (const type of ["slime", "ghost", "skull", "eyeball"]) {
        await waitFor(() => alive().length === 0, 2000);
        await waitFor(() => game.player.phase === "idle", 1500);
        const killsBefore = stats.killsByType[type] ?? 0;
        const n = game.spawn(type, 1, 150);
        await sleep(40);
        const info = snap().enemies.find((e) => e.type === type);
        const rec = { spawned: n === 1 && !!info, hp: info ? info.hp : null, y: info ? info.y : null, killed: false, deathFx: null };
        for (let tries = 0; tries < 8 && !rec.killed; tries++) {
          await waitFor(() => game.player.phase === "idle", 1500);
          if (startCast(0)) {
            rec.killed = await waitFor(
              () => alive(type).length === 0 && (stats.killsByType[type] ?? 0) > killsBefore,
              1800,
            );
          } else await sleep(80);
        }
        rec.deathFx = stats.deathFx[type] ?? null;
        flags.types[type] = rec;
      }

      // --- eight mixed bodies, one second of real frames -----------------------------
      await waitFor(() => alive().length === 0, 2000);
      await waitFor(() => game.player.phase === "idle", 1500);
      const mix = ["slime", "ghost", "skull", "eyeball", "slime", "ghost", "skull", "eyeball"];
      for (let i = 0; i < mix.length; i++) game.spawn(mix[i], 1, 200 + (i % 4) * 30);
      await sleep(300);
      flags.mixedAlive = alive().length;
      await sleep(1600);
      flags.mixedFps = stats.fps;
      flags.mixedErrors = errors.length - errorsAtStart;

      // --- M2b: wave 1 spawns at its table's cadence, then clears into the intermission ---
      await waitFor(() => alive().length === 0, 2000);
      game.state.candle = 50; // no bites land (god is still on), so the intermission's +8 is exact
      game.setWave(1);
      game.state.spawnPaused = false;
      const firstWave = await waitFor(() => alive().length >= 1, 3000);
      const firstAt = performance.now();
      const secondWave = await waitFor(() => alive().length >= 2, 4000);
      const secondAt = performance.now();
      flags.waveSpawnInterval = secondWave ? Math.round(secondAt - firstAt) : -1;
      flags.waveStart = firstWave && secondWave && snap().wave === 1 && snap().waveState === "spawning";

      // kill each body as it appears; the wave ends only when the queue is spent and the field is empty
      const cleared = await waitFor(() => game.waveState === "intermission", 16000, () => {
        for (const e of alive()) e.hurt(999, 0);
      });
      flags.waveCleared = cleared;
      const inter = snap();
      flags.cardsShown = inter.cards.slice();
      flags.cardsUnique = inter.cards.length === 3 && new Set(inter.cards).size === 3;
      flags.candleBreath = inter.candle;

      // --- M2b: a card really applies, and FOCUS really shortens the slash cooldown --------
      const modsBefore = snap().mods;
      flags.cardPicked = window.__game.pickCard(0);
      const afterCard = snap();
      flags.cardsAfterPick = afterCard.cards.length;
      flags.waveAfterCard = afterCard.wave;
      flags.modsAfterCard = afterCard.mods;
      flags.cardChangedMods = JSON.stringify(modsBefore) !== JSON.stringify(afterCard.mods);
      game.state.spawnPaused = true; // hold wave 2 while the cooldown is measured

      await waitFor(() => game.player.phase === "idle", 2000);
      const focusApplied = game.upgrades.apply("focus");
      game.player.cooldowns[0] = 0; // test-only: a clean slash cooldown to measure focus against
      game.state.mana = 100;
      const slashCast = game.player.cast(0);
      const focused = snap();
      flags.focusMult = focused.mods.cdMult;
      flags.focusCd = focusApplied && slashCast ? focused.cooldowns[0] : null;
      if (game.player.phase === "cast") game.player.cancel("autotest");
      await waitFor(() => game.player.phase === "idle", 1500);

      // --- M2b: the living cap holds; wave 8 allows eight bodies at 60 fps -----------------
      game.state.spawnPaused = true;
      game.setWave(2);
      for (let i = 0; i < 6; i++) game.spawn("slime", 1, 300);
      game.state.spawnPaused = false;
      await sleep(400);
      flags.capSix = alive().length;
      await sleep(2700); // longer than wave 2's 2.4 s interval: the due spawn has to wait
      flags.capSixHeld = alive().length;
      game.state.spawnPaused = true;

      game.setWave(8);
      for (let i = 0; i < mix.length; i++) game.spawn(mix[i], 1, 200 + (i % 4) * 30);
      game.state.spawnPaused = false;
      await sleep(300);
      flags.capEight = alive().length;
      await sleep(1600);
      flags.wave8Fps = stats.fps;
      game.state.spawnPaused = true;

      // the wave counter the HUD prints is the live state.wave
      game.setWave(4);
      flags.wave4 = snap().wave === 4 && snap().waveState === "spawning";

      // --- M2b: Space catches a bite inside a wind-up --------------------------------------
      game.setWave(1); // clears the field
      game.state.god = false;
      await waitFor(() => game.player.phase === "idle", 2000);
      game.state.candle = 80;
      game.state.mana = 100;
      game.player.cooldowns.fill(0);
      const blockInterrupts0 = stats.interrupts || 0;
      const blockStats0 = stats.blocks || 0;
      game.spawn("slime", 1, 124);
      game.player.cast(3); // bolt: its first hit is at 0.76 s, so a bite at 0.6 s is inside the wind-up
      const near = await waitFor(() => {
        const s = alive("slime")[0];
        return !!s && s.biteIn < 0.2;
      }, 4000);
      if (near) flags.blockPressed = game.block();
      await sleep(420);
      const bs = snap();
      flags.blockAbsorbed = (stats.blocks || 0) === blockStats0 + 1;
      flags.blockCandleHeld = bs.candle === 80;
      flags.blockCastHeld = game.player.phase === "cast" || game.player.phase === "recover";
      flags.blockNoInterrupt = (stats.interrupts || 0) === blockInterrupts0;
      flags.blockCd = bs.block.cd;
      flags.blockEffects = game.combat.effectCount();
      flags.blockSecondRefused = game.block() === false;

      // --- final measured verdict ----------------------------------------------------
      const r = report();
      const reasons = [];
      if (r.consoleErrors !== 0) reasons.push(`${r.consoleErrors} console error(s)`);
      if (!(r.fps > 55)) reasons.push(`fps ${r.fps} <= 55`);
      if (r.canvas[0] !== W || r.canvas[1] !== H) reasons.push(`canvas ${r.canvas.join("x")} != ${W}x${H}`);
      if (r.cssScale !== Math.floor(r.cssScale) || r.cssScale < 1) reasons.push(`non-integer css scale ${r.cssScale}`);
      if (r.scene !== "field") reasons.push(`scene ${r.scene} != field`);
      if (r.pixels.topLeft <= 0) reasons.push("no HUD pixels in top-left band");
      if (!(stats.kills >= 1)) reasons.push(`kills ${stats.kills} < 1`);
      if (!(stats.hits >= 1)) reasons.push(`hits ${stats.hits} < 1`);
      if (!(stats.freezes >= 1)) reasons.push(`freezes ${stats.freezes} < 1`);
      if (!(stats.damageNumberPixels > 0)) reasons.push("no damage-number pixels on the canvas");
      if (!flags.nearKilled) reasons.push("near target was not killed (kills did not increase)");
      if (!flags.sawInterrupt) reasons.push("no bite interrupted a wind-up (interrupt path not exercised)");
      if (!flags.followUpLanded) reasons.push("cast after bite interrupt did not land (stats.hits did not increase)");
      if (!castable.every(Boolean)) reasons.push(`not every spell was cast: ${castable.map((v) => (v ? 1 : 0)).join("")}`);
      const wantCost = [10, 22, 34, 30, 26, 40];
      const wantCd = [0.6, 3, 8, 6, 7, 12];
      for (let i = 0; i < 6; i++) {
        if (costs[i] === null || Math.abs(costs[i] - wantCost[i]) > 0.01) {
          reasons.push(`spell ${i + 1} cost ${costs[i]} != ${wantCost[i]}`);
        }
        if (!(cooldowns[i] > 0) || Math.abs(cooldowns[i] - wantCd[i]) > 0.01) {
          reasons.push(`spell ${i + 1} cd ${cooldowns[i]} != ${wantCd[i]}`);
        }
      }
      if (!(flags.novaKills >= 3)) reasons.push(`nova killed ${flags.novaKills} slimes, want 3`);
      const novaNumbers = Math.max(flags.maxNovaNumbers || 0, stats.maxNumberBoxes || 0);
      if (!(novaNumbers >= 3)) reasons.push(`nova showed ${novaNumbers} numbers on screen at once, want 3`);
      if (!(stats.maxNumbers <= 4) || !(novaNumbers <= 4)) {
        reasons.push(`too many concurrent numbers: push ${stats.maxNumbers}, screen ${novaNumbers} (max 4)`);
      }
      if (!flags.boltFarKill) reasons.push("bolt did not kill the farthest enemy");
      if (!flags.whiffCast || !flags.whiffPlaying || !flags.whiffDone || !flags.whiffNoHits) {
        reasons.push(
          `bolt whiff did not perform cleanly (cast ${flags.whiffCast}, playing ${flags.whiffPlaying}, done ${flags.whiffDone}, noHits ${flags.whiffNoHits})`,
        );
      }
      if (!flags.poisonSlimeDamaged) reasons.push("poison did not damage the slime");
      if (!flags.poisonGhostUnhurt) reasons.push("ghost was damaged by poison (should be immune)");
      if (!(flags.poisonTicks >= 1)) reasons.push("poison produced no ticks");
      if (flags.poisonCastPhase !== "recover") reasons.push(`poison cast phase ${flags.poisonCastPhase} != recover`);
      if (flags.healFrom50 !== 68) reasons.push(`heal 50 -> ${flags.healFrom50}, want 68`);
      if (flags.healCap !== 100) reasons.push(`heal at 95 -> ${flags.healCap}, want 100 (cap)`);
      const wantHp = { slime: 30, ghost: 20, skull: 20, eyeball: 50 };
      const wantY = { slime: 196, ghost: 196, skull: 170, eyeball: 196 };
      for (const type of ["slime", "ghost", "skull", "eyeball"]) {
        const t = flags.types[type] || {};
        if (!t.spawned) reasons.push(`${type} did not spawn`);
        if (t.hp !== wantHp[type]) reasons.push(`${type} hp ${t.hp} != ${wantHp[type]}`);
        if (t.y !== wantY[type]) reasons.push(`${type} y ${t.y} != ${wantY[type]}`);
        if (!t.killed) reasons.push(`${type} was not killed`);
      }
      if (flags.types.eyeball && flags.types.eyeball.deathFx !== "spawn/disintegrate") {
        reasons.push(`eyeball death fx ${flags.types.eyeball.deathFx}`);
      }
      if (flags.mixedAlive !== 8) reasons.push(`mixed field had ${flags.mixedAlive} bodies, want 8`);
      if (!(flags.mixedFps > 55)) reasons.push(`mixed field fps ${flags.mixedFps} <= 55`);

      // M2b: waves, cards, block
      if (!flags.waveStart) reasons.push("wave 1 did not start its queue");
      if (!(flags.waveSpawnInterval >= 2350 && flags.waveSpawnInterval <= 2850)) {
        reasons.push(`wave 1 spawn interval ${flags.waveSpawnInterval} ms, want ~2600`);
      }
      if (!flags.waveCleared) reasons.push("wave 1 never cleared into the intermission");
      if (!flags.cardsUnique) reasons.push(`intermission cards [${flags.cardsShown.join(",")}] are not three distinct cards`);
      if (flags.candleBreath !== 58) reasons.push(`intermission candle 50 -> ${flags.candleBreath}, want 58`);
      if (!flags.cardPicked || flags.cardsAfterPick !== 0) reasons.push("pickCard did not consume the card table");
      if (flags.waveAfterCard !== 2) reasons.push(`wave after the card is ${flags.waveAfterCard}, want 2`);
      if (!flags.cardChangedMods) reasons.push("the picked card did not change mods");
      if (!(flags.focusMult <= 0.8)) reasons.push(`focus cdMult ${flags.focusMult}, want <= 0.8`);
      const wantFocusCd = Math.round(0.6 * (flags.focusMult ?? 1) * 100) / 100;
      if (flags.focusCd === null || Math.abs(flags.focusCd - wantFocusCd) > 0.02) {
        reasons.push(`focused slash cd ${flags.focusCd}, want ${wantFocusCd}`);
      }
      if (flags.capSix !== 6 || flags.capSixHeld !== 6) {
        reasons.push(`wave 2 living cap ${flags.capSix} -> ${flags.capSixHeld}, want 6 -> 6`);
      }
      if (flags.capEight !== 8) reasons.push(`wave 8 allowed ${flags.capEight} bodies, want 8`);
      if (!(flags.wave8Fps > 55)) reasons.push(`wave 8 fps ${flags.wave8Fps} <= 55`);
      if (!flags.wave4) reasons.push("setWave(4) did not sync the HUD wave counter");
      if (!flags.blockPressed) reasons.push("the block did not start");
      if (!flags.blockAbsorbed) reasons.push("block did not register a successful guard (stats.blocks)");
      if (!flags.blockCandleHeld) reasons.push("the blocked bite still drained the candle");
      if (!flags.blockCastHeld) reasons.push("the blocked bite interrupted the cast");
      if (!flags.blockNoInterrupt) reasons.push("the blocked bite counted as an interrupt");
      if (!(flags.blockCd > 0)) reasons.push("the block cooldown did not start");
      if (!flags.blockSecondRefused) reasons.push("a second block inside the cooldown was accepted");
      const shape = snap();
      if (!["spawning", "intermission", "over"].includes(shape.waveState)) reasons.push(`bad waveState ${shape.waveState}`);
      if (typeof shape.block?.active !== "boolean" || typeof shape.block?.cd !== "number") reasons.push("snapshot.block missing");
      if (!shape.mods || typeof shape.mods.cdMult !== "number") reasons.push("snapshot.mods missing");

      const finalSnap = snap();
      if (finalSnap.cooldowns.length !== 6) reasons.push(`cooldowns length ${finalSnap.cooldowns.length} != 6`);
      if (!finalSnap.enemies.every((e) => typeof e.y === "number")) reasons.push("snapshot enemies missing y");
      if (renderer.canvas.style.transform !== "") reasons.push(`canvas transform "${renderer.canvas.style.transform}" not cleared`);

      finish(reasons);
    } catch (err) {
      console.error(err);
      finish([`autotest threw: ${err instanceof Error ? err.message : String(err)}`]);
    }
  })();
}
