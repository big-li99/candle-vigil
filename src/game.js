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
import { createEnemy, SPAWN_X } from "./entities/enemy.js";
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

const SPAWN_INTERVAL = 2.4; // s between slimes (M1 placeholder for the M2 wave table)
const MAX_ALIVE = 6;
const KILLS_PER_WAVE = 12;
const CANDLE_OUT_TIME = 2;

export function createGame({ input, renderer = null, stats = {} } = {}) {
  stats.fps ??= 0;
  stats.hits ??= 0;
  stats.kills ??= 0;
  stats.freezes ??= 0;

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
  };

  const enemies = [];
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

  // The frontmost slime inside the spell's reach (reach is measured from the player's x).
  function findTarget(sp) {
    let best = null;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = e.x - PLAYER_X;
      if (d < 0 || d > sp.reach) continue;
      if (!best || e.x < best.x) best = e;
    }
    return best;
  }

  const player = createPlayer({ state, combat, findTarget });
  world.player = player;

  function onKill() {
    state.embers += 1;
    stats.kills += 1;
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

  function spawn(type = "slime", n = 1, x = SPAWN_X) {
    if (String(type) !== "slime") return 0; // M1 has one enemy type
    const count = Math.max(1, Math.min(20, Math.round(Number(n)) || 1));
    const at = Number.isFinite(Number(x)) ? Math.max(24, Math.min(SPAWN_X, Number(x))) : SPAWN_X;
    for (let i = 0; i < count; i++) {
      enemies.push(createEnemy({ x: at, y: GROUND, seed: ++seed, world }));
    }
    return count;
  }

  function updateSpawner(dt) {
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
      if (input.pressed("slot1")) player.cast(0);
      else if (input.pressed("slot2")) player.cast(1);
      if (input.pressed("cancel")) player.cancel("cancel");
    }

    // the act keeps ticking only to thaw its own hit-stop
    const frozen = combat.freeze > 0 || !!(player.act && player.act.frozen);
    player.update(dt, frozen);

    if (!frozen) {
      for (const e of enemies) e.update(dt);
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
    p.text("1 SLASH   2 HAMMER   ESC CANCEL", W / 2, 134, hex("#7f9cc4"), {
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

    // enemies are drawn back to front by x, so a slime that got knocked past another reads correctly
    const sorted = enemies.slice().sort((a, b) => a.x - b.x);
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
        .map((e) => ({ type: e.type, hp: e.hp, x: Math.round(e.x * 10) / 10 })),
      casting: player.casting,
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
    entityCount: () => enemies.length,
    get scene() {
      return state.scene;
    },
    get wave() {
      return state.wave;
    },
  };
}
