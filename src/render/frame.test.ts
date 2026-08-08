import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { simulate } from "../sim/simulate.js";
import { abilityMatch, lopsidedMatch, makeFighter } from "../sim/testFixtures.js";
import type { MatchResult } from "../sim/types.js";
import { buildRenderIndex, renderSingleFrame } from "./frame.js";
import { frameFileName, renderFrames } from "./index.js";
import { minionSpriteFor, spriteFor } from "./sprites.js";
import { HEIGHT, WIDTH } from "./theme.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height straight out of the PNG IHDR chunk. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Trims a match to its first `frames` frames so tests stay fast. */
function truncate(result: MatchResult, frames: number): MatchResult {
  return {
    ...result,
    snapshots: result.snapshots.slice(0, frames),
    events: result.events.filter((e) => e.frame < frames),
    durationFrames: frames,
  };
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "munasi-render-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("renderSingleFrame", () => {
  const result = simulate(abilityMatch(), 383);

  it("produces a 1080x1920 PNG", () => {
    const png = renderSingleFrame(result, 100);
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(pngSize(png)).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it("is deterministic — the same frame renders byte-identically", () => {
    const a = renderSingleFrame(result, 240);
    const b = renderSingleFrame(result, 240);
    expect(a.equals(b)).toBe(true);
  });

  it("does not depend on which frames were rendered before it", () => {
    const direct = renderSingleFrame(result, 300);
    renderSingleFrame(result, 12);
    renderSingleFrame(result, 555);
    expect(renderSingleFrame(result, 300).equals(direct)).toBe(true);
  });

  it("gives the same bytes with and without a prebuilt index", () => {
    const withIndex = renderSingleFrame(result, 150, { index: buildRenderIndex(result) });
    expect(renderSingleFrame(result, 150).equals(withIndex)).toBe(true);
  });

  it("renders different frames differently", () => {
    expect(renderSingleFrame(result, 0).equals(renderSingleFrame(result, 400))).toBe(false);
  });

  it("draws the victory overlay only when asked", () => {
    const last = result.durationFrames - 1;
    const plain = renderSingleFrame(result, last);
    const banner = renderSingleFrame(result, last, { victoryOverlay: true });
    expect(plain.equals(banner)).toBe(false);
  });

  it("rejects frames outside the match", () => {
    expect(() => renderSingleFrame(result, -1)).toThrow(/out of range/);
    expect(() => renderSingleFrame(result, result.durationFrames)).toThrow(/out of range/);
  });

  it("renders a match where a fighter is already dead", () => {
    const stomp = simulate(lopsidedMatch(), 21);
    const png = renderSingleFrame(stomp, stomp.durationFrames - 1, { victoryOverlay: true });
    expect(pngSize(png)).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it("renders a frame in a workable amount of time", () => {
    const index = buildRenderIndex(result);
    // Fastest of ten, not the mean: the suite runs its files in parallel, so a
    // mean measures how busy the machine is as much as how costly the frame is.
    // The floor still moves the moment the render itself gets slower.
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      renderSingleFrame(result, 200 + i, { index });
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(400);
  });
});

describe("text fitting", () => {
  it("keeps long names inside the frame", async () => {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const long = simulate(
      {
        a: makeFighter({ id: "a", name: "СТАРШИЙ ПО ШЛАГБАУМУ ОКРУГА", spriteId: "gatekeeper" }),
        b: makeFighter({ id: "b", name: "ПРЕДСЕДАТЕЛЬ КОМИССИИ ПО ЭТИКЕ", spriteId: "chairman" }),
      },
      5,
    );
    // Read the frame back so the outer columns of the title band and the
    // HP-bar labels can be checked for text that ran off the edge.
    const image = await loadImage(renderSingleFrame(long, 0));
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    const bands: [number, number][] = [
      [90, 175], // title
      [250, 290], // fighter A's bar label
    ];
    const margin = 20;
    for (const [top, bottom] of bands) {
      const left = ctx.getImageData(0, top, margin, bottom - top).data;
      const right = ctx.getImageData(WIDTH - margin, top, margin, bottom - top).data;
      for (const strip of [left, right]) {
        let bright = 0;
        for (let i = 0; i < strip.length; i += 4) {
          // Background is very dark; text is stroked near-black but filled bright.
          if (strip[i]! > 90 && strip[i + 1]! > 90 && strip[i + 2]! > 90) bright += 1;
        }
        expect(bright).toBe(0);
      }
    }
  });
});

describe("renderFrames", () => {
  it("writes one PNG per frame, zero-padded and in order", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 5);
    const dir = tempDir();
    await renderFrames(result, dir);
    const files = readdirSync(dir).sort();
    expect(files).toEqual([0, 1, 2, 3, 4].map(frameFileName));
  });

  it("appends the requested freeze frames", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 4);
    const dir = tempDir();
    await renderFrames(result, dir, { victoryFrames: 3 });
    expect(readdirSync(dir)).toHaveLength(7);
  });

  it("reports progress up to the total", async () => {
    const result = truncate(simulate(abilityMatch(), 383), 3);
    const dir = tempDir();
    const seen: number[] = [];
    let total = 0;
    await renderFrames(result, dir, {
      victoryFrames: 2,
      onProgress: (done, t) => {
        seen.push(done);
        total = t;
      },
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(total).toBe(5);
  });
});

describe("sprite resolution", () => {
  it("reads an archetype and hue out of the sprite id", () => {
    const def = spriteFor("mage:265");
    expect(def.archetype).toBe("mage");
    expect(def.palette.primary).toBe("hsl(265, 62%, 54%)");
  });

  it("falls back to a stable hash for unknown ids", () => {
    expect(spriteFor("whatever")).toEqual(spriteFor("whatever"));
    // Archetypes may collide (there are only eight), palettes should not.
    expect(spriteFor("whatever").palette).not.toEqual(spriteFor("something-else").palette);
  });

  it("dresses minions in their owner's palette", () => {
    const owner = spriteFor("mage:265");
    const minion = minionSpriteFor("mage:265");
    expect(minion.palette).toEqual(owner.palette);
    expect(minion.archetype).toBe("wisp");
  });

  it("normalises out-of-range hues", () => {
    expect(spriteFor("knight:400").palette).toEqual(spriteFor("knight:40").palette);
  });
});
