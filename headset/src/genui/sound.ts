/**
 * The `sound` a generated module gets in build(): short synthesized sounds, and the game's own generated clips from
 * the asset library (a bat's chirp, a music loop: /api/media/<id>). Games use it to answer the hands (a pop, a
 * click, a win) and to teach with sound itself (a string's pitch, an engine whose hum rises with its speed, a
 * rhythm). Loud or endless sound is not possible: one master level, a limiter, a cap on how many sounds play at once
 * and how many start each second, and every hum and loop stops when the lesson closes.
 */

export type SoundName = 'pop' | 'click' | 'good' | 'bad' | 'whoosh' | 'tick' | 'win' | 'coin' | 'bounce' | 'splash';
export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type ModuleSound = {
  /** A ready-made effect. pitch multiplies its frequencies (1 = as made), volume 0..1. */
  play(name: SoundName, o?: { pitch?: number; volume?: number }): void;
  /** One tone: frequency in Hz (20-4000), seconds (0.02-3), a wave shape, volume 0..1, glide to another frequency. */
  tone(frequency: number, o?: { seconds?: number; type?: Wave; volume?: number; glide?: number }): void;
  /** A musical note by name ('C4', 'F#3', 'Bb5'); the same options as tone. */
  note(name: string, o?: { seconds?: number; type?: Wave; volume?: number }): void;
  /** A continuous sound kept by id (an engine, the wind, a string held): call it every frame to change it, or with
   *  null to stop it. At most 4 at once. */
  hum(id: string, o: { frequency: number; volume?: number; type?: Wave } | null): void;
  /** A generated clip by its asset id ('snd-…' or 'mus-…'): volume 0..1, loop to repeat (music) until stop(). The
   *  first play fetches it, so load(id) it in build() to have it ready. */
  clip(id: string, o?: { volume?: number; loop?: boolean }): { stop(): void };
  /** Fetch a clip ahead of its first play. */
  load(id: string): void;
};

const CLIP_ID = /^(snd|mus)-[0-9a-f]{10}$/;

const MASTER = 0.35;
const MAX_VOICES = 12;
const MAX_STARTS_PER_S = 30;
const MAX_HUMS = 4;
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

let context: AudioContext | null = null;
let master: GainNode | null = null;

/** Note name to Hz ('A4' = 440). Null for a name that is not a note. */
export function noteHz(name: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(String(name));
  if (!m) return null;
  const semis = STEP[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12 - 9;
  return 440 * Math.pow(2, semis / 12);
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    if (!context) {
      context = new AudioContext();
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.ratio.value = 12;
      master = context.createGain();
      master.gain.value = MASTER;
      master.connect(limiter).connect(context.destination);
    }
    // Entering the headset session is the user gesture that lets audio start; resume quietly if it was suspended.
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return { ctx: context, out: master! };
  } catch {
    return null; // no Web Audio: the module runs silent
  }
}

const appClips = new Map<string, Promise<AudioBuffer | null>>();

const CLIP_WAIT_MS = 1500; // how long a clip waits for the audio to start; later it would be out of place

/**
 * Play a sound file shipped with the app (under public/) once, `delay` seconds from now, through the app's audio:
 * Muse's spoken hello. Silent where the browser allows no sound yet (nothing has been tapped on the page): a clip
 * that cannot start within a moment is dropped, not played at the next tap.
 */
export function playAppClip(url: string, delay = 0): void {
  const asked = performance.now();
  const a = audio();
  if (!a) return;
  let pending = appClips.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((reply) => (reply.ok ? reply.arrayBuffer() : Promise.reject(new Error(`HTTP ${reply.status}`))))
      .then((data) => a.ctx.decodeAudioData(data))
      .catch(() => { appClips.delete(url); return null; });
    appClips.set(url, pending);
  }
  void pending.then((buffer) => {
    if (!buffer) return;
    const play = () => {
      const source = a.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(a.out);
      source.start(a.ctx.currentTime + delay);
    };
    if (a.ctx.state === 'running') play();
    else a.ctx.resume().then(() => { if (a.ctx.state === 'running' && performance.now() - asked < CLIP_WAIT_MS) play(); }).catch(() => {});
  });
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** A sound for one mounted module. dispose() stops its hums. */
export function createModuleSound(): ModuleSound & { dispose(): void } {
  let voices = 0;
  let windowStart = 0;
  let starts = 0;
  const hums = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  const clips = new Map<string, Promise<AudioBuffer | null>>();
  const loops = new Set<AudioBufferSourceNode>();
  let closed = false;

  function fetchClip(id: string): Promise<AudioBuffer | null> {
    if (!CLIP_ID.test(String(id))) return Promise.resolve(null);
    let pending = clips.get(id);
    if (!pending) {
      pending = (async () => {
        const a = audio();
        if (!a) return null;
        const reply = await fetch(`/api/media/${id}`);
        // Music still being made (425) or missing: forget it, so a later play asks again.
        if (!reply.ok) { clips.delete(id); return null; }
        return await a.ctx.decodeAudioData(await reply.arrayBuffer());
      })().catch(() => { clips.delete(id); return null; });
      clips.set(id, pending);
    }
    return pending;
  }

  function allowed(ctx: AudioContext): boolean {
    if (ctx.currentTime - windowStart >= 1) { windowStart = ctx.currentTime; starts = 0; }
    if (voices >= MAX_VOICES || starts >= MAX_STARTS_PER_S) return false;
    starts++;
    return true;
  }

  function voice(frequency: number, seconds: number, type: Wave, volume: number, glide?: number, delay = 0) {
    const a = audio();
    if (!a || !allowed(a.ctx)) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(clamp(frequency, 20, 4000, 440), t);
    if (glide !== undefined) osc.frequency.exponentialRampToValueAtTime(clamp(glide, 20, 4000, 440), t + seconds);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + Math.min(0.01, seconds / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain).connect(out);
    voices++;
    osc.onended = () => { voices--; osc.disconnect(); gain.disconnect(); };
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  function noise(seconds: number, volume: number, from: number, to: number) {
    const a = audio();
    if (!a || !allowed(a.ctx)) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter).connect(gain).connect(out);
    voices++;
    source.onended = () => { voices--; source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(t);
  }

  const sound = {
    play(name: SoundName, o: { pitch?: number; volume?: number } = {}) {
      const p = clamp(o.pitch, 0.25, 4, 1);
      const v = clamp(o.volume, 0, 1, 0.7);
      switch (name) {
        case 'pop': voice(520 * p, 0.09, 'sine', v, 900 * p); break;
        case 'click': voice(1800 * p, 0.03, 'square', v * 0.4); break;
        case 'tick': voice(1200 * p, 0.04, 'triangle', v * 0.5); break;
        case 'good': voice(660 * p, 0.12, 'triangle', v); voice(990 * p, 0.18, 'triangle', v, undefined, 0.09); break;
        case 'bad': voice(220 * p, 0.25, 'sawtooth', v * 0.35, 150 * p); break;
        case 'coin': voice(988 * p, 0.07, 'square', v * 0.35); voice(1319 * p, 0.2, 'square', v * 0.35, undefined, 0.07); break;
        case 'bounce': voice(180 * p, 0.15, 'sine', v, 90 * p); break;
        case 'win': [523, 659, 784, 1047].forEach((f, i) => voice(f * p, 0.22, 'triangle', v, undefined, i * 0.11)); break;
        case 'whoosh': noise(0.35, v * 0.5, 300 * p, 2400 * p); break;
        case 'splash': noise(0.45, v * 0.6, 1800 * p, 250 * p); break;
        default: {
          const unexpected: never = name;
          void unexpected;
          break;
        }
      }
    },
    tone(frequency: number, o: { seconds?: number; type?: Wave; volume?: number; glide?: number } = {}) {
      voice(frequency, clamp(o.seconds, 0.02, 3, 0.3), o.type ?? 'sine', clamp(o.volume, 0, 1, 0.6), o.glide);
    },
    note(name: string, o: { seconds?: number; type?: Wave; volume?: number } = {}) {
      const hz = noteHz(name);
      if (hz) sound.tone(hz, { ...o, type: o.type ?? 'triangle' });
    },
    hum(id: string, o: { frequency: number; volume?: number; type?: Wave } | null) {
      const a = audio();
      if (!a) return;
      const { ctx, out } = a;
      const live = hums.get(id);
      if (o === null) {
        if (!live) return;
        live.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        live.osc.stop(ctx.currentTime + 0.3);
        hums.delete(id);
        return;
      }
      if (!live) {
        if (hums.size >= MAX_HUMS) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = o.type ?? 'sawtooth';
        gain.gain.value = 0;
        osc.connect(gain).connect(out);
        osc.start();
        hums.set(id, { osc, gain });
      }
      const h = hums.get(id)!;
      h.osc.frequency.setTargetAtTime(clamp(o.frequency, 20, 4000, 110), ctx.currentTime, 0.03);
      h.gain.gain.setTargetAtTime(clamp(o.volume, 0, 1, 0.3) * 0.5, ctx.currentTime, 0.05);
    },
    clip(id: string, o: { volume?: number; loop?: boolean } = {}) {
      let source: AudioBufferSourceNode | null = null;
      let stopped = false;
      void fetchClip(id).then((buffer) => {
        const a = audio();
        if (!buffer || !a || stopped || closed || (!o.loop && !allowed(a.ctx))) return;
        const gain = a.ctx.createGain();
        gain.gain.value = clamp(o.volume, 0, 1, 0.7);
        source = a.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = o.loop === true;
        source.connect(gain).connect(a.out);
        voices++;
        const playing = source;
        playing.onended = () => { voices--; loops.delete(playing); playing.disconnect(); gain.disconnect(); };
        if (playing.loop) loops.add(playing);
        playing.start();
      });
      return {
        stop() {
          stopped = true;
          try { source?.stop(); } catch { /* already stopped */ }
        },
      };
    },
    load(id: string) {
      void fetchClip(id);
    },
    dispose() {
      closed = true;
      for (const source of loops) {
        try { source.stop(); } catch { /* already stopped */ }
      }
      loops.clear();
      const a = context;
      for (const h of hums.values()) {
        try {
          h.gain.gain.setTargetAtTime(0, a?.currentTime ?? 0, 0.03);
          h.osc.stop((a?.currentTime ?? 0) + 0.15);
        } catch {
          // already stopped
        }
      }
      hums.clear();
    },
  };
  return sound;
}
