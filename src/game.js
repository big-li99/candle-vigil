// Scene state machine. M2b runs the real ten-wave loop: a data-driven wave queue with a living-body cap, a 6 s
// intermission with three upgrade cards, and the timed block. M2c closes the run: the bone-fire boss on waves 5
// and 10, the iris and the result page when the candle hits zero, NIGHT ENDS when wave 10 clears, and the best
// wave / best time in localStorage. The field owns the world clock and the freeze rule: while combat is frozen
// or an act is hit-stopped, enemies, spawners, timers, props and the candle all stop — shake, flash, damage
// numbers and the HUD keep going.
import { createAct, createFx, painterFor, hex } from "../vendor/pixelfx/src/core/index.js";
import * as snowFx from "../vendor/pixelfx/src/fx/weather/snow.js";
import * as candleFx from "../vendor/pixelfx/src/fx/fire/candle.js";
import * as torchFx from "../vendor/pixelfx/src/fx/fire/torch.js";
import { get as getAsset } from "./assets.js";
import { W, H, GROUND } from "./frame.js";
import { drawHud } from "./ui/hud.js";
import { createCardOverlay, CARD_RECTS } from "./ui/cards.js";
import { createCombat } from "./systems/combat.js";
import { createPlayer, PLAYER_X, PLAYER_Y } from "./entities/player.js";
import { createEnemy, ENEMY_TYPES, SPAWN_X, GUARD_X, QUEUE_GAP, FLY_Y } from "./entities/enemy.js";
import { createBoss, BOSS_BREATH_DAMAGE, BOSS_RECOIL, BOSS_SUMMON, BOSS_EMBERS } from "./entities/boss.js";
import { SPELLS } from "./systems/spells.js";
import { WAVES, MAX_WAVE, waveDef, queueFor } from "./systems/waves.js";
import { createUpgrades } from "./systems/upgrades.js";
import { createTransition, createIrisTransition } from "./systems/transition.js";

const TITLE = "title";
const FIELD = "field";

const FLOOR = hex("#0a1322");
const FLOOR_EDGE = hex("#2b4266");
const FLOOR_SEAM = hex("#14223a");
const FLOOR_SPECK_A = hex("#203659");
const FLOOR_SPECK_B = hex("#16263f");

// The back wall the torches hang on (M0 review: they hung on nothing). Cold blue stone, snow on the cap.
const WALL_TOP = 96;
const WALL = hex("#0a1220");
const WALL_MORTAR = hex("#070c16");
const WALL_BRICK = hex("#101a2c");
const WALL_CAP = hex("#243653");
const WALL_DEEP = hex("#060a12");
const WALL_SNOW = hex("#bed1ee");
const WALL_SNOW_DIM = hex("#7f97bb");
const TORCH_Y = 150;

const SPAWN_LANE_GAP = QUEUE_GAP * 0.6; // a new enemy never materialises on top of one already in that lane
const INTERMISSION_TIME = 6; // DESIGN §2.8: 6 s of breathing room between waves
const CANDLE_BREATH = 8; // intermission candle refill, capped at maxCandle
const CARDS_PER_DRAW = 3;

// The three run states the snapshot reports. `over` is the failure page, `ending` is NIGHT ENDS.
const PLAYING = "playing";
const OVER = "over";
const ENDING = "ending";

const BEST_KEY = "candle-vigil:best";
const WHITE_FLASH_BOSS = 0.5;
const WHITE_FLASH_WIN = 0.6;
const DAWN_RAMP = 1.2;
const ENDING_PAGE_DELAY = 1.2;

/** mm:ss for the result pages and the title's best time. A zero time means "no completed run yet". */
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The persisted record: {wave, time}. Never let a storage failure (file://, private mode) break boot. */
function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return { wave: 0, time: 0 };
    const v = JSON.parse(raw);
    return {
      wave: Math.max(0, Math.min(MAX_WAVE, Math.round(Number(v?.wave) || 0))),
      time: Math.max(0, Number(v?.time) || 0),
    };
  } catch {
    return { wave: 0, time: 0 };
  }
}

export function createGame({ input, renderer = null, stats = {} } = {}) {
  stats.fps ??= 0;
  stats.hits ??= 0;
  stats.kills ??= 0;
  stats.freezes ??= 0;
  stats.interrupts ??= 0;
  stats.blocks ??= 0;
  stats.cardsPicked ??= 0;
  stats.wavesCleared ??= 0;
  stats.killsByType ??= {};
  stats.deathFx ??= {};

  const state = {
    scene: TITLE,
    wave: 1,
    waveState: "spawning", // spawning | intermission | over
    candle: 100,
    maxCandle: 100,
    mana: 100,
    maxMana: 100,
    embers: 0,
    god: false,
    time: 0, // the live run clock; frozen the moment the run ends
    candleOut: false,
    biteFlash: 0, // HUD: the candle bar blinks red for a moment on every bite
    spawnPaused: false, // ?autotest=1 holds the wave spawner so the script can own the field
    run: PLAYING, // playing | over | ending
    runKills: 0, // per-run kills and combo, for the result page (stats.* stay lifetime)
    runBestCombo: 0,
    flashWhite: 0, // full-screen white flash, seconds left
    flashMax: 0,
    dawn: 0, // 0..1: the cold-blue dawn wash after the tenth wave
    summary: null, // {kind, wave, kills, bestCombo, time}
    result: null, // {ready}: true once the end page accepts a key
  };

  const best = loadBest(); // {wave, time}; time is the shortest completed run, 0 until the first win

  const enemies = [];
  const zones = []; // poison clouds: lifetime + 0.5 s tick, owned here because they outlive the cast
  const combat = createCombat({ renderer, stats });
  const upgrades = createUpgrades({
    onApply(id, stacks, mods) {
      if (id !== "charm") return;
      state.maxCandle = 100 + mods.candleCapBonus;
      state.candle = state.maxCandle; // EMBER CHARM refills to the new cap
    },
  });
  const cardOverlay = createCardOverlay();
  const transition = createTransition();
  const iris = createIrisTransition();
  let victoryAct = null; // the ui/level-up performance at the watchman's feet on NIGHT ENDS

  // The live wave: its remaining spawn queue, its own cadence and cap, and the intermission clock.
  let waveQueue = [];
  let waveInterval = WAVES[0].interval;
  let waveMaxAlive = WAVES[0].maxAlive;
  let waveBossDelay = 0; // wave 10: how long after the boss the mixed batch may start
  let waveSpawnT = 0;
  let cards = [];
  let intermissionT = 0;
  let seed = 0;

  const world = {
    state,
    combat,
    stats,
    enemies,
    player: null,
    onKill,
    onBossHalf,
    onBossKill,
    onBossBreath,
  };

  // The frontmost living enemy inside the spell's reach (reach is measured from the player's x). `Infinity`
  // is the bolt's "distance ignored": it still takes the smallest x, i.e. the one nearest the line.
  function findTarget(sp) {
    const reach = sp.reach ?? Infinity;
    let best = null;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = e.x - PLAYER_X;
      if (d < 0 || d > reach) continue;
      if (!best || e.x < best.x) best = e;
    }
    return best;
  }

  /** Every living enemy, for an AoE (frost nova is full-screen by design). */
  function findTargets() {
    return enemies.filter((e) => !e.dead);
  }

  /** A poison cloud is placed once, then ticks on the field clock for its lifetime. */
  function addPoisonZone(sp) {
    const z = sp.zone;
    if (!z) return null;
    const inst = combat.effect("nature/poison-cloud", z.x, GROUND, ++seed, { layer: "back" });
    if (!inst) return null;
    // BONE EATER widens the damage area around the spell's own x and lengthens its life; the numbers only.
    const r = (z.right - z.left) / 2;
    const half = r * (upgrades.mods.poisonRadiusMult ?? 1);
    const zone = {
      inst,
      damage: sp.damage,
      x: z.x,
      left: z.x - half,
      right: z.x + half,
      duration: z.duration + (upgrades.mods.poisonDurBonus ?? 0),
      tick: z.tick,
      t: 0,
      tickT: 0,
      stopped: false,
    };
    zones.push(zone);
    return zone;
  }

  /** One poison tick: ground enemies only, and ghosts are immune (DESIGN §2.6 / M2a brief). */
  function poisonTick(zone) {
    for (const e of enemies) {
      if (e.dead || e.flying || e.poisonImmune) continue;
      if (e.x < zone.left || e.x > zone.right) continue;
      // A DoT tick sparks and numbers but never stops the world or flashes it white.
      combat.hit({ x: e.hitX, y: e.hitY, damage: zone.damage, target: e, screen: false, count: false });
    }
  }

  function updateZones(dt) {
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (z.t < z.duration) {
        z.t += dt;
        z.tickT += dt;
        // the epsilon keeps 30 fixed steps (0.49999999999999994 s) from delaying the first tick by a frame
        while (z.tickT + 1e-9 >= z.tick) {
          z.tickT -= z.tick;
          poisonTick(z);
        }
        if (z.t >= z.duration && !z.stopped) {
          z.stopped = true;
          z.inst.stop(); // the loop fades out over the library's 0.3 s tail, then combat drops it
        }
      }
      if (z.stopped && z.inst.done()) zones.splice(i, 1);
    }
  }

  const player = createPlayer({
    state,
    combat,
    mods: upgrades.mods,
    findTarget,
    findTargets,
    onCast: addPoisonZone,
    onBlock: () => {
      stats.blocks += 1;
      combat.effect("impacts/shield-block", PLAYER_X + 4, PLAYER_Y, ++seed);
    },
    stats,
  });
  world.player = player;

  function onKill(enemy) {
    state.embers += 1;
    stats.kills += 1;
    state.runKills += 1;
    if (enemy) {
      stats.killsByType[enemy.type] = (stats.killsByType[enemy.type] ?? 0) + 1;
      stats.deathFx[enemy.type] = enemy.deathFx ?? null;
    }
  }

  /** The boss's half-hp answer: three slimes, once, under a plasma burst (the M2c brief allows either cue). */
  function onBossHalf(boss) {
    spawn("slime", BOSS_SUMMON, boss.x + 30);
    combat.effect("explosions/plasma-explosion", boss.x, boss.y, ++seed);
  }

  /** The boss dies: its own explosion, a half-second white flash, a full-screen shake and ten embers. */
  function onBossKill(boss) {
    state.embers += BOSS_EMBERS;
    state.runKills += 1;
    stats.kills += 1;
    stats.killsByType.boss = (stats.killsByType.boss ?? 0) + 1;
    stats.deathFx.boss = "explosions/small-explosion";
    combat.effect("explosions/small-explosion", boss.x, boss.y, ++seed);
    combat.effect("pickups/collect-burst", boss.x, boss.y - 6, ++seed);
    state.flashWhite = Math.max(state.flashWhite, WHITE_FLASH_BOSS);
    state.flashMax = Math.max(state.flashMax, WHITE_FLASH_BOSS);
    combat.shake(0.5, 6);
  }

  /**
   * The breath lands. The player's own hurt() decides block vs candle loss; the breath never interrupts a cast.
   * A blocked breath also throws the boss back 6 px. Only a landed, unblocked breath shakes and shows hit-flash.
   */
  function onBossBreath(boss) {
    const r = player.hurt(BOSS_BREATH_DAMAGE, { interrupt: false });
    if (r === "blocked") {
      boss.recoil(BOSS_RECOIL);
    } else if (r === "hurt") {
      combat.shake(0.3, 3);
      combat.effect("impacts/hit-flash", PLAYER_X, PLAYER_Y, ++seed);
    }
  }

  // --- the stage ---------------------------------------------------------------------
  const snow = createFx(snowFx, { x: W / 2, y: GROUND, seed: 7 });
  const candle = createFx(candleFx, { x: 24, y: GROUND, seed: 2 });
  const torchA = createFx(torchFx, { x: 108, y: TORCH_Y, seed: 4, light: 0.8 });
  const torchB = createFx(torchFx, { x: 300, y: TORCH_Y, seed: 5, light: 0.8 });

  /**
   * Start a run from the title. Every run starts from the same clean slate: no enemies, no cards, no water in
   * the pipes — base mods, full candle and mana, an idle watchman, wave 1.
   */
  function enterField() {
    if (state.scene !== TITLE) return false;
    resetRunState();
    state.scene = FIELD;
    startWave(1); // the first wave starts the moment the title is dismissed
    return true;
  }

  /** The failure page's any-key: a complete restart into wave 1 (not a half reset). */
  function restartRun() {
    if (state.scene !== FIELD) return false;
    resetRunState();
    state.scene = FIELD;
    startWave(1);
    return true;
  }

  /** NIGHT ENDS' any-key: back to the title, where the persisted best is shown. */
  function returnTitle() {
    resetRunState();
    state.scene = TITLE;
    return true;
  }

  /** Everything a run owns, cleared together. The persisted best, lifetime stats and the debug toggles stay. */
  function resetRunState() {
    enemies.length = 0;
    for (const z of zones) z.inst.stop();
    zones.length = 0;
    waveQueue = [];
    waveBossDelay = 0;
    waveSpawnT = 0;
    cards = [];
    intermissionT = 0;
    cardOverlay.clear();
    transition.stop();
    iris.reset();
    victoryAct = null;
    upgrades.reset();

    state.maxCandle = 100;
    state.candle = 100;
    state.maxMana = 100;
    state.mana = 100;
    state.embers = 0;
    state.wave = 1;
    state.waveState = "spawning";
    state.run = PLAYING;
    state.candleOut = false;
    state.biteFlash = 0;
    state.flashWhite = 0;
    state.flashMax = 0;
    state.dawn = 0;
    state.time = 0;
    state.runKills = 0;
    state.runBestCombo = 0;
    state.summary = null;
    state.result = null;
    player.reset();
    combat.reset();
    stats.combo = 0;
    stats.bestCombo = 0;
  }

  /** Keep the highest wave and, only for a completed run, the shortest time. Always persist a real change. */
  function recordBest(wave, time = 0, completed = false) {
    let changed = false;
    if (wave > best.wave) {
      best.wave = wave;
      changed = true;
    }
    if (completed && time > 0 && (best.time <= 0 || time < best.time)) {
      best.time = Math.round(time * 100) / 100;
      changed = true;
    }
    if (changed) {
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify({ wave: best.wave, time: best.time }));
      } catch {
        // storage unavailable: the record still lives for this session
      }
    }
    return best;
  }

  /** --- waves ---------------------------------------------------------------------------------------------- */

  function livingCount() {
    let n = 0;
    for (const e of enemies) if (!e.dead) n++;
    return n;
  }

  /** Begin wave n at its first spawn: its own queue, interval and living-body cap, straight from the table. */
  function startWave(n) {
    const v = Math.max(1, Math.min(MAX_WAVE, Math.round(Number(n)) || 1));
    const def = waveDef(v);
    state.wave = v;
    state.waveState = "spawning";
    waveQueue = queueFor(v);
    waveInterval = def.interval;
    waveMaxAlive = def.maxAlive;
    waveBossDelay = def.bossReinforceDelay ?? 0;
    waveSpawnT = 0;
    cards = [];
    intermissionT = 0;
    cardOverlay.clear();
  }

  /** Debug/test: jump to the start of wave n with a clean field. */
  function setWave(n) {
    enemies.length = 0;
    for (const z of zones) z.inst.stop();
    zones.length = 0;
    startWave(n);
    return state.wave;
  }

  /** The queue is empty and nothing is alive: the wave is cleared. The tenth clear ends the night. */
  function clearWave() {
    stats.wavesCleared += 1;
    waveQueue = [];
    if (state.wave >= MAX_WAVE) {
      startVictory();
      return;
    }
    state.waveState = "intermission";
    intermissionT = INTERMISSION_TIME;
    state.candle = Math.min(state.maxCandle, state.candle + CANDLE_BREATH);
    cards = upgrades.drawCards(CARDS_PER_DRAW);
    cardOverlay.show(cards);
  }

  /** The real application point for an upgrade, shared by pickCard and the debug hook. */
  function applyUpgrade(id) {
    return upgrades.apply(id);
  }

  /**
   * Take card i: it is applied for real, bursts at its own plate, and the next wave starts under a transition.
   * Used by the 1/2/3 keys, Enter (card 0) and the 6 s timeout.
   */
  function pickCard(i = 0) {
    if (state.waveState !== "intermission" || !cards.length) return false;
    const idx = Math.max(0, Math.min(cards.length - 1, Math.round(Number(i)) || 0));
    const id = cards[idx];
    const r = CARD_RECTS[idx];
    combat.effect("pickups/collect-burst", r.x + r.w / 2, r.y + 58, ++seed);
    applyUpgrade(id);
    cards = [];
    intermissionT = 0;
    cardOverlay.clear();
    stats.cardsPicked += 1;
    startWave(Math.min(MAX_WAVE, state.wave + 1));
    transition.start(3 + state.wave);
    return true;
  }

  function skipUpgrade() {
    return pickCard(0);
  }

  /**
   * The wave clock. A due spawn waits (without losing its place in the queue) while the screen is at its living
   * cap; an empty queue plus an empty field ends the wave. The autotest's spawnPaused switch freezes this whole
   * loop, so its hand-placed bodies cannot trip a wave transition.
   */
  function updateWaves(dt) {
    if (state.spawnPaused) return;
    if (state.waveState === "intermission") {
      intermissionT = Math.max(0, intermissionT - dt);
      cardOverlay.update(dt);
      if (intermissionT <= 0) pickCard(0); // DESIGN §2.8: the countdown takes the first card
      return;
    }
    if (state.waveState !== "spawning") return;
    if (waveQueue.length > 0) {
      waveSpawnT -= dt;
      if (waveSpawnT <= 0 && livingCount() < waveMaxAlive) {
        const type = waveQueue.shift();
        spawn(type, 1);
        // wave 10 holds its mixed batch until the boss has had 20 s on its own
        waveSpawnT = type === "boss" && waveBossDelay > 0 ? waveBossDelay : waveInterval;
      }
    } else if (livingCount() === 0) {
      clearWave();
    }
  }

  /**
   * The first x at or right of `at` that is not on top of an enemy already in that lane. Batch/debug spawns
   * therefore appear as a queue instead of a single point (the six-at-one-x bug), even off the right edge.
   * A lane is ground or flying: the two never block each other (M2a brief).
   */
  function freeLane(at, flying = false) {
    let x = at;
    for (let tries = 0; tries < 64; tries++) {
      let blocked = false;
      for (const e of enemies) {
        if (e.dead || !!e.flying !== !!flying) continue;
        if (Math.abs(e.x - x) < SPAWN_LANE_GAP) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return x;
      x += QUEUE_GAP;
    }
    return x;
  }

  function spawn(type = "slime", n = 1, x = SPAWN_X) {
    const count = Math.max(1, Math.min(20, Math.round(Number(n)) || 1));
    const at = Number.isFinite(Number(x)) ? Math.max(24, Math.min(SPAWN_X, Number(x))) : SPAWN_X;
    if (type === "boss") {
      for (let i = 0; i < count; i++) {
        enemies.push(createBoss({ x: freeLane(at, true), y: FLY_Y, seed: ++seed, world }));
      }
      return count;
    }
    const def = ENEMY_TYPES[type];
    if (!def) return 0;
    for (let i = 0; i < count; i++) {
      const y = def.flying ? FLY_Y : GROUND;
      enemies.push(createEnemy({ x: freeLane(at, def.flying), y, seed: ++seed, type, world }));
    }
    return count;
  }

  /**
   * One queue slot per living enemy each step, in its own lane: the front gets the guard line, everyone behind
   * it stands 34 px further right. Ties are broken by spawn order, so a batch never shares a slot. Killing or
   * knocking back the front enemy lets the rest walk forward on the next step. The boss is not placed: it owns
   * its own approach, but it occupies the air lane's front slot, so the small flyers queue behind it.
   */
  function placeQueue() {
    const alive = enemies.filter((e) => !e.dead);
    const ground = alive.filter((e) => !e.flying).sort((a, b) => a.x - b.x || a.id - b.id);
    const air = alive.filter((e) => e.flying && e.type !== "boss").sort((a, b) => a.x - b.x || a.id - b.id);
    const bossAhead = alive.some((e) => e.type === "boss");
    ground.forEach((e, i) => e.place(GUARD_X + QUEUE_GAP * i, i === 0));
    air.forEach((e, i) => e.place(GUARD_X + QUEUE_GAP * (i + (bossAhead ? 1 : 0)), i === 0 && !bossAhead));
  }

  /** The candle is the only pool. Zero means the run is over, immediately. */
  function startGameOver() {
    if (state.scene !== FIELD || state.run !== PLAYING) return;
    state.run = OVER;
    state.waveState = "over";
    state.candle = 0;
    state.candleOut = true;
    waveQueue = [];
    cards = [];
    cardOverlay.clear();
    transition.stop();
    for (const z of zones) z.inst.stop();
    state.runBestCombo = Math.max(state.runBestCombo, combat.combo);
    state.summary = {
      kind: OVER,
      wave: state.wave,
      kills: state.runKills,
      bestCombo: state.runBestCombo,
      time: state.time,
    };
    state.result = { ready: false };
    recordBest(state.wave, 0, false); // the highest wave reached is a record even without a win
    // The iris is authored for a 320 x 180 stage; focus it on the watchman's candle-side shoulder.
    iris.start(++seed, [Math.round((PLAYER_X * 320) / W), Math.round((PLAYER_Y * 180) / H)]);
  }

  /** Wave 10 is cleared: level-up at the watchman's feet, a white flash, dawn, then the ending page. */
  function startVictory() {
    if (state.scene !== FIELD || state.run !== PLAYING) return;
    state.run = ENDING;
    state.waveState = "over";
    waveQueue = [];
    cards = [];
    cardOverlay.clear();
    transition.stop();
    for (const z of zones) z.inst.stop();
    state.runBestCombo = Math.max(state.runBestCombo, combat.combo);
    state.summary = {
      kind: ENDING,
      wave: MAX_WAVE,
      kills: state.runKills,
      bestCombo: state.runBestCombo,
      time: state.time,
    };
    state.result = { ready: false, t: 0 };
    state.flashWhite = WHITE_FLASH_WIN;
    state.flashMax = WHITE_FLASH_WIN;
    state.dawn = 0;
    victoryAct = createAct(getAsset("ui/level-up"), { x: PLAYER_X, y: PLAYER_Y, seed: ++seed });
    recordBest(MAX_WAVE, state.time, true);
  }

  /** The normal loss path (a bite or the boss breath took the last of the candle). */
  function checkCandleOut() {
    if (state.scene !== FIELD || state.run !== PLAYING) return;
    if (!state.god && state.candle <= 0) startGameOver();
  }

  /** Debug/test hook: take candle directly and go through the same failure flow, god mode or not. */
  function damageCandle(n) {
    if (state.scene !== FIELD || state.run !== PLAYING) return state.candle;
    state.candle = Math.max(0, state.candle - Math.max(0, Number(n) || 0));
    if (state.candle <= 0) startGameOver();
    return state.candle;
  }

  /** Debug/test hook: clear every living body and the rest of the spawn queue. */
  function killAll() {
    if (state.scene !== FIELD || state.run !== PLAYING) return 0;
    waveQueue = []; // a wave that can never be finished otherwise would hold the field open
    const living = enemies.filter((e) => !e.dead);
    for (const e of living) e.hurt(999999, 0);
    return living.length;
  }

  /** The failure page's clock: the iris closes, holds, opens onto the result, then any key restarts. */
  function updateOver(dt, input) {
    iris.update(dt);
    if (iris.done && !state.result.ready) state.result.ready = true;
    if (state.result.ready && input && input.anyPressed()) restartRun();
  }

  /** The ending's clock: the level-up performance, the dawn wash, then the page and any key back to the title. */
  function updateEnding(dt, input) {
    if (victoryAct) victoryAct.update(dt);
    state.dawn = Math.min(1, state.dawn + dt / DAWN_RAMP);
    state.result.t += dt;
    if (state.result.t >= ENDING_PAGE_DELAY) state.result.ready = true;
    if (state.result.ready && input && input.anyPressed()) returnTitle();
  }

  function update(dt, input) {
    // the run clock only advances while the run is live; the result pages print the frozen value
    if (state.scene === FIELD && state.run === PLAYING) state.time += dt;
    // HUD feedback keeps ticking through hit-stop like shake and the flash
    if (state.biteFlash > 0) state.biteFlash = Math.max(0, state.biteFlash - dt);
    if (state.flashWhite > 0) state.flashWhite = Math.max(0, state.flashWhite - dt);

    if (state.scene === TITLE) {
      snow.update(dt);
      candle.update(dt);
      torchA.update(dt);
      torchB.update(dt);
      if (input && input.anyPressed()) enterField();
      return;
    }

    // The two end states freeze the field: no spawns, no enemy steps, no candles burning. The iris, the
    // ending performance, the ambient stage and the impact effects still get their time.
    if (state.run === OVER) {
      updateOver(dt, input);
      combat.update(dt, false);
      snow.update(dt);
      candle.update(dt);
      torchA.update(dt);
      torchB.update(dt);
      return;
    }
    if (state.run === ENDING) {
      updateEnding(dt, input);
      combat.update(dt, false);
      snow.update(dt);
      candle.update(dt);
      torchA.update(dt);
      torchB.update(dt);
      return;
    }

    // input first: a cast (or a card, between waves) starts on the very step the key went down
    if (input) {
      if (state.waveState === "intermission") {
        for (let i = 0; i < CARDS_PER_DRAW; i++) {
          if (input.pressed(`slot${i + 1}`)) {
            pickCard(i);
            break;
          }
        }
        if (input.pressed("confirm")) pickCard(0); // Enter takes the first card
      } else {
        for (let i = 0; i < 6; i++) {
          if (input.pressed(`slot${i + 1}`)) {
            player.cast(i);
            break;
          }
        }
        if (input.pressed("block")) player.block();
        if (input.pressed("cancel")) player.cancel("cancel");
      }
    }

    // the act keeps ticking only to thaw its own hit-stop
    const frozen = combat.freeze > 0 || !!(player.act && player.act.frozen);
    player.update(dt, frozen);

    if (!frozen) {
      placeQueue();
      for (const e of enemies) e.update(dt);
      updateZones(dt);
      for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
      updateWaves(dt);
      transition.update(dt);
      snow.update(dt);
      candle.update(dt);
      torchA.update(dt);
      torchB.update(dt);
    }

    combat.update(dt, frozen);
    if (state.run === PLAYING) state.runBestCombo = Math.max(state.runBestCombo, combat.combo);
    checkCandleOut();
  }

  function draw(frame) {
    if (state.scene === TITLE) drawTitle(frame);
    else drawField(frame);
  }

  function drawTitle(frame) {
    snow.draw(frame, "back");
    snow.draw(frame, "front");

    const p = painterFor(frame);
    p.text("CANDLELIGHT", W / 2, 56, hex("#ffe9c1"), {
      font: "big",
      scale: 2,
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });
    p.text("VIGIL", W / 2, 78, hex("#ffe9c1"), {
      font: "big",
      scale: 2,
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });

    // The persisted record: highest wave and the shortest completed run (00:00 / --:-- before the first win).
    p.text(`BEST WAVE ${best.wave}/10`, W / 2, 104, hex("#ffcf7a"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
    p.text(`BEST TIME ${best.time > 0 ? formatTime(best.time) : "--:--"}`, W / 2, 114, hex("#7f9cc4"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });

    p.text("PRESS ANY KEY", W / 2, 128, hex("#9fe8ff"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
    p.text("1-6 CAST   SPACE BLOCK   ESC CANCEL", W / 2, 140, hex("#7f9cc4"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
    p.text("EFFECTS BY PIXELFX (MIT) - BUILT WITH CLAUDE CODE", W / 2, 176, hex("#46618a"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
  }

  function drawField(frame) {
    snow.draw(frame, "back");

    // the wall goes down over the haze, then the floor, so the seam under the ground line stays invisible
    let p = painterFor(frame);
    drawWall(p);
    drawGround(p);
    if (state.dawn > 0) drawDawn(p);

    torchA.draw(frame, "front");
    torchB.draw(frame, "front");
    candle.draw(frame, "front");

    // Ground effects (the poison cloud) live under the bodies that walk through them.
    combat.drawBack(frame);

    // Back to front: higher on the screen first (the flying lane), then the farthest x, so the enemy at the
    // guard line sits on top of its queue. The player is drawn after every enemy, so 112 px sprites can queue
    // up without swallowing him. On NIGHT ENDS the level-up act owns the hero and draws him itself.
    const sorted = enemies.slice().sort((a, b) => a.y - b.y || b.x - a.x);
    for (const e of sorted) e.draw(frame);

    if (state.run === ENDING) {
      if (victoryAct) victoryAct.draw(frame, { target: false });
    } else {
      player.draw(frame);
    }
    combat.draw(frame);
    snow.draw(frame, "front");

    const bossNow = enemies.find((e) => !e.dead && e.type === "boss");
    if (state.run === PLAYING) {
      drawHud(frame, state, {
        spells: SPELLS,
        cooldowns: player.cooldowns,
        cdMax: SPELLS.map((_, i) => player.cooldownFor(i)),
        boss: bossNow ? { hp: bossNow.hp, max: bossNow.maxHp } : null,
      });
      if (state.waveState === "intermission") {
        cardOverlay.draw(frame, { cards, timer: intermissionT, stacks: upgrades.stacks });
      }
      transition.draw(frame); // the wave wipe covers everything, HUD included
    }
    combat.drawFlash(frame);

    if (state.run === OVER) {
      // the page goes under the iris, so the opening reveals it rather than hiding it
      if (iris.pageVisible) drawResultPage(frame, state.summary, false);
      iris.draw(frame);
    } else if (state.run === ENDING) {
      if (state.result && state.result.ready) drawResultPage(frame, state.summary, true);
    }
    if (state.flashWhite > 0) drawWhiteFlash(frame);
  }

  /** The dawn wash: a cold blue veil lifted toward the sky, drawn over the stage and under every body. */
  function drawDawn(p) {
    const k = state.dawn;
    for (let y = 0; y < GROUND; y += 6) {
      const t = y / GROUND;
      p.rect(0, y, W, 6, hex("#7fa8d8"), (0.03 + 0.08 * (1 - t)) * k);
    }
    p.rect(0, 0, W, 10, hex("#cfe0fa"), 0.12 * k);
  }

  /** Kill the additive light under a plate so the end page's text does not sit in a bright pool. */
  function clearLightRect(frame, x, y, w, h) {
    const x1 = Math.max(0, x);
    const y1 = Math.max(0, y);
    const x2 = Math.min(W, x + w);
    const y2 = Math.min(H, y + h);
    for (let yy = y1; yy < y2; yy++) for (let xx = x1; xx < x2; xx++) frame.light[yy * W + xx] = 0;
  }

  /** The result page shared by both ends: WAVE / SLAIN / BEST COMBO / TIME on one dark plate. */
  function drawResultPage(frame, s, ending) {
    if (!s) return;
    const p = painterFor(frame);
    const plateW = 240;
    const plateH = 118;
    const x = Math.round((W - plateW) / 2);
    const y = 48;
    p.rect(0, 0, W, H, hex("#05070d"), ending ? 0.42 : 0.62);
    clearLightRect(frame, x, y, plateW, plateH);
    p.rect(x, y, plateW, plateH, hex("#0b1220"), 0.94);
    p.rect(x, y, plateW, 1, hex("#3d5a84"));
    p.rect(x, y + plateH - 1, plateW, 1, hex("#0d1626"));

    p.text(ending ? "NIGHT ENDS" : "CANDLE OUT", W / 2, y + 10, ending ? hex("#ffcf7a") : hex("#ff6a5a"), {
      font: "big",
      scale: 2,
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });

    const rows = ending
      ? [
          ["TIME", formatTime(s.time)],
          ["SLAIN", String(s.kills)],
          ["BEST COMBO", String(s.bestCombo)],
        ]
      : [
          ["WAVE", `${s.wave}/${MAX_WAVE}`],
          ["SLAIN", String(s.kills)],
          ["BEST COMBO", String(s.bestCombo)],
          ["TIME", formatTime(s.time)],
        ];
    rows.forEach(([label, value], i) => {
      const ry = y + 38 + i * 15;
      p.text(label, x + 22, ry, hex("#9fb6d8"), { font: "mini" });
      p.text(value, x + plateW - 22, ry, hex("#dceaff"), { font: "mini", align: "right" });
    });

    p.text("PRESS ANY KEY", W / 2, y + 100, hex("#9fe8ff"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
  }

  /** A decaying full-screen white flash (the boss's death, the tenth wave's clear). */
  function drawWhiteFlash(frame) {
    const k = state.flashMax > 0 ? state.flashWhite / state.flashMax : 0;
    if (k <= 0) return;
    const p = painterFor(frame);
    p.rect(0, 0, W, H, hex("#ffffff"), 0.85 * k);
  }

  /** The back wall the torches are bolted to: cold stone courses, a capstone and snow settled on it. */
  function drawWall(p) {
    p.rect(0, WALL_TOP, W, GROUND - WALL_TOP, WALL);
    const rowH = 10;
    for (let r = 0; r * rowH + WALL_TOP < GROUND; r++) {
      const y = WALL_TOP + r * rowH;
      p.rect(0, y, W, 1, WALL_MORTAR);
      const off = r % 2 ? 16 : 0;
      for (let x = off; x < W; x += 32) {
        p.rect(x, y, 1, rowH, WALL_MORTAR);
        // a face a shade off the rest, so the wall is not one flat slab
        if ((((x * 13 + r * 7) >> 2) % 5) === 0) p.rect(x + 2, y + 2, 28, rowH - 3, WALL_BRICK);
      }
    }
    // the foot of the wall sits in shadow, which is what puts it behind the floor
    p.rect(0, GROUND - 5, W, 5, WALL_DEEP);
    p.rect(0, WALL_TOP - 3, W, 3, WALL_CAP);
    p.rect(0, WALL_TOP - 1, W, 1, hex("#3a577c"));
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.19) + Math.sin(x * 0.071 + 2.1) * 0.8;
      const h = n > 0.55 ? 3 : n > -0.2 ? 2 : 1;
      p.rect(x, WALL_TOP - 3 - h, 1, h, h > 2 ? WALL_SNOW : WALL_SNOW_DIM);
    }
  }

  function drawGround(p) {
    p.rect(0, GROUND, W, H - GROUND, FLOOR);
    p.rect(0, GROUND, W, 1, FLOOR_EDGE);
    p.rect(0, GROUND + 1, W, 1, FLOOR_SEAM);
    for (let i = 0; i < 28; i++) {
      const x = (i * 131 + 17) % W;
      const y = GROUND + 4 + ((i * 47) % 14);
      p.px(x, y, i % 3 === 0 ? FLOOR_SPECK_A : FLOOR_SPECK_B);
    }
  }

  function snapshot(statsIn) {
    const mods = {};
    for (const [k, v] of Object.entries(upgrades.mods)) mods[k] = Math.round(v * 1000) / 1000;
    const bossNow = enemies.find((e) => !e.dead && e.type === "boss");
    return {
      scene: state.scene,
      wave: state.wave,
      waveState: state.waveState,
      candle: Math.round(state.candle * 100) / 100,
      mana: Math.round(state.mana * 100) / 100,
      embers: state.embers,
      enemies: enemies
        .filter((e) => !e.dead)
        .map((e) => ({ type: e.type, hp: e.hp, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10 })),
      // M2c: the boss's live hp and tell, the run state, and the persisted record
      boss: bossNow
        ? {
            hp: Math.round(bossNow.hp * 10) / 10,
            max: bossNow.maxHp,
            telegraph: Math.round(bossNow.telegraph * 1000) / 1000,
            x: Math.round(bossNow.x * 10) / 10,
          }
        : null,
      state: state.run,
      best: { wave: best.wave, time: best.time },
      result: state.result ? { ready: !!state.result.ready, kind: state.summary?.kind ?? null } : null,
      cards: state.waveState === "intermission" ? cards.slice() : [],
      block: { active: player.blockActive, cd: Math.round(player.blockCd * 1000) / 1000 },
      mods,
      casting: player.casting,
      armor: Math.round(player.armor * 100) / 100,
      cooldowns: player.cooldowns.map((v) => Math.round(v * 100) / 100),
      freeze: Math.round(combat.freeze * 1000) / 1000,
      combo: combat.combo,
      candleOut: state.candleOut,
      god: state.god,
      fps: statsIn ? statsIn.fps : 0,
    };
  }

  return {
    state,
    enterField,
    setWave,
    spawn,
    cast: (i = 0) => player.cast(i),
    block: () => player.block(),
    pickCard,
    skipUpgrade,
    applyUpgrade,
    upgrades,
    update,
    draw,
    snapshot,
    damageCandle,
    killAll,
    combat,
    player,
    enemies,
    zones,
    entityCount: () => enemies.length,
    zoneCount: () => zones.length,
    get scene() {
      return state.scene;
    },
    get wave() {
      return state.wave;
    },
    get waveState() {
      return state.waveState;
    },
    get transitionActive() {
      return transition.active;
    },
    /** Pausing is only meaningful while the field is actually being played (not on a result page). */
    get canPause() {
      return state.scene === FIELD && state.run === PLAYING;
    },
  };
}
