import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.js";

describe("mulberry32", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const streamA = Array.from({ length: 200 }, () => a.next());
    const streamB = Array.from({ length: 200 }, () => b.next());
    expect(streamA).toEqual(streamB);
  });

  it("produces different streams for different seeds", () => {
    const a = Array.from({ length: 50 }, mulberry32(1).next);
    const b = Array.from({ length: 50 }, mulberry32(2).next);
    expect(a).not.toEqual(b);
  });

  it("stays inside [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is roughly uniform", () => {
    const rng = mulberry32(7);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i += 1) buckets[Math.floor(rng.next() * 10)]! += 1;
    for (const count of buckets) {
      expect(Math.abs(count - n / 10) / (n / 10)).toBeLessThan(0.05);
    }
  });

  it("handles negative and huge seeds without diverging", () => {
    expect(mulberry32(-5).next()).toEqual(mulberry32(-5).next());
    expect(mulberry32(2 ** 31).next()).toEqual(mulberry32(2 ** 31).next());
  });

  it("respects chance() probabilities", () => {
    const rng = mulberry32(3);
    let hits = 0;
    for (let i = 0; i < 100_000; i += 1) if (rng.chance(0.25)) hits += 1;
    expect(hits / 100_000).toBeCloseTo(0.25, 2);
  });
});

describe("project-wide determinism rule", () => {
  it("never calls Math.random anywhere in src/", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!path.endsWith(".ts")) continue;
        if (path.endsWith("rng.test.ts")) continue;
        if (/Math\s*\.\s*random\s*\(/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(join(import.meta.dirname, ".."));
    expect(offenders).toEqual([]);
  });
});
