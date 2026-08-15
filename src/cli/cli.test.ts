import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { renderFrames } from "../render/index.js";
import { renderFramesParallel } from "../render/parallel.js";
import { simulate } from "../sim/simulate.js";
import { abilityMatch, makeFighter } from "../sim/testFixtures.js";
import type { MatchResult } from "../sim/types.js";
import { generate, parseArgs } from "./generate.js";
import { manifestPath, pairKey, readManifest, renderedPairs, writeManifest } from "./manifest.js";

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

describe("parseArgs", () => {
  it("has sensible defaults", () => {
    const options = parseArgs([]);
    expect(options.count).toBe(10);
    expect(options.seeds).toBe(500);
    expect(options.keepFrames).toBe(false);
    expect(options.redo).toBe(false);
    expect(options.workers).toBeGreaterThanOrEqual(1);
  });

  it("accepts both --count 20 and --count=20", () => {
    expect(parseArgs(["--count", "20"]).count).toBe(20);
    expect(parseArgs(["--count=20"]).count).toBe(20);
  });

  it("reads the remaining flags", () => {
    const options = parseArgs(["--seeds=50", "--workers=2", "--out=/tmp/x", "--keep-frames", "--redo"]);
    expect(options.seeds).toBe(50);
    expect(options.workers).toBe(2);
    expect(options.outDir).toBe("/tmp/x");
    expect(options.keepFrames).toBe(true);
    expect(options.redo).toBe(true);
  });

  it("rejects nonsense instead of silently using NaN", () => {
    expect(() => parseArgs(["--count=abc"])).toThrow(/positive number/);
    expect(() => parseArgs(["--count=-3"])).toThrow(/positive number/);
  });

  it("does not swallow the next flag as a value", () => {
    expect(parseArgs(["--count", "--redo"]).count).toBe(10);
  });
});

describe("manifest", () => {
  it("round-trips entries", () => {
    const dir = tempDir("munasi-manifest-");
    const entry = {
      file: "a-vs-b-1.mp4",
      fighters: ["a", "b"] as [string, string],
      fighterNames: ["A", "B"] as [string, string],
      seed: 1,
      dramaScore: 80,
      durationSeconds: 25,
      frames: 750,
      winnerId: "a",
      sizeBytes: 100,
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    writeManifest(dir, { entries: [entry] });
    expect(existsSync(manifestPath(dir))).toBe(true);
    expect(readManifest(dir).entries).toEqual([entry]);
  });

  it("treats a missing or corrupt manifest as empty rather than crashing", () => {
    const dir = tempDir("munasi-manifest-");
    expect(readManifest(dir).entries).toEqual([]);
    writeFileSync(manifestPath(dir), "{ this is not json");
    expect(readManifest(dir).entries).toEqual([]);
  });

  it("keys a pair the same in either order", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
    const manifest = {
      entries: [
        {
          file: "f",
          fighters: ["b", "a"] as [string, string],
          fighterNames: ["B", "A"] as [string, string],
          seed: 0,
          dramaScore: 0,
          durationSeconds: 0,
          frames: 0,
          winnerId: null,
          sizeBytes: 0,
          generatedAt: "",
        },
      ],
    };
    expect(renderedPairs(manifest).has(pairKey("a", "b"))).toBe(true);
  });
});

describe("renderFramesParallel", () => {
  it("matches the single-threaded render byte for byte", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 8);
    const serial = tempDir("munasi-serial-");
    const parallel = tempDir("munasi-parallel-");

    await renderFrames(result, serial, { victoryFrames: 2 });
    await renderFramesParallel(result, parallel, { victoryFrames: 2, workers: 2 });

    const serialFiles = readdirSync(serial).sort();
    expect(readdirSync(parallel).sort()).toEqual(serialFiles);
    const { readFileSync } = await import("node:fs");
    for (const file of serialFiles) {
      expect(readFileSync(join(parallel, file)).equals(readFileSync(join(serial, file)))).toBe(true);
    }
  }, 180_000);

  it("reports progress for every frame including the freeze", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 6);
    const dir = tempDir("munasi-parallel-");
    let done = 0;
    let total = 0;
    await renderFramesParallel(result, dir, {
      victoryFrames: 2,
      workers: 2,
      onProgress: (d, t) => {
        done = Math.max(done, d);
        total = t;
      },
    });
    expect(total).toBe(8);
    expect(done).toBe(8);
  }, 180_000);

  it("falls back to a single process when asked for one worker", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 3);
    const dir = tempDir("munasi-parallel-");
    await renderFramesParallel(result, dir, { workers: 1 });
    expect(readdirSync(dir)).toHaveLength(3);
  }, 120_000);
});

describe("gauntlet rendering", () => {
  it("renders identically in parallel and in one process", async () => {
    const { loadFighters, getFighter } = await import("../content/index.js");
    const { buildGauntlet, GAUNTLET_RULES } = await import("../content/teams.js");
    const { simulateGauntlet } = await import("../sim/gauntlet.js");
    const { defaultPlan } = await import("../render/framePlan.js");

    const roster = loadFighters();
    const full = simulateGauntlet(
      buildGauntlet(
        getFighter("compass", roster),
        [getFighter("bodyguard", roster)],
      ),
      7,
      GAUNTLET_RULES,
    );
    // A slice from the middle of round one keeps the test quick.
    const plan = defaultPlan(full, 0).slice(40, 48);

    const serial = tempDir("munasi-g-serial-");
    const parallel = tempDir("munasi-g-parallel-");
    await renderFrames(full, serial, { plan });
    await renderFramesParallel(full, parallel, { plan, workers: 2 });

    const files = readdirSync(serial).sort();
    expect(files).toHaveLength(plan.length);
    expect(readdirSync(parallel).sort()).toEqual(files);
    const { readFileSync } = await import("node:fs");
    for (const file of files) {
      expect(readFileSync(join(parallel, file)).equals(readFileSync(join(serial, file)))).toBe(true);
    }
  }, 180_000);

  it("renders the same frame the same way twice", async () => {
    const { loadFighters, getFighter } = await import("../content/index.js");
    const { buildGauntlet, GAUNTLET_RULES } = await import("../content/teams.js");
    const { simulateGauntlet } = await import("../sim/gauntlet.js");
    const { renderGauntletFrame } = await import("../render/gauntletFrame.js");

    const roster = loadFighters();
    const result = simulateGauntlet(
      buildGauntlet(
        getFighter("bodyguard", roster),
        [getFighter("compass", roster)],
      ),
      3,
      GAUNTLET_RULES,
    );
    const a = renderGauntletFrame(result, 120);
    renderGauntletFrame(result, 5);
    expect(renderGauntletFrame(result, 120).equals(a)).toBe(true);
    expect(() => renderGauntletFrame(result, result.durationFrames)).toThrow(/out of range/);
  }, 120_000);
});

describe("generate", () => {
  // Two throwaway fighters that kill each other in a couple of seconds, so the
  // pipeline runs end to end without rendering a full 30-second match.
  const quickRoster = [
    makeFighter({
      id: "quick_a",
      name: "QUICK A",
      spriteId: "knight:200",
      maxHp: 120,
      hp: 120,
      attack: 20,
      attackSpeed: 1.2,
    }),
    makeFighter({
      id: "quick_b",
      name: "QUICK B",
      spriteId: "beast:20",
      maxHp: 120,
      hp: 120,
      attack: 20,
      attackSpeed: 1.2,
    }),
  ];

  it("produces a video and records it in the manifest", async () => {
    const outDir = tempDir("munasi-generate-");
    const summary = await generate({
      count: 1,
      seeds: 8,
      seedStart: 0,
      outDir,
      workers: 2,
      matchupSample: 4,
      keepFrames: false,
      redo: false,
      coldOpen: false,
      duel: true,
      roster: quickRoster,
    });

    expect(summary.failures).toEqual([]);
    expect(summary.produced).toHaveLength(1);
    const entry = summary.produced[0]!;
    expect(entry.file).toMatch(/^quick-a-vs-quick-b-\d+\.mp4$/);
    expect(existsSync(join(outDir, entry.file))).toBe(true);
    expect(entry.durationSeconds).toBeGreaterThan(0);
    // The mp4 runs as long as the frames it was built from, within a frame.
    expect(Math.abs(entry.frames / 30 - entry.durationSeconds)).toBeLessThan(0.05);
    expect(entry.winnerId).toMatch(/^quick_[ab]$/);
    expect(readManifest(outDir).entries).toHaveLength(1);

    // Temporary PNGs are cleaned up.
    expect(existsSync(join(outDir, ".frames", `quick_a-vs-quick_b-${entry.seed}`))).toBe(false);
  }, 300_000);

  it("keeps going after one video fails, and records the ones that worked", async () => {
    // A 30-video batch runs unattended for two hours; one bad matchup must cost
    // one video, not the night. Broken for real rather than by a stub: the
    // frames directory the first matchup is about to create is occupied by a
    // file, so `mkdir` throws inside `generateOne` exactly as a full disk would.
    const roster = [
      ...quickRoster,
      makeFighter({
        id: "quick_c",
        name: "QUICK C",
        spriteId: "rogue:90",
        maxHp: 120,
        hp: 120,
        attack: 20,
        attackSpeed: 1.2,
      }),
    ];
    const outDir = tempDir("munasi-generate-");
    const { generateMatchups } = await import("../content/generateMatchups.js");
    const { findBestMatch } = await import("../sim/drama.js");
    const first = generateMatchups({ roster, sample: 4 })[0]!;
    const best = findBestMatch({ a: first.a, b: first.b }, { count: 8 });

    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(outDir, ".frames"), { recursive: true });
    writeFileSync(join(outDir, ".frames", `${first.a.id}-vs-${first.b.id}-${best.seed}`), "in the way");

    const summary = await generate({
      count: 2,
      seeds: 8,
      seedStart: 0,
      outDir,
      workers: 2,
      matchupSample: 4,
      keepFrames: false,
      redo: false,
      coldOpen: false,
      duel: true,
      roster,
    });

    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]!.matchup).toBe(`${first.a.name} vs ${first.b.name}`);
    // The second one still ran, landed on disk, and made it into the manifest.
    expect(summary.produced).toHaveLength(1);
    expect(existsSync(join(outDir, summary.produced[0]!.file))).toBe(true);
    expect(readManifest(outDir).entries).toHaveLength(1);
  }, 300_000);

  it("skips matchups already in the manifest", async () => {
    const outDir = tempDir("munasi-generate-");
    writeManifest(outDir, {
      entries: [
        {
          file: "already.mp4",
          fighters: ["quick_b", "quick_a"],
          fighterNames: ["QUICK B", "QUICK A"],
          seed: 0,
          dramaScore: 0,
          durationSeconds: 0,
          frames: 0,
          winnerId: null,
          sizeBytes: 0,
          generatedAt: "",
        },
      ],
    });

    const summary = await generate({
      count: 5,
      seeds: 4,
      seedStart: 0,
      outDir,
      workers: 1,
      matchupSample: 4,
      keepFrames: false,
      redo: false,
      coldOpen: false,
      duel: true,
      roster: quickRoster,
    });
    expect(summary.produced).toEqual([]);
    expect(summary.failures).toEqual([]);
  }, 120_000);
});
