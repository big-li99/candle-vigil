// All sound is synthesised at the moment an event happens: one AudioContext, one master gain, square/triangle
// oscillators and filtered noise with short envelopes. No audio files, no nodes are ever created while drawing,
// and every node disconnects itself when it ends. A browser without WebAudio (or with a suspended context)
// simply gets silence — nothing here may throw, and no game logic may depend on a sound.
export const MASTER_VOLUME = 0.35;
export const MUTE_KEY = "candle-vigil:muted";

function readMuted() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = readMuted();
  let events = 0;
  let last = "";

  function ensure() {
    if (ctx) return ctx;
    const AC =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : typeof webkitAudioContext !== "undefined"
          ? webkitAudioContext
          : null;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  /** The first key/click of the session: create the context and resume it out of the browser's autoplay pause. */
  function unlock() {
    const c = ensure();
    if (!c) return false;
    try {
      if (c.state === "suspended" && typeof c.resume === "function") c.resume().catch(() => {});
    } catch {
      // an unavailable device stays silent; it must never break the game
    }
    return true;
  }

  function setMuted(on) {
    muted = !!on;
    try {
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
    } catch {
      // ignore a dead context
    }
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // private mode / file://: the switch still works for this session
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  // --- node helpers: every call creates its nodes, schedules them, and disconnects when the sound ends ----

  function at(delay = 0) {
    return ctx.currentTime + Math.max(0, delay) + 0.005;
  }

  function envelope(g, t0, peak, dur, attack) {
    const a = Math.max(0.002, Math.min(attack, dur * 0.5));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function tone({ type = "square", f0 = 440, f1 = f0, dur = 0.12, gain = 0.18, delay = 0, attack = 0.004 }) {
    const t0 = at(delay);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(30, f0), t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    envelope(g, t0, gain, dur, attack);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
    o.onended = () => {
      try {
        o.disconnect();
        g.disconnect();
      } catch {
        // already torn down
      }
    };
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const n = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = s / 0x3fffffff - 1;
    }
    return noiseBuf;
  }

  function hiss({ dur = 0.15, gain = 0.15, from = 3000, to = 800, type = "highpass", q = 0.8, delay = 0, attack = 0.004 }) {
    const t0 = at(delay);
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, from), t0);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = ctx.createGain();
    envelope(g, t0, gain, dur, attack);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
    src.onended = () => {
      try {
        src.disconnect();
        f.disconnect();
        g.disconnect();
      } catch {
        // already torn down
      }
    };
  }

  function thud({ f0 = 100, f1 = 55, dur = 0.18, gain = 0.26, delay = 0 }) {
    tone({ type: "sine", f0, f1, dur, gain, delay, attack: 0.003 });
    hiss({ dur: Math.min(0.2, dur), gain: gain * 0.32, from: 420, to: 110, type: "lowpass", delay });
  }

  // --- the event palette (DESIGN §2.11 / the M3 brief's table) ------------------------------------------

  const SOUNDS = {
    // 1 · sword slash: a short high swish when the act starts, a lower "thwack" when it lands
    slash() {
      hiss({ dur: 0.12, gain: 0.16, from: 5200, to: 900, type: "highpass", q: 1.2 });
      tone({ type: "triangle", f0: 1200, f1: 420, dur: 0.09, gain: 0.07 });
    },
    slashHit() {
      tone({ type: "square", f0: 220, f1: 90, dur: 0.09, gain: 0.18, attack: 0.002 });
      hiss({ dur: 0.07, gain: 0.12, from: 1800, to: 300, type: "lowpass" });
    },
    // 2 · hammer: a low boom with a noise tail
    hammer() {
      tone({ type: "sine", f0: 85, f1: 34, dur: 0.32, gain: 0.42, attack: 0.003 });
      hiss({ dur: 0.28, gain: 0.18, from: 900, to: 80, type: "lowpass", q: 0.7 });
    },
    // 3 · frost nova: three crisp ascending notes
    nova() {
      for (const [f, d] of [
        [523, 0],
        [659, 0.075],
        [784, 0.15],
      ]) {
        tone({ type: "triangle", f0: f, f1: f, dur: 0.18, gain: 0.12, delay: d, attack: 0.005 });
      }
      hiss({ dur: 0.22, gain: 0.05, from: 6000, to: 2600, type: "highpass", delay: 0.04 });
    },
    // 4 · lightning: a crack of noise over a low thunder
    bolt() {
      hiss({ dur: 0.16, gain: 0.3, from: 9000, to: 1200, type: "highpass", q: 1.4 });
      tone({ type: "sawtooth", f0: 58, f1: 26, dur: 0.34, gain: 0.34, attack: 0.006 });
      tone({ type: "square", f0: 180, f1: 55, dur: 0.12, gain: 0.12, delay: 0.02 });
    },
    // 5 · poison cloud: one low "gurgle", never a loop
    poison() {
      tone({ type: "triangle", f0: 130, f1: 70, dur: 0.3, gain: 0.2, attack: 0.02 });
      hiss({ dur: 0.26, gain: 0.1, from: 500, to: 120, type: "lowpass", q: 1.2, delay: 0.02 });
    },
    // 6 · heal: two soft sine notes rising
    heal() {
      tone({ type: "sine", f0: 440, f1: 440, dur: 0.18, gain: 0.14, attack: 0.02 });
      tone({ type: "sine", f0: 660, f1: 660, dur: 0.22, gain: 0.12, attack: 0.02, delay: 0.12 });
    },
    // kill: a short ding; every combo step raises it by 2 semitones, capped at +12
    kill(d) {
      const semis = Math.min(12, Math.max(0, Math.round(Number(d.combo) || 1) * 2));
      const f = 880 * Math.pow(2, semis / 12);
      tone({ type: "sine", f0: f, f1: f, dur: 0.11, gain: 0.14, attack: 0.002 });
      tone({ type: "triangle", f0: f * 2, f1: f * 2, dur: 0.07, gain: 0.05, delay: 0.005 });
    },
    // block: a metal clang with a high harmonic
    block() {
      tone({ type: "square", f0: 1500, f1: 1200, dur: 0.1, gain: 0.14, attack: 0.002 });
      tone({ type: "sine", f0: 2600, f1: 2400, dur: 0.16, gain: 0.08, delay: 0.01 });
      hiss({ dur: 0.08, gain: 0.1, from: 7000, to: 4000, type: "highpass" });
    },
    // bitten: a low muffled thud, deliberately not harsh
    bite() {
      thud({ f0: 110, f1: 62, dur: 0.16, gain: 0.26 });
    },
    // a wave horn: two notes; a boss wave is lower and slower
    wave(d) {
      const boss = !!d.boss;
      const plus = boss ? 0.3 : 0.16;
      tone({ type: "triangle", f0: boss ? 98 : 196, f1: boss ? 98 : 196, dur: boss ? 0.3 : 0.2, gain: 0.18, attack: 0.02 });
      tone({
        type: "triangle",
        f0: boss ? 147 : 294,
        f1: boss ? 147 : 294,
        dur: boss ? 0.3 : 0.2,
        gain: 0.16,
        attack: 0.02,
        delay: plus,
      });
      if (boss) tone({ type: "sine", f0: 49, f1: 49, dur: 0.34, gain: 0.12, attack: 0.03 });
    },
    // the boss's tell: rising filtered fire, complete inside the 1.5 s telegraph
    breath() {
      hiss({ dur: 1.4, gain: 0.18, from: 280, to: 2800, type: "bandpass", q: 1.6, attack: 0.08 });
      tone({ type: "sawtooth", f0: 48, f1: 96, dur: 1.4, gain: 0.08, attack: 0.1 });
    },
    // the two run ends: three notes down, four notes up
    fail() {
      for (const [f, d] of [
        [392, 0],
        [330, 0.22],
        [262, 0.44],
      ]) {
        tone({ type: "triangle", f0: f, f1: f, dur: 0.24, gain: 0.16, delay: d, attack: 0.01 });
      }
    },
    victory() {
      for (const [f, d] of [
        [262, 0],
        [330, 0.16],
        [392, 0.32],
        [523, 0.48],
      ]) {
        tone({ type: "triangle", f0: f, f1: f, dur: 0.22, gain: 0.16, delay: d, attack: 0.01 });
      }
    },
  };

  /**
   * Play an event. If the context was never unlocked, is suspended, or the device has no audio, this is a
   * silent no-op: sounds are feedback only and may never throw into the game loop.
   */
  function sfx(name, data = {}) {
    events++;
    last = name;
    if (muted || !ctx || ctx.state !== "running") return false;
    const play = SOUNDS[name];
    if (!play) return false;
    try {
      play(data ?? {});
      return true;
    } catch {
      return false;
    }
  }

  return {
    unlock,
    sfx,
    setMuted,
    toggleMute,
    get muted() {
      return muted;
    },
    get events() {
      return events;
    },
    get last() {
      return last;
    },
    get state() {
      return ctx ? ctx.state : "unavailable";
    },
  };
}
