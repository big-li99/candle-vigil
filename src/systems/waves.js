// The ten waves of DESIGN §2.8, as data. Each wave states what it sends (`batches`, in spawn order), how far
// apart those spawns are (`interval`) and how many bodies may share the screen (`maxAlive`). Waves 5 and 10
// send the M2c boss: wave 5 is the boss alone, wave 10 opens with the boss and only starts its mixed batch
// `bossReinforceDelay` seconds later.
//
// A batch is only a grouping: wave 8 is the brief's "mixed 12 in two batches", sent at the wave's own 1.4 s
// interval. Nothing here is timed by hand anywhere else — the field reads these numbers and nothing more.

export const DEFAULT_MAX_ALIVE = 6;
export const WAVE8_MAX_ALIVE = 8;

/** n: wave number · interval: seconds between two spawns · maxAlive: living bodies allowed at once. */
export const WAVES = [
  {
    n: 1,
    interval: 2.6,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "slime", count: 5 }]],
  },
  {
    n: 2,
    interval: 2.4,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "slime", count: 6 }, { type: "ghost", count: 2 }]],
  },
  {
    n: 3,
    interval: 1.8,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "ghost", count: 4 }, { type: "skull", count: 3 }]],
  },
  {
    n: 4,
    interval: 3.0,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "eyeball", count: 1 }, { type: "slime", count: 6 }]],
  },
  {
    n: 5, // the bone-fire lord alone
    interval: 2.2,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "boss", count: 1 }]],
  },
  {
    n: 6,
    interval: 1.6,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "skull", count: 5 }, { type: "eyeball", count: 1 }]],
  },
  {
    n: 7,
    interval: 2.4,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "ghost", count: 4 }, { type: "eyeball", count: 2 }]],
  },
  {
    n: 8,
    interval: 1.4,
    maxAlive: WAVE8_MAX_ALIVE,
    // two batches, six bodies each; four of every type across the wave
    batches: [
      [{ type: "slime", count: 2 }, { type: "ghost", count: 2 }, { type: "skull", count: 2 }],
      [{ type: "slime", count: 2 }, { type: "ghost", count: 2 }, { type: "skull", count: 2 }],
    ],
  },
  {
    n: 9,
    interval: 1.8,
    maxAlive: DEFAULT_MAX_ALIVE,
    batches: [[{ type: "eyeball", count: 3 }, { type: "skull", count: 4 }]],
  },
  {
    n: 10, // the boss first, then the mixed batch it used to send, 20 s later
    interval: 1.4,
    // BOSS + six small bodies is the acceptance frame; seven is still under the DESIGN §2.3 ceiling of eight
    maxAlive: 7,
    bossReinforceDelay: 20,
    batches: [
      [{ type: "boss", count: 1 }],
      [{ type: "eyeball", count: 3 }, { type: "skull", count: 6 }],
    ],
  },
];

export const MAX_WAVE = WAVES.length;

/** The wave definition for n (1-based), clamped into the table. */
export function waveDef(n) {
  const i = Math.max(1, Math.min(MAX_WAVE, Math.round(Number(n) || 1))) - 1;
  return WAVES[i];
}

/** The flattened spawn queue for a wave, in order. */
export function queueFor(n) {
  const out = [];
  for (const batch of waveDef(n).batches) {
    for (const group of batch) {
      for (let i = 0; i < group.count; i++) out.push(group.type);
    }
  }
  return out;
}
