import { describe, expect, it } from "vitest";
import { findColdOpen, COLD_OPEN_LATEST } from "../sim/coldOpen.js";
import { simulate } from "../sim/simulate.js";
import { abilityMatch } from "../sim/testFixtures.js";
import { coldOpenPlan, defaultPlan, sourceFrames } from "./framePlan.js";

const result = simulate(abilityMatch(), 383);
const window = findColdOpen(result)!;

describe("defaultPlan", () => {
  it("plays the match through and freezes on the winner", () => {
    const plan = defaultPlan(result, 60);
    expect(plan).toHaveLength(result.durationFrames + 60);
    expect(plan[0]!.source).toBe(0);
    expect(plan[result.durationFrames - 1]!.source).toBe(result.durationFrames - 1);
    const freeze = plan.slice(result.durationFrames);
    expect(freeze.every((f) => f.source === result.durationFrames - 1)).toBe(true);
    expect(freeze.every((f) => f.victoryOverlay === true)).toBe(true);
  });

  it("maps output frames one to one onto simulation frames", () => {
    const plan = defaultPlan(result);
    expect(sourceFrames(plan)).toEqual(plan.map((_, i) => i));
  });
});

describe("coldOpenPlan", () => {
  const plan = coldOpenPlan(result, window, 60);

  it("puts the chosen window first, then the whole match", () => {
    const length = window.endFrame - window.startFrame;
    expect(plan).toHaveLength(length + result.durationFrames + 60);

    const opener = plan.slice(0, length);
    opener.forEach((entry, i) => expect(entry.source).toBe(window.startFrame + i));
    // The match itself still starts from frame 0 right after the cut.
    expect(plan[length]!.source).toBe(0);
  });

  it("labels the opener and the cut back to the start", () => {
    const length = window.endFrame - window.startFrame;
    expect(plan.slice(0, length).every((f) => f.coldOpenLabel !== undefined)).toBe(true);
    expect(plan[length]!.startLabel).toBeDefined();
    expect(plan[length]!.flash).toBeGreaterThan(0);
    // The badge and flash do not persist into the fight.
    expect(plan[length + 40]!.startLabel).toBeUndefined();
    expect(plan[length + 40]!.flash).toBeUndefined();
  });

  it("never shows the finish before the fight", () => {
    const length = window.endFrame - window.startFrame;
    const opener = plan.slice(0, length);
    const latest = Math.floor(result.durationFrames * COLD_OPEN_LATEST);
    for (const entry of opener) {
      expect(entry.source).toBeLessThan(latest);
      expect(entry.victoryOverlay).toBeUndefined();
    }
    const spoilers = result.events.filter(
      (e) =>
        (e.type === "death" || e.type === "victory") &&
        opener.some((entry) => entry.source === e.frame),
    );
    expect(spoilers).toEqual([]);
  });

  it("still ends on the winner freeze", () => {
    const tail = plan.slice(-60);
    expect(tail.every((f) => f.victoryOverlay === true)).toBe(true);
    expect(tail.every((f) => f.source === result.durationFrames - 1)).toBe(true);
  });

  it("replays the opener's frames, so its hits are heard twice", () => {
    const sources = sourceFrames(plan);
    const replayed = sources.filter((s) => s === window.startFrame);
    expect(replayed.length).toBe(2);
  });
});
