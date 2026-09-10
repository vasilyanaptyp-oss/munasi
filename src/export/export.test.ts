import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { renderFrames } from "../render/index.js";
import { simulate } from "../sim/simulate.js";
import { abilityMatch } from "../sim/testFixtures.js";
import type { MatchResult } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { buildSfxTrack, ensureAudioAssets, MUSIC_FILE, SFX_FILES } from "./audio.js";
import { checkFfmpeg, exportVideo, slug, videoFileName, VICTORY_FREEZE_FRAMES } from "./video.js";
import { readWav, SAMPLE_RATE, writeWav } from "./wav.js";

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function truncate(result: MatchResult, frames: number): MatchResult {
  return {
    ...result,
    snapshots: result.snapshots.slice(0, frames),
    events: result.events.filter((e) => e.frame < frames),
    durationFrames: frames,
  };
}

describe("wav io", () => {
  it("round-trips samples within 16-bit precision", () => {
    const dir = tempDir("munasi-wav-");
    const path = join(dir, "tone.wav");
    const samples = new Float32Array(1000);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 0.5;
    }
    writeWav(path, { sampleRate: SAMPLE_RATE, samples });

    const back = readWav(path);
    expect(back.sampleRate).toBe(SAMPLE_RATE);
    expect(back.samples.length).toBe(samples.length);
    let worst = 0;
    for (let i = 0; i < samples.length; i += 1) {
      worst = Math.max(worst, Math.abs(back.samples[i]! - samples[i]!));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const dir = tempDir("munasi-wav-");
    const path = join(dir, "loud.wav");
    writeWav(path, { sampleRate: SAMPLE_RATE, samples: Float32Array.from([2, -2, 0]) });
    const back = readWav(path);
    expect(back.samples[0]).toBeCloseTo(1, 3);
    expect(back.samples[1]).toBeCloseTo(-1, 3);
  });

  it("rejects files that are not WAV", () => {
    const dir = tempDir("munasi-wav-");
    const path = join(dir, "nope.wav");
    writeWav(path, { sampleRate: SAMPLE_RATE, samples: new Float32Array(4) });
    expect(() => readWav(join(dir, "missing.wav"))).toThrow();
  });
});

describe("audio assets", () => {
  it("synthesises every missing asset", () => {
    const dir = tempDir("munasi-audio-");
    ensureAudioAssets(dir);
    for (const file of Object.values(SFX_FILES)) expect(existsSync(join(dir, file))).toBe(true);
    expect(existsSync(join(dir, MUSIC_FILE))).toBe(true);
  });

  it("leaves an existing asset alone so users can supply their own", () => {
    const dir = tempDir("munasi-audio-");
    const custom = join(dir, SFX_FILES.hit);
    writeWav(custom, { sampleRate: SAMPLE_RATE, samples: Float32Array.from([0.5, 0.5, 0.5]) });
    ensureAudioAssets(dir);
    expect(readWav(custom).samples.length).toBe(3);
  });
});

describe("buildSfxTrack", () => {
  const result = simulate(abilityMatch(), 383);

  it("covers the whole video and is deterministic", () => {
    const dir = tempDir("munasi-audio-");
    const totalFrames = result.durationFrames + VICTORY_FREEZE_FRAMES;
    const a = buildSfxTrack(result, { totalFrames, audioDir: dir });
    const b = buildSfxTrack(result, { totalFrames, audioDir: dir });
    expect(a.length).toBeGreaterThanOrEqual((totalFrames / FPS) * SAMPLE_RATE);
    expect(Array.from(a.slice(0, 5000))).toEqual(Array.from(b.slice(0, 5000)));
  });

  it("stays inside the -1..1 range even when hits pile up", () => {
    const dir = tempDir("munasi-audio-");
    const track = buildSfxTrack(result, {
      totalFrames: result.durationFrames,
      audioDir: dir,
    });
    let peak = 0;
    for (const sample of track) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.1);
  });

  it("puts sound where the first event is, not at the start", () => {
    const dir = tempDir("munasi-audio-");
    const track = buildSfxTrack(result, { totalFrames: result.durationFrames, audioDir: dir });
    const firstEventFrame = result.events[0]!.frame;
    const firstEventSample = Math.round((firstEventFrame / FPS) * SAMPLE_RATE);
    const before = track.slice(0, Math.max(1, firstEventSample - 100));
    expect(before.every((s) => s === 0)).toBe(true);
    const around = track.slice(firstEventSample, firstEventSample + 2000);
    expect(around.some((s) => Math.abs(s) > 0.01)).toBe(true);
  });
});

describe("file naming", () => {
  it("slugs names into something safe for a filesystem", () => {
    expect(slug("Iron Warden")).toBe("iron-warden");
    expect(slug("ЖЕЛЕЗО!!")).toBe("fighter");
    expect(slug("A  --  B")).toBe("a-b");
  });

  it("names the file after both fighters and the seed", () => {
    const result = simulate(abilityMatch(), 383);
    expect(videoFileName(result)).toBe("summoner-vs-berserker-383.mp4");
  });
});

describe("exportVideo", () => {
  it("reports the ffmpeg version it found", () => {
    expect(checkFfmpeg().version).toMatch(/ffmpeg version/i);
  });

  it("encodes frames into a playable mp4 of the right length", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 20);
    const framesDir = tempDir("munasi-frames-");
    const outDir = tempDir("munasi-out-");
    await renderFrames(result, framesDir, { victoryFrames: 10 });

    const exported = await exportVideo(result, { framesDir, outDir, silent: true });
    expect(exported.path).toBe(join(outDir, "summoner-vs-berserker-383.mp4"));
    expect(existsSync(exported.path)).toBe(true);
    expect(exported.sizeBytes).toBeGreaterThan(0);
    // 30 frames at 30fps.
    expect(exported.durationSeconds).toBeGreaterThan(0.9);
    expect(exported.durationSeconds).toBeLessThan(1.2);
  }, 120_000);

  it("mixes music and SFX into the exported file", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 20);
    const framesDir = tempDir("munasi-frames-");
    const outDir = tempDir("munasi-out-");
    const audioDir = tempDir("munasi-audio-");
    await renderFrames(result, framesDir, { victoryFrames: 10 });

    const exported = await exportVideo(result, { framesDir, outDir, audioDir });
    expect(existsSync(exported.path)).toBe(true);
    expect(exported.durationSeconds).toBeGreaterThan(0.9);
  }, 240_000);

  it("fails loudly when there are no frames to encode", async () => {
    const result = simulate(abilityMatch(), 383);
    const empty = tempDir("munasi-frames-");
    await expect(
      exportVideo(result, { framesDir: empty, outDir: tempDir("munasi-out-"), silent: true }),
    ).rejects.toThrow(/no frames found/);
  });
});
