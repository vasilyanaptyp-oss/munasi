import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, combinations, gauntletMatchups, GAUNTLET_RULES, byFaction } from "../content/teams.js";
import { findColdOpen } from "./coldOpen.js";
import {
  findBestGauntlet,
  scoreGauntletDrama,
  simulateGauntlet,
  type GauntletConfig,
} from "./gauntlet.js";
import { FPS } from "./types.js";

const roster = loadFighters();
const config: GauntletConfig = buildGauntlet(
  getFighter("compass", roster),
  [getFighter("bodyguard", roster)],
);

describe("simulateGauntlet", () => {
  it("is deterministic", () => {
    const a = JSON.stringify(simulateGauntlet(config, 7, GAUNTLET_RULES));
    const b = JSON.stringify(simulateGauntlet(config, 7, GAUNTLET_RULES));
    expect(a).toBe(b);
  });

  it("does not mutate the config", () => {
    const before = JSON.stringify(config);
    simulateGauntlet(config, 3, GAUNTLET_RULES);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("carries the challenger's HP between rounds and never refills it", () => {
    // A seed where the challenger gets through at least two rounds.
    const result = findBestGauntlet(config, { count: 40, rules: GAUNTLET_RULES }).result;
    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.rounds.length; i += 1) {
      const previous = result.rounds[i - 1]!;
      const current = result.rounds[i]!;
      expect(current.challengerHpStart).toBe(previous.challengerHpEnd);
      expect(current.challengerHpStart).toBeLessThanOrEqual(previous.challengerHpStart);
    }
  });

  it("starts every team member at full HP", () => {
    const result = findBestGauntlet(config, { count: 40, rules: GAUNTLET_RULES }).result;
    for (const round of result.rounds) {
      const first = result.snapshots.find((s) => s.frame === round.startFrame)!;
      const member = config.team.members[round.index]!;
      expect(first.opponent.maxHp).toBe(member.maxHp);
      // Allow the opening frame of a round to have taken at most one hit.
      expect(first.opponent.hp).toBeGreaterThan(member.maxHp * 0.9);
    }
  });

  it("only counts a clear when every member is beaten", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const result = simulateGauntlet(config, seed, GAUNTLET_RULES);
      if (result.challengerWon) {
        expect(result.rounds).toHaveLength(config.team.members.length);
        expect(result.rounds.every((r) => r.challengerWon)).toBe(true);
      } else {
        expect(result.rounds.at(-1)!.challengerWon).toBe(false);
      }
    }
  });

  it("stops as soon as the challenger falls", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const result = simulateGauntlet(config, seed, GAUNTLET_RULES);
      if (result.challengerWon) continue;
      expect(result.rounds.length).toBe(result.decidedInRound);
      expect(result.rounds.length).toBeLessThanOrEqual(config.team.members.length);
    }
  });

  it("produces one continuous snapshot feed, numbered without gaps", () => {
    const result = simulateGauntlet(config, 11, GAUNTLET_RULES);
    expect(result.snapshots).toHaveLength(result.durationFrames);
    result.snapshots.forEach((snap, i) => expect(snap.frame).toBe(i));
    // Rounds tile the timeline end to end.
    let cursor = 0;
    for (const round of result.rounds) {
      expect(round.startFrame).toBe(cursor);
      cursor = round.endFrame;
    }
    expect(cursor).toBe(result.durationFrames);
  });

  it("keeps every event inside the continuous timeline", () => {
    const result = simulateGauntlet(config, 5, GAUNTLET_RULES);
    for (const event of result.events) {
      expect(event.frame).toBeGreaterThanOrEqual(0);
      expect(event.frame).toBeLessThan(result.durationFrames);
    }
  });

  it("labels each frame with the round it belongs to", () => {
    const result = simulateGauntlet(config, 11, GAUNTLET_RULES);
    for (const round of result.rounds) {
      for (let f = round.startFrame; f < round.endFrame; f += 1) {
        expect(result.snapshots[f]!.round).toBe(round.index);
      }
    }
  });

  it("spawns pickups and hands each to exactly one fighter", () => {
    const result = simulateGauntlet(config, 21, { ...GAUNTLET_RULES, pickups: { firstFrame: 30, intervalFrames: 90 } });
    const spawns = result.events.filter((e) => e.type === "pickup_spawn");
    const claims = result.events.filter((e) => e.type === "pickup_claim");
    expect(spawns.length).toBeGreaterThan(0);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.length).toBeLessThanOrEqual(spawns.length);
    const ids = new Set([config.challenger.id, ...config.team.members.map((m) => m.id)]);
    for (const claim of claims) expect(ids.has(claim.actorId)).toBe(true);
  });

  it("runs without pickups when they are not asked for", () => {
    const result = simulateGauntlet(config, 21, { damageVariance: 0.15 });
    expect(result.events.some((e) => e.type === "pickup_spawn")).toBe(false);
  });
});

describe("gauntlet drama", () => {
  it("findBestGauntlet returns the top-scoring seed and is reproducible", () => {
    const best = findBestGauntlet(config, { count: 40, rules: GAUNTLET_RULES });
    for (let seed = 0; seed < 40; seed += 1) {
      expect(scoreGauntletDrama(simulateGauntlet(config, seed, GAUNTLET_RULES))).toBeLessThanOrEqual(
        best.score + 1e-9,
      );
    }
    expect(findBestGauntlet(config, { count: 40, rules: GAUNTLET_RULES }).seed).toBe(best.seed);
  });
});

describe("teams from factions", () => {
  it("splits the roster in half", () => {
    // Counted as a relationship, not a literal. This asserted 1 and 1, so
    // adding a fighter broke it — which is a test pinning the roster's size
    // rather than the rule that every fighter is on exactly one side.
    const left = byFaction("left", roster);
    const right = byFaction("right", roster);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.length + right.length).toBe(roster.length);
    expect(left.some((f) => right.some((r) => r.id === f.id))).toBe(false);
  });

  it("enumerates every fighter on one side against every fighter on the other", () => {
    const matchups = gauntletMatchups(roster);
    expect(combinations([1, 2, 3, 4, 5, 6], 3)).toHaveLength(20);
    // One opponent per run, so the count is simply left x right.
    expect(matchups).toHaveLength(
      byFaction("left", roster).length * byFaction("right", roster).length,
    );
    for (const m of matchups) {
      expect(m.members).toHaveLength(1);
      expect(new Set(m.members.map((x) => x.id)).size).toBe(1);
      expect(m.members.some((x) => x.id === m.challenger.id)).toBe(false);
    }
  });

  it("is stable run to run", () => {
    const first = gauntletMatchups(roster).map((m) => `${m.challenger.id}:${m.members.map((x) => x.id).join(",")}`);
    const second = gauntletMatchups(roster).map((m) => `${m.challenger.id}:${m.members.map((x) => x.id).join(",")}`);
    expect(first).toEqual(second);
  });

  it("scales damage but never HP", () => {
    const plain = getFighter("compass", roster);
    const built = buildGauntlet(plain, [getFighter("bodyguard", roster)]);
    expect(built.challenger.maxHp).toBe(plain.maxHp);
    expect(built.challenger.attack).toBeGreaterThan(plain.attack);
    expect(built.team.members[0]!.maxHp).toBe(getFighter("bodyguard", roster).maxHp);
  });
});

describe("cold open on a gauntlet", () => {
  it("finds a safe window on the continuous timeline", () => {
    const result = findBestGauntlet(config, { count: 30, rules: GAUNTLET_RULES }).result;
    const window = findColdOpen(result);
    expect(window).not.toBeNull();
    expect(window!.endFrame).toBeLessThanOrEqual(Math.floor(result.durationFrames * 0.8));
    const spoilers = result.events.filter(
      (e) =>
        (e.type === "death" || e.type === "victory") &&
        e.frame >= window!.startFrame &&
        e.frame < window!.endFrame,
    );
    expect(spoilers).toEqual([]);
  });
});

describe("gauntlet shape", () => {
  it("lands in the target length window on average", () => {
    let frames = 0;
    const runs = 60;
    for (let seed = 0; seed < runs; seed += 1) {
      frames += simulateGauntlet(config, seed, GAUNTLET_RULES).durationFrames;
    }
    const mean = frames / runs / FPS;
    // The reference's own videos run 19-30 seconds.
    expect(mean).toBeGreaterThan(16);
    expect(mean).toBeLessThan(32);
  });
});
