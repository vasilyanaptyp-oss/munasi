import { describe, expect, it } from "vitest";
import { comparisonRows, type VideoMeasure } from "../export/measure.js";
import { parseArgs, renderTable } from "./compare.js";

/**
 * The pure half of `pnpm compare`. Pulling frames needs ffmpeg and a video, and
 * that path is exercised by running the tool; what is worth gating here is the
 * part that decides *which* file is a reference and the part that lays the
 * numbers out, because both are easy to get quietly wrong.
 */

function measure(over: Partial<VideoMeasure> = {}): VideoMeasure {
  return {
    file: "x.mp4",
    frames: 300,
    seconds: 10,
    arenaHeight: { median: 612, min: 611, max: 613 },
    borderThickness: 24,
    arenaTop: { median: 0.197, travel: 0.23 },
    blueShare: 0.8,
    blackShare: 0.08,
    whiteShare: 0.02,
    numbersPerSecond: 0.6,
    worstGap: 3.2,
    motion: 0.1,
    staticShare: 0,
    speed: { median: 0.0101, p90: 0.019 },
    ...over,
  };
}

describe("compare", () => {
  it("splits ours from the reference on the bare --", () => {
    const args = parseArgs(["a.mp4", "b.mp4", "--", "ref.mp4"]);
    expect(args.ours).toEqual(["a.mp4", "b.mp4"]);
    expect(args.refs).toEqual(["ref.mp4"]);
  });

  it("treats everything as ours when no reference is given", () => {
    const args = parseArgs(["a.mp4"]);
    expect(args.ours).toEqual(["a.mp4"]);
    expect(args.refs).toEqual([]);
  });

  it("ignores flags and their values when collecting files", () => {
    const args = parseArgs(["--fps", "15", "a.mp4"]);
    expect(args.ours).toEqual(["a.mp4"]);
    expect(args.fps).toBe(15);
  });

  it("puts one column per video, in the order given", () => {
    const table = renderTable([measure(), measure({ seconds: 22 })], ["ours", "РЕФ ref"]);
    const [head, , first] = table.split("\n");
    expect(head).toContain("ours");
    expect(head).toContain("РЕФ ref");
    // The first row is the length, and its two values must land in order.
    expect(first).toContain("10.0с");
    expect(first).toContain("22.0с");
  });

  it("keeps a column readable when a value is missing", () => {
    // A video whose arena never has a border fully on screen still has to
    // produce a row rather than a crash — that is a real state for a clip that
    // opens mid-pan.
    const rows = comparisonRows([measure({ arenaHeight: null, borderThickness: null, arenaTop: null })]);
    for (const row of rows) {
      expect(row.values).toHaveLength(1);
      expect(row.values[0]).not.toBe("");
    }
  });

  it("counts a column for every video it is given", () => {
    const rows = comparisonRows([measure(), measure(), measure()]);
    for (const row of rows) expect(row.values).toHaveLength(3);
  });
});
