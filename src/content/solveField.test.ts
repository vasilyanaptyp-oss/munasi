import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextScales, readScales, writeScales } from "./solveField.js";
import { ROSTER } from "./roster.js";

/**
 * The pure half of `pnpm solve`. Playing the matches needs minutes of CPU; what
 * is worth gating here is the part that edits `roster.ts` — a solver that
 * writes the wrong fighter's number, or silently writes nobody's, would be
 * discovered as a mysterious balance drift days later.
 */
const source = readFileSync(join(import.meta.dirname, "roster.ts"), "utf8");

describe("fieldScale solver", () => {
  it("reads a scale for every fighter in the roster", () => {
    const scales = readScales(source);
    expect([...scales.keys()]).toEqual(ROSTER.map((f) => f.id));
    for (const value of scales.values()) {
      expect(value).toBeGreaterThan(0.5);
      expect(value).toBeLessThan(1.5);
    }
  });

  it("writes back exactly the fighters it was given, and nothing else", () => {
    const scales = readScales(source);
    const target = ROSTER[1]!.id;
    const written = writeScales(source, new Map([[target, 0.7777]]));
    expect(readScales(written).get(target)).toBe(0.7777);
    for (const [id, value] of scales) {
      if (id === target) continue;
      expect(readScales(written).get(id), id).toBe(value);
    }
    // The rest of the file is untouched apart from that one number.
    expect(written.split("\n").length).toBe(source.split("\n").length);
  });

  it("refuses to write a fighter that is not there", () => {
    expect(() => writeScales(source, new Map([["nobody", 1]]))).toThrow(/nobody/);
  });

  it("corrects toward an even score, and under-corrects rather than over", () => {
    // The gain is the whole trick: a winrate here moves about four points per
    // percent of strength, so a step sized like a normal learning rate
    // overshoots and the spread grows every round. Measured on this roster:
    // 0.35 drove it from 22 points to 66 in four rounds.
    const scales = new Map([["a", 1], ["b", 1]]);
    const strong = nextScales(scales, new Map([["a", 0.7], ["b", 0.3]]));
    expect(strong.get("a")!).toBeLessThan(1);
    expect(strong.get("b")!).toBeGreaterThan(1);
    // A 20-point error moves the scale by a few percent, not tens of percent.
    expect(1 - strong.get("a")!).toBeLessThan(0.06);
    expect(1 - strong.get("a")!).toBeGreaterThan(0.01);
  });

  it("leaves an already even roster where it is", () => {
    const scales = new Map([["a", 0.9], ["b", 1.1]]);
    const same = nextScales(scales, new Map([["a", 0.5], ["b", 0.5]]));
    expect(same.get("a")).toBe(0.9);
    expect(same.get("b")).toBe(1.1);
  });

  it("ignores a fighter it has no scale for", () => {
    const out = nextScales(new Map([["a", 1]]), new Map([["a", 0.5], ["ghost", 0.9]]));
    expect([...out.keys()]).toEqual(["a"]);
  });
});
