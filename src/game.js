// Scene state machine. M1 knows two states: the title, and the field running the wave-1 placeholder loop
// (slimes, no upgrades, no boss, no game over). The field owns the world clock and the freeze rule:
// while combat is frozen or an act is hit-stopped, enemies, spawners, timers, props and the candle all stop —
// shake, flash, damage numbers and the HUD keep going.
import { createFx, painterFor, hex } from "../vendor/pixelfx/src/core/index.js";
import * as snowFx from "../vendor/pixelfx/src/fx/weather/snow.js";
import * as candleFx from "../vendor/pixelfx/src/fx/fire/candle.js";
import * as torchFx from "../vendor/pixelfx/src/fx/fire/torch.js";
import { W, H, GROUND } from "./frame.js";
import { drawHud } from "./ui/hud.js";
import { createCombat } from "./systems/combat.js";
import { createPlayer, PLAYER_X } from "./entities/player.js";
import { createEnemy, ENEMY_TYPES, SPAWN_X, GUARD_X, QUEUE_GAP, FLY_Y } from "./entities/enemy.js";
import { SPELLS } from "./systems/spells.js";

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

const SPAWN_INTERVAL = 3.5; // s between slimes (DESIGN §2.7; M1 placeholder for the M2 wave table)
const MAX_ALIVE = 6;
const SPAWN_LANE_GAP = QUEUE_GAP * 0.6; // a new slime never materialises on top of one already in that lane
const KILLS_PER_WAVE = 12;
const CANDLE_OUT_TIME = 2;

export function createGame({ input, renderer = null, stats = {} } = {}) {
  stats.fps ??= 0;
  stats.hits ??= 0;
  stats.kills ??= 0;
  stats.freezes ??= 0;
  stats.interrupts ??= 0;
  stats.killsByType ??= {};
  stats.deathFx ??= {};

  const state = {
    scene: TITLE,
    wave: 1,
    candle: 100,
    maxCandle: 100,
    mana: 100,
    maxMana: 100,
    embers: 0,
    god: false,
    time: 0,
    candleOut: false,
    biteFlash: 0, // HUD: the candle bar blinks red for a moment on every bite
    spawnPaused: false, // ?autotest=1 pauses the placeholder spawner so the script owns the field
  };

  const enemies = [];
  const zones = []; // poison clouds: lifetime + 0.5 s tick, owned here because they outlive the cast
  const combat = createCombat({ renderer, stats });
  let spawnT = SPAWN_INTERVAL;
  let outT = 0;
  let killsThisWave = 0;
  let seed = 0;

  const world = {
    state,
    combat,
    stats,
    enemies,
    player: null,
    onKill,
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
    const zone = {
      inst,
      damage: sp.damage,
      x: z.x,
      left: z.left,
      right: z.right,
      duration: z.duration,
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

  const player = createPlayer({ state, combat, findTarget, findTargets, onCast: addPoisonZone, stats });
  world.player = player;

  function onKill(enemy) {
    state.embers += 1;
    stats.kills += 1;
    if (enemy) {
      stats.killsByType[enemy.type] = (stats.killsByType[enemy.type] ?? 0) + 1;
      stats.deathFx[enemy.type] = enemy.deathFx ?? null;
    }
    killsThisWave += 1;
    if (killsThisWave >= KILLS_PER_WAVE) {
      killsThisWave = 0;
      state.wave = Math.min(10, state.wave + 1);
    }
  }

  // --- the stage ---------------------------------------------------------------------
  const snow = createFx(snowFx, { x: W / 2, y: GROUND, seed: 7 });
  const candle = createFx(candleFx, { x: 24, y: GROUND, seed: 2 });
  const torchA = createFx(torchFx, { x: 108, y: TORCH_Y, seed: 4, light: 0.8 });
  const torchB = createFx(torchFx, { x: 300, y: TORCH_Y, seed: 5, light: 0.8 });

  function enterField() {
    if (state.scene !== TITLE) return false;
    state.scene = FIELD;
    state.time = 0;
    return true;
  }

  function setWave(n) {
    const v = Math.round(Number(n));
    if (Number.isFinite(v)) state.wave = Math.max(1, Math.min(10, v));
    return state.wave;
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
    const def = ENEMY_TYPES[type];
    if (!def) return 0;
    const count = Math.max(1, Math.min(20, Math.round(Number(n)) || 1));
    const at = Number.isFinite(Number(x)) ? Math.max(24, Math.min(SPAWN_X, Number(x))) : SPAWN_X;
    for (let i = 0; i < count; i++) {
      const y = def.flying ? FLY_Y : GROUND;
      enemies.push(createEnemy({ x: freeLane(at, def.flying), y, seed: ++seed, type, world }));
    }
    return count;
  }

  /**
   * One queue slot per living enemy each step, in its own lane: the front gets the guard line, everyone behind
   * it stands 34 px further right. Ties are broken by spawn order, so a batch never shares a slot. Killing or
   * knocking back the front enemy lets the rest walk forward on the next step.
   */
  function placeQueue() {
    const alive = enemies.filter((e) => !e.dead);
    const ground = alive.filter((e) => !e.flying).sort((a, b) => a.x - b.x || a.id - b.id);
    const air = alive.filter((e) => e.flying).sort((a, b) => a.x - b.x || a.id - b.id);
    ground.forEach((e, i) => e.place(GUARD_X + QUEUE_GAP * i, i === 0));
    air.forEach((e, i) => e.place(GUARD_X + QUEUE_GAP * i, i === 0));
  }

  function updateSpawner(dt) {
    if (state.spawnPaused) return; // ?autotest=1 drives the field itself
    if (state.candleOut) return; // candle out: the placeholder loop stops spawning until the refill
    spawnT -= dt;
    if (spawnT > 0) return;
    spawnT = SPAWN_INTERVAL;
    if (enemies.length >= MAX_ALIVE) return;
    spawn("slime", 1);
  }

  function updateCandleOut(dt) {
    if (!state.candleOut) {
      if (!state.god && state.candle <= 0) {
        state.candleOut = true;
        outT = CANDLE_OUT_TIME;
      }
      return;
    }
    outT -= dt;
    if (outT <= 0) {
      // M2 owns the real flow; M1 just refills and keeps going
      state.candle = state.maxCandle;
      state.candleOut = false;
      outT = 0;
    }
  }

  function update(dt, input) {
    state.time += dt;
    // the candle-bar blink is HUD feedback, so it keeps ticking through hit-stop like shake and the flash
    if (state.biteFlash > 0) state.biteFlash = Math.max(0, state.biteFlash - dt);

    if (state.scene === TITLE) {
      snow.update(dt);
      candle.update(dt);
      torchA.update(dt);
      torchB.update(dt);
      if (input && input.anyPressed()) enterField();
      return;
    }

    // input first: a cast starts on the very step the key went down
    if (input) {
      for (let i = 0; i < 6; i++) {
        if (input.pressed(`slot${i + 1}`)) {
          player.cast(i);
          break;
        }
      }
      if (input.pressed("cancel")) player.cancel("cancel");
    }

    // the act keeps ticking only to thaw its own hit-stop
    const frozen = combat.freeze > 0 || !!(player.act && player.act.frozen);
    player.update(dt, frozen);

    if (!frozen) {
      placeQueue();
      for (const e of enemies) e.update(dt);
      updateZones(dt);
      for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
      updateSpawner(dt);
      updateCandleOut(dt);
      snow.update(dt);
      candle.update(dt);
      torchA.update(dt);
      torchB.update(dt);
    }

    combat.update(dt, frozen);
  }

  function draw(frame) {
    if (state.scene === TITLE) drawTitle(frame);
    else drawField(frame);
  }

  function drawTitle(frame) {
    snow.draw(frame, "back");
    snow.draw(frame, "front");

    const p = painterFor(frame);
    p.text("CANDLELIGHT", W / 2, 64, hex("#ffe9c1"), {
      font: "big",
      scale: 2,
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });
    p.text("VIGIL", W / 2, 86, hex("#ffe9c1"), {
      font: "big",
      scale: 2,
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });

    p.text("PRESS ANY KEY", W / 2, 122, hex("#9fe8ff"), {
      font: "mini",
      align: "center",
      outline: hex("#05070d"),
    });
    p.text("1-6 CAST    ESC CANCEL", W / 2, 134, hex("#7f9cc4"), {
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

    torchA.draw(frame, "front");
    torchB.draw(frame, "front");
    candle.draw(frame, "front");

    // Ground effects (the poison cloud) live under the bodies that walk through them.
    combat.drawBack(frame);

    // Back to front: higher on the screen first (the flying lane), then the farthest x, so the enemy at the
    // guard line sits on top of its queue. The player is drawn after every enemy, so 112 px sprites can queue
    // up without swallowing him.
    const sorted = enemies.slice().sort((a, b) => a.y - b.y || b.x - a.x);
    for (const e of sorted) e.draw(frame);

    player.draw(frame);
    combat.draw(frame);
    snow.draw(frame, "front");
    drawHud(frame, state, { spells: SPELLS, cooldowns: player.cooldowns });
    combat.drawFlash(frame);
    if (state.candleOut) drawCandleOut(frame);
  }

  function drawCandleOut(frame) {
    const p = painterFor(frame);
    p.rect(0, 84, W, 20, hex("#080d16"), 0.82);
    p.text("CANDLE OUT", W / 2, 89, hex("#ff6a5a"), {
      font: "big",
      scale: 2,
      align: "center",
      outline: hex("#05070d"),
      shadow: hex("#0b1424"),
    });
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
    return {
      scene: state.scene,
      wave: state.wave,
      candle: state.candle,
      mana: state.mana,
      embers: state.embers,
      enemies: enemies
        .filter((e) => !e.dead)
        .map((e) => ({ type: e.type, hp: e.hp, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10 })),
      casting: player.casting,
      armor: Math.round(player.armor * 100) / 100,
      cooldowns: player.cooldowns.map((v) => Math.round(v * 100) / 100),
      freeze: Math.round(combat.freeze * 1000) / 1000,
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
    update,
    draw,
    snapshot,
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
  };
}
