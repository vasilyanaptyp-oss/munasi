import { describe, expect, it } from "vitest";
import { loadFighters } from "../content/index.js";
import { artFor, FIGHTER_ART } from "./fighters/index.js";
import { iou, silhouetteMask, type Mask } from "./silhouette.js";

/**
 * The silhouette gate.
 *
 * A viewer should recognise a fighter from its outline, so this renders each
 * one as a solid mask, scales them all to a common height, and measures
 * pairwise intersection-over-union. Colour and props-by-palette cannot help a
 * fighter here — only shape.
 *
 * ## Why the threshold is 0.70
 *
 * Measured over the shipped roster (66 pairs):
 *
 *   min 0.026 | p25 0.319 | median 0.439 | p75 0.523 | p90 0.616 | max 0.663
 *
 * The number is not arbitrary — it is bracketed from both sides by measurement:
 *
 * - **Lower bound: what shipping costs.** The worst shipped pair is 0.663
 *   (chairman / inspector), and shape edits stopped helping around there. Two
 *   upright human figures normalised to the same height share a torso column;
 *   that overlap is structural, not a design failure. A gate below ~0.67 would
 *   demand non-humanoid shapes for everyone.
 * - **Upper bound: what a real collision looks like.** Two pairs measured
 *   during this work were genuine failures a viewer would call "the same guy
 *   twice": an earlier round-bellied guard against the plumber at **0.739**,
 *   and the arbiter against a triangle-robed councillor at **0.713**. Both were
 *   redrawn. The gate has to fail those.
 *
 * That leaves the threshold inside (0.663, 0.713). 0.70 sits there with ~0.04
 * of headroom over the shipped worst, so a new fighter that is a re-skin of an
 * existing one trips the gate, while the roster as drawn passes.
 *
 * If this test fails, the fix is to redraw the silhouette — change proportions,
 * pose or the signature prop. Raising the threshold defeats the point.
 */
const MAX_IOU = 0.7;

const roster = loadFighters();
const masks = new Map<string, Mask>(
  roster.map((fighter) => [fighter.id, silhouetteMask(fighter.spriteId)]),
);

interface PairScore {
  a: string;
  b: string;
  value: number;
}

const pairs: PairScore[] = [];
for (let i = 0; i < roster.length; i += 1) {
  for (let j = i + 1; j < roster.length; j += 1) {
    const a = roster[i]!;
    const b = roster[j]!;
    pairs.push({ a: a.id, b: b.id, value: iou(masks.get(a.id)!, masks.get(b.id)!) });
  }
}

const sorted = [...pairs].sort((x, y) => x.value - y.value).map((p) => p.value);
const quantile = (p: number): number => sorted[Math.floor((sorted.length - 1) * p)]!;

describe("fighter silhouettes", () => {
  it("prints the pairwise IoU matrix", () => {
    const ids = roster.map((f) => f.id);
    const header = "      " + ids.map((id) => id.slice(0, 5).padStart(6)).join("");
    const lines = [header];
    for (const a of ids) {
      const cells = ids.map((b) => {
        if (a === b) return "     -";
        return iou(masks.get(a)!, masks.get(b)!).toFixed(2).padStart(6);
      });
      lines.push(a.slice(0, 5).padEnd(6) + cells.join(""));
    }
    lines.push(
      `\nn=${sorted.length}  min ${sorted[0]!.toFixed(3)}  p25 ${quantile(0.25).toFixed(3)}` +
        `  median ${quantile(0.5).toFixed(3)}  p75 ${quantile(0.75).toFixed(3)}` +
        `  p90 ${quantile(0.9).toFixed(3)}  max ${sorted.at(-1)!.toFixed(3)}`,
    );
    console.log(lines.join("\n"));
    expect(sorted).toHaveLength((roster.length * (roster.length - 1)) / 2);
  });

  it("keeps every pair of silhouettes distinguishable", () => {
    const tooSimilar = pairs
      .filter((p) => p.value >= MAX_IOU)
      .sort((x, y) => y.value - x.value)
      .map((p) => `${p.a} / ${p.b}: ${p.value.toFixed(3)}`);
    expect(tooSimilar).toEqual([]);
  });

  it("keeps the typical pair well clear of the gate", () => {
    // Guards against the roster drifting toward the threshold as a whole
    // rather than one pair tripping it.
    expect(quantile(0.5)).toBeLessThan(0.55);
    expect(quantile(0.9)).toBeLessThan(0.65);
  });

  it("gives every roster fighter its own drawing function", () => {
    for (const fighter of roster) {
      const art = artFor(fighter.spriteId);
      expect(art, `${fighter.id} has no art`).toBeDefined();
      expect(art!.note.length).toBeGreaterThan(0);
    }
    // No two fighters share art.
    const used = roster.map((f) => f.spriteId);
    expect(new Set(used).size).toBe(roster.length);
  });

  it("varies build, not just outline detail", () => {
    const aspects = roster.map((f) => masks.get(f.id)!.aspect);
    expect(Math.min(...aspects)).toBeLessThan(0.45);
    expect(Math.max(...aspects)).toBeGreaterThan(1.0);
  });

  it("draws something for every registered fighter", () => {
    for (const art of FIGHTER_ART) {
      const mask = silhouetteMask(art.id);
      expect(mask.area).toBeGreaterThan(1000);
    }
  });

  it("is deterministic", () => {
    const first = silhouetteMask("plumber");
    const second = silhouetteMask("plumber");
    expect(first.area).toBe(second.area);
    expect(iou(first, second)).toBe(1);
  });
});
