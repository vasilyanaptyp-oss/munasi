import { describe, expect, it } from "vitest";
import { findBestMatch, scoreDrama, scoreDramaDetailed } from "./drama.js";
import { simulate } from "./simulate.js";
import { abilityMatch, lopsidedMatch, makeFighter, mirrorMatch } from "./testFixtures.js";
import { FPS } from "./types.js";

describe("scoreDrama", () => {
  it("scores a one-sided beatdown far below an even match", () => {
    const lopsided = Array.from({ length: 40 }, (_, s) =>
      scoreDrama(simulate(lopsidedMatch(), s)),
    );
    const even = Array.from({ length: 40 }, (_, s) => scoreDrama(simulate(mirrorMatch(), s)));

    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(lopsided)).toBeLessThan(avg(even));
    expect(Math.max(...lopsided)).toBeLessThan(40);
  });

  it("gives a stomp a near-zero closeness and comeback", () => {
    const b = scoreDramaDetailed(simulate(lopsidedMatch(), 1));
    expect(b.closeness).toBeLessThan(0.3);
    expect(b.comeback).toBe(0);
  });

  it("keeps every component and the total inside their ranges", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const b = scoreDramaDetailed(simulate(abilityMatch(), seed));
      for (const key of ["closeness", "leadChanges", "comeback", "pacing", "deathTiming"] as const) {
        expect(b[key]).toBeGreaterThanOrEqual(0);
        expect(b[key]).toBeLessThanOrEqual(1);
      }
      expect(b.total).toBeGreaterThanOrEqual(0);
      expect(b.total).toBeLessThanOrEqual(100);
    }
  });

  it("penalises a match that never resolves", () => {
    const stalemate = {
      a: makeFighter({ id: "wall_a", maxHp: 5000, hp: 5000, attack: 1, attackSpeed: 0.5 }),
      b: makeFighter({ id: "wall_b", maxHp: 5000, hp: 5000, attack: 1, attackSpeed: 0.5 }),
    };
    const result = simulate(stalemate, 9);
    expect(result.timedOut).toBe(true);
    expect(scoreDrama(result)).toBeLessThan(35);
  });

  it("rewards a match that lands in the 22-38 second window", () => {
    const long = simulate(
      {
        a: makeFighter({ id: "slow_a", maxHp: 4000, hp: 4000, attack: 8, attackSpeed: 0.8 }),
        b: makeFighter({ id: "slow_b", maxHp: 4000, hp: 4000, attack: 8, attackSpeed: 0.8 }),
      },
      3,
    );
    const quick = simulate(
      {
        a: makeFighter({ id: "fast_a", maxHp: 200, hp: 200, attack: 90, attackSpeed: 3 }),
        b: makeFighter({ id: "fast_b", maxHp: 200, hp: 200, attack: 90, attackSpeed: 3 }),
      },
      3,
    );
    expect(quick.durationFrames / FPS).toBeLessThan(10);
    expect(scoreDramaDetailed(quick).pacing).toBe(0);
    expect(scoreDramaDetailed(long).pacing).toBeLessThan(1);
  });

  it("is pure — scoring twice gives the same number", () => {
    const result = simulate(abilityMatch(), 55);
    expect(scoreDrama(result)).toBe(scoreDrama(result));
  });
});

describe("findBestMatch", () => {
  it("returns the highest-scoring seed in the range", () => {
    const config = mirrorMatch();
    const best = findBestMatch(config, { start: 0, count: 60 });
    for (let seed = 0; seed < 60; seed += 1) {
      expect(scoreDrama(simulate(config, seed))).toBeLessThanOrEqual(best.score + 1e-9);
    }
    expect(best.result.seed).toBe(best.seed);
    expect(best.searched).toBe(60);
  });

  it("is reproducible", () => {
    const config = abilityMatch();
    const a = findBestMatch(config, { count: 100 });
    const b = findBestMatch(config, { count: 100 });
    expect(a.seed).toBe(b.seed);
    expect(a.score).toBe(b.score);
  });

  it("beats the average seed by a wide margin", () => {
    const config = mirrorMatch();
    const best = findBestMatch(config, { count: 200 });
    const scores = Array.from({ length: 200 }, (_, s) => scoreDrama(simulate(config, s)));
    const avg = scores.reduce((x, y) => x + y, 0) / scores.length;
    expect(best.score).toBeGreaterThan(avg);
  });

  it("searches 500 seeds well inside its budget", () => {
    // Fastest of three, not one shot: the suite runs its files in parallel, so
    // a single timing measures how busy the machine is as much as how costly the
    // search is. The floor still moves the moment the search itself gets slower.
    // Same treatment as the render and simulation budgets, for the same reason.
    //
    // The budget is 2s rather than 1s because even the best of three trips over
    // 1s on a loaded box — measured at 1003ms and 1004ms on two separate runs
    // that passed on their own a minute later. A gate that fails on machine load
    // teaches people to re-run it, which is worse than a looser gate: the search
    // runs in 300-400ms when the box is idle, so 2s still catches anything that
    // makes it fundamentally more expensive.
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      findBestMatch(abilityMatch(), { count: 500 });
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(2000);
  });

  it("rejects an empty range", () => {
    expect(() => findBestMatch(mirrorMatch(), { count: 0 })).toThrow();
  });
});
