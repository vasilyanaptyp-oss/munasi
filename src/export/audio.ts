import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mulberry32 } from "../sim/rng.js";
import type { MatchResult } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { readWav, SAMPLE_RATE, writeWav } from "./wav.js";

/**
 * Procedural audio. The repo ships no sound files, so the first export
 * synthesises them into `assets/audio/`; drop your own 16-bit PCM WAVs with the
 * same names there and they are used instead.
 */

export type SfxName = "hit" | "crit" | "death" | "spawn" | "victory";

export const SFX_FILES: Record<SfxName, string> = {
  hit: "sfx-hit.wav",
  crit: "sfx-crit.wav",
  death: "sfx-death.wav",
  spawn: "sfx-spawn.wav",
  victory: "sfx-victory.wav",
};

export const MUSIC_FILE = "music-bed.wav";
/** Long enough to cover the 60s timeout plus the victory freeze. */
const MUSIC_SECONDS = 64;

/** Mix level per event type, before the master mix in ffmpeg. */
const SFX_GAIN: Record<SfxName, number> = {
  hit: 0.45,
  crit: 0.85,
  death: 1.0,
  spawn: 0.4,
  victory: 0.9,
};

const envelope = (t: number, duration: number, attack: number, curve: number): number => {
  if (t < attack) return t / attack;
  const decayed = 1 - (t - attack) / (duration - attack);
  return decayed <= 0 ? 0 : Math.pow(decayed, curve);
};

function synthHit(): Float32Array {
  const duration = 0.14;
  const n = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  const rng = mulberry32(101);
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = envelope(t, duration, 0.002, 2.2);
    const thud = Math.sin(2 * Math.PI * (150 - 90 * (t / duration)) * t);
    const noise = rng.range(-1, 1) * 0.6;
    out[i] = (thud * 0.75 + noise * 0.45) * env * 0.9;
  }
  return out;
}

function synthCrit(): Float32Array {
  const duration = 0.4;
  const n = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  const rng = mulberry32(202);
  const partials = [1, 1.51, 2.13, 2.97, 4.21];
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = envelope(t, duration, 0.001, 2.6);
    let metal = 0;
    for (const p of partials) metal += Math.sin(2 * Math.PI * 880 * p * t) / partials.length;
    const crack = rng.range(-1, 1) * Math.pow(Math.max(0, 1 - t / 0.05), 3);
    out[i] = (metal * 0.7 + crack * 0.6) * env;
  }
  return out;
}

function synthDeath(): Float32Array {
  const duration = 0.9;
  const n = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  const rng = mulberry32(303);
  let rumble = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = envelope(t, duration, 0.004, 1.6);
    const sweep = Math.sin(2 * Math.PI * (180 - 150 * (t / duration)) * t);
    // One-pole lowpass on white noise gives a dull collapse rather than hiss.
    rumble += (rng.range(-1, 1) - rumble) * 0.06;
    out[i] = (sweep * 0.8 + rumble * 0.9) * env;
  }
  return out;
}

function synthSpawn(): Float32Array {
  const duration = 0.3;
  const n = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = envelope(t, duration, 0.01, 1.8);
    const chirp = Math.sin(2 * Math.PI * (330 + 520 * (t / duration)) * t);
    out[i] = chirp * env * 0.55;
  }
  return out;
}

function synthVictory(): Float32Array {
  const duration = 1.3;
  const n = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, idx) => {
    const start = Math.round(idx * 0.12 * SAMPLE_RATE);
    const len = n - start;
    for (let i = 0; i < len; i += 1) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, duration - idx * 0.12, 0.005, 2);
      out[start + i]! += Math.sin(2 * Math.PI * freq * t) * env * 0.22;
    }
  });
  return out;
}

/** A quiet loopable bed: minor-pentatonic arpeggio over a simple beat. */
function synthMusic(seconds: number, seed: number): Float32Array {
  const n = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const rng = mulberry32(seed);
  const bpm = 124;
  const beat = 60 / bpm;
  const eighth = beat / 2;
  const root = 110; // A2
  const pentatonic = [0, 3, 5, 7, 10, 12];

  const steps = Math.floor(seconds / eighth);
  for (let step = 0; step < steps; step += 1) {
    const start = Math.round(step * eighth * SAMPLE_RATE);
    const degree = pentatonic[rng.int(pentatonic.length)]!;
    const octave = rng.chance(0.3) ? 2 : 1;
    const freq = root * octave * Math.pow(2, degree / 12);
    const len = Math.min(Math.round(eighth * 1.6 * SAMPLE_RATE), n - start);
    for (let i = 0; i < len; i += 1) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, eighth * 1.6, 0.006, 2.4);
      // Slightly detuned pair — thicker than a bare sine, cheaper than a filter.
      const tone =
        Math.sin(2 * Math.PI * freq * t) * 0.6 + Math.sin(2 * Math.PI * freq * 1.005 * t) * 0.4;
      out[start + i]! += tone * env * 0.13;
    }

    // Kick on the downbeats, snare on the backbeats, hat on every eighth.
    const inBar = step % 8;
    if (inBar === 0 || inBar === 4) {
      const len2 = Math.min(Math.round(0.2 * SAMPLE_RATE), n - start);
      for (let i = 0; i < len2; i += 1) {
        const t = i / SAMPLE_RATE;
        const env = envelope(t, 0.2, 0.001, 3);
        out[start + i]! += Math.sin(2 * Math.PI * (95 - 55 * (t / 0.2)) * t) * env * 0.3;
      }
    }
    if (inBar === 2 || inBar === 6) {
      const len2 = Math.min(Math.round(0.16 * SAMPLE_RATE), n - start);
      for (let i = 0; i < len2; i += 1) {
        const t = i / SAMPLE_RATE;
        const env = envelope(t, 0.16, 0.001, 3);
        out[start + i]! += rng.range(-1, 1) * env * 0.12;
      }
    }
    const hatLen = Math.min(Math.round(0.05 * SAMPLE_RATE), n - start);
    for (let i = 0; i < hatLen; i += 1) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, 0.05, 0.001, 4);
      out[start + i]! += rng.range(-1, 1) * env * 0.05;
    }
  }
  return out;
}

const SYNTHS: Record<SfxName, () => Float32Array> = {
  hit: synthHit,
  crit: synthCrit,
  death: synthDeath,
  spawn: synthSpawn,
  victory: synthVictory,
};

/**
 * Makes sure every audio asset exists, synthesising the missing ones.
 * Returns the directory it used.
 */
export function ensureAudioAssets(dir = join(process.cwd(), "assets", "audio")): string {
  mkdirSync(dir, { recursive: true });
  for (const [name, file] of Object.entries(SFX_FILES) as [SfxName, string][]) {
    const path = join(dir, file);
    if (!existsSync(path)) writeWav(path, { sampleRate: SAMPLE_RATE, samples: SYNTHS[name]() });
  }
  const music = join(dir, MUSIC_FILE);
  if (!existsSync(music)) {
    writeWav(music, { sampleRate: SAMPLE_RATE, samples: synthMusic(MUSIC_SECONDS, 7) });
  }
  return dir;
}

/** Which sample an event triggers, if any. */
function sfxForEvent(type: string): SfxName | null {
  switch (type) {
    case "hit":
      return "hit";
    case "crit":
      return "crit";
    case "death":
      return "death";
    case "spawn":
      return "spawn";
    case "victory":
      return "victory";
    default:
      return null;
  }
}

export interface SfxTrackOptions {
  /** Total frames in the video, including any victory freeze. */
  totalFrames: number;
  /** Where the WAV assets live. */
  audioDir?: string;
  /**
   * Simulation frame shown at each output frame. Needed whenever the video is
   * not a straight play-through — a cold open replays part of the fight, and
   * those hits have to be heard again at the position they are shown.
   */
  sourceFrames?: number[];
}

/**
 * Renders the match's events into a single SFX bus. Doing the per-event
 * placement here keeps the ffmpeg graph to one `amix` instead of hundreds of
 * `adelay` inputs, and it stays deterministic because it is driven purely by
 * the event list.
 */
export function buildSfxTrack(result: MatchResult, options: SfxTrackOptions): Float32Array {
  const dir = ensureAudioAssets(options.audioDir);
  const cache = new Map<SfxName, Float32Array>();
  const load = (name: SfxName): Float32Array => {
    const cached = cache.get(name);
    if (cached) return cached;
    const pcm = readWav(join(dir, SFX_FILES[name]));
    if (pcm.sampleRate !== SAMPLE_RATE) {
      throw new Error(
        `${SFX_FILES[name]}: expected ${SAMPLE_RATE} Hz, got ${pcm.sampleRate} Hz`,
      );
    }
    cache.set(name, pcm.samples);
    return pcm.samples;
  };

  const length = Math.round((options.totalFrames / FPS) * SAMPLE_RATE) + SAMPLE_RATE;
  const track = new Float32Array(length);

  // Output frames each simulation frame appears at. Usually one, but a frame
  // replayed in a cold open appears twice and must sound twice.
  const playedAt = new Map<number, number[]>();
  if (options.sourceFrames) {
    options.sourceFrames.forEach((source, output) => {
      const list = playedAt.get(source);
      if (list) list.push(output);
      else playedAt.set(source, [output]);
    });
  }

  for (const event of result.events) {
    const name = sfxForEvent(event.type);
    if (!name) continue;
    const sample = load(name);
    const gain = SFX_GAIN[name];
    const outputs = options.sourceFrames
      ? (playedAt.get(event.frame) ?? [])
      : [event.frame];
    for (const output of outputs) {
      const start = Math.round((output / FPS) * SAMPLE_RATE);
      if (start >= length) continue;
      const count = Math.min(sample.length, length - start);
      for (let i = 0; i < count; i += 1) track[start + i]! += sample[i]! * gain;
    }
  }

  // Soft-clip so a pile-up of simultaneous hits does not turn into distortion.
  for (let i = 0; i < track.length; i += 1) track[i] = Math.tanh(track[i]!);
  return track;
}

export function writeSfxTrack(path: string, samples: Float32Array): void {
  writeWav(path, { sampleRate: SAMPLE_RATE, samples });
}
