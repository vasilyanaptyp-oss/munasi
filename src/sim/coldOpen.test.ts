import { describe, expect, it } from "vitest";
import { loadFighters } from "../content/index.js";
import {
  COLD_OPEN_FRAMES,
  COLD_OPEN_LATEST,
  describeColdOpen,
  findColdOpen,
} from "./coldOpen.js";
import { findBestMatch } from "./drama.js";
import { simulate } from "./simulate.js";
import { lopsidedMatch } from "./testFixtures.js";
import type { MatchResult } from "./types.js";

const roster = loadFighters();

/** A spread of real matchups, so the rules are checked against real fights. */
const matches: MatchResult[] = [
  simulate({ a: roster[0]!, b: roster[1]! }, 7),
  simulate({ a: roster[2]!, b: roster[5]! }, 19),
  simulate({ a: roster[4]!, b: roster[9]! }, 33),
  simulate({ a: roster[6]!, b: roster[11]! }, 101),
  findBestMatch({ a: roster[3]!, b: roster[8]! }, { count: 60 }).result,
];

describe("findColdOpen", () => {
  it("returns a window of the requested length", () => {
    for (const match of matches) {
      const window = findColdOpen(match);
      expect(window).not.toBeNull();
      expect(window!.endFrame - window!.startFrame).toBe(COLD_OPEN_FRAMES);
      expect(window!.startFrame).toBeGreaterThanOrEqual(0);
    }
  });

  it("never includes a killing blow", () => {
    for (const match of matches) {
      const window = findColdOpen(match)!;
      const spoilers = match.events.filter(
        (e) =>
          (e.type === "death" || e.type === "victory") &&
          e.frame >= window.startFrame &&
          e.frame < window.endFrame,
      );
      expect(spoilers).toEqual([]);
    }
  });

  it("never comes from the closing stretch of the match", () => {
    for (const match of matches) {
      const window = findColdOpen(match)!;
      expect(window.endFrame).toBeLessThanOrEqual(
        Math.floor(match.durationFrames * COLD_OPEN_LATEST),
      );
    }
  });

  it("picks a window with real action in it, not the opening lull", () => {
    for (const match of matches) {
      const window = findColdOpen(match)!;
      // Compare against the average 30-frame stretch of the same fight.
      const totalDamage = match.events
        .filter((e) => e.type === "hit" || e.type === "crit" || e.type === "aoe" || e.type === "minion_hit")
        .reduce((sum, e) => sum + e.value, 0);
      const averageWindow = (totalDamage / match.durationFrames) * COLD_OPEN_FRAMES;
      expect(window.damage).toBeGreaterThan(averageWindow);
    }
  });

  it("prefers a lead change over a slightly bigger burst", () => {
    // With the weight cranked up, any window containing a lead change wins.
    for (const match of matches) {
      const leaded = findColdOpen(match, { leadChangeWeight: 50 })!;
      const anyLeadChange = findColdOpen(match)!.leadChanges > 0 || leaded.leadChanges > 0;
      if (anyLeadChange) {
        expect(leaded.leadChanges).toBeGreaterThan(0);
        expect(leaded.reason).toBe("lead_change");
      }
    }
  });

  it("is deterministic", () => {
    for (const match of matches) {
      expect(findColdOpen(match)).toEqual(findColdOpen(match));
    }
  });

  it("declines when the match is too short to spare a safe window", () => {
    // A fight that ends inside a second has nowhere safe to take 30 frames
    // from: 80% of it is shorter than the window itself.
    const stomp = simulate(lopsidedMatch(), 21);
    const brief: MatchResult = {
      ...stomp,
      snapshots: stomp.snapshots.slice(0, 24),
      events: stomp.events.filter((e) => e.frame < 24),
      durationFrames: 24,
    };
    expect(brief.durationFrames * COLD_OPEN_LATEST).toBeLessThan(COLD_OPEN_FRAMES);
    expect(findColdOpen(brief)).toBeNull();
  });

  it("explains itself for the manifest", () => {
    const window = findColdOpen(matches[0]!)!;
    const text = describeColdOpen(window);
    expect(text).toMatch(/damage|lead changed/);
    expect(text.length).toBeGreaterThan(10);
  });
});
