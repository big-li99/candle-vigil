// Scene state machine. M0 only knows two states: title and the empty snow-night field.
import {
  createFx,
  painterFor,
  drawActor,
  stockActor,
  hex,
  HERO,
  HERO_PAL,
} from "../vendor/pixelfx/src/core/index.js";
import * as snowFx from "../vendor/pixelfx/src/fx/weather/snow.js";
import * as candleFx from "../vendor/pixelfx/src/fx/fire/candle.js";
import * as torchFx from "../vendor/pixelfx/src/fx/fire/torch.js";
import { W, H, GROUND } from "./frame.js";
import { drawHud } from "./ui/hud.js";

const TITLE = "title";
const FIELD = "field";

const FLOOR = hex("#0a1322");
const FLOOR_EDGE = hex("#2b4266");
const FLOOR_SEAM = hex("#14223a");
const FLOOR_SPECK_A = hex("#203659");
const FLOOR_SPECK_B = hex("#16263f");
const PLAYER_X = 56;
const OUTLINE = hex("#050912");
const PLAYER = stockActor(1);

export function createGame({ input } = {}) {
  const state = {
    scene: TITLE,
    wave: 1,
    candle: 100,
    maxCandle: 100,
    mana: 60,
    maxMana: 100,
    god: false,
    time: 0,
  };

  const snow = createFx(snowFx, { x: W / 2, y: GROUND, seed: 7 });
  const candle = createFx(candleFx, { x: 24, y: GROUND, seed: 2 });
  const torchA = createFx(torchFx, { x: 112, y: 146, seed: 4 });
  const torchB = createFx(torchFx, { x: 296, y: 146, seed: 5 });

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

  function update(dt) {
    state.time += dt;
    snow.update(dt);

    if (state.scene === TITLE) {
      if (input && input.anyPressed()) enterField();
      return;
    }

    candle.update(dt);
    torchA.update(dt);
    torchB.update(dt);
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

    p.text("PRESS ANY KEY", W / 2, 132, hex("#9fe8ff"), {
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

    // The floor is painted after the snow's low haze so the seam between the weather box and the
    // screen edge stays invisible below the ground line.
    let p = painterFor(frame);
    drawGround(p);

    torchA.draw(frame, "front");
    torchB.draw(frame, "front");
    candle.draw(frame, "front");

    p = painterFor(frame);
    drawPlayer(p);

    snow.draw(frame, "front");
    drawHud(frame, state);
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

  function drawPlayer(p) {
    // Standing placeholder: stock actor, 1 px breath at 3 fps, dark outline so he reads over the snow.
    const bob = Math.floor(state.time * 3) % 2;
    p.place(PLAYER_X, GROUND - bob);
    p.ellipse(0, 0, 9, 2, OUTLINE, 0.55);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      p.sprite(HERO, HERO_PAL, PLAYER.x + dx, PLAYER.y + dy, { tint: OUTLINE });
    }
    drawActor(p, PLAYER);
  }

  function snapshot(stats) {
    return {
      scene: state.scene,
      wave: state.wave,
      candle: state.candle,
      mana: state.mana,
      enemies: [],
      casting: false,
      god: state.god,
      fps: stats ? stats.fps : 0,
    };
  }

  return {
    state,
    enterField,
    setWave,
    update,
    draw,
    snapshot,
    entityCount: () => 0,
    get scene() {
      return state.scene;
    },
    get wave() {
      return state.wave;
    },
  };
}
