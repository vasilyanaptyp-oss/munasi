import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, byFaction, GAUNTLET_RULES, gauntletMatchups } from "../content/teams.js";
import { findBestGauntlet } from "./gauntlet.js";
import { LANES, MAX_STILL_FRAMES } from "./movement.js";
import { MAX_QUIET_FRAMES, tempoReport } from "./tempo.js";
import { FPS } from "./types.js";

/**
 * Pacing gate.
 *
 * Geometry is not the same as motion: a video can pass every composition rule
 * and still stand still. Nothing may go longer than 1.2 seconds without an
 * event, and the fix for a breach is to compress the pause, never to paper
 * over it with effects.
 */

const roster = loadFighters();

function run(challenger: string, team: string[]) {
  const config = buildGauntlet(
    getFighter(challenger, roster),
    team.map((id) => getFighter(id, roster)),
  );
  return findBestGauntlet(config, { count: 120, rules: GAUNTLET_RULES }).result;
}

describe("tempo", () => {
  it("never lets the video stand still for more than 1.2 seconds", () => {
    const result = run("plumber", ["chairman", "silencer", "arbiter"]);
    const report = tempoReport(result);
    expect(
      report.longestGap,
      `quiet for ${report.longestGap}f from frame ${report.longestGapAt}`,
    ).toBeLessThanOrEqual(MAX_QUIET_FRAMES);
  });

  it("keeps every round change under the limit too", () => {
    // This is where the dead air lived: the death animation's hold plus the
    // newcomer's first cooldown used to add up to 2.00s.
    const result = run("plumber", ["chairman", "silencer", "arbiter"]);
    const report = tempoReport(result);
    expect(report.junctions).toHaveLength(result.rounds.length - 1);
    for (const junction of report.junctions) {
      expect(junction).toBeLessThanOrEqual(MAX_QUIET_FRAMES);
    }
  });

  it("holds across matchups, not just the one the gate renders", () => {
    // Sampled rather than exhaustive: 120 matchups at 120 seeds each is minutes
    // of CPU, and the pacing is driven by attack speeds, which are shared.
    const failures: string[] = [];
    for (const matchup of gauntletMatchups(roster).filter((_, i) => i % 11 === 0)) {
      const config = buildGauntlet(matchup.challenger, matchup.members);
      const { result } = findBestGauntlet(config, { count: 40, rules: GAUNTLET_RULES });
      const report = tempoReport(result);
      if (report.longestGap > MAX_QUIET_FRAMES) {
        failures.push(
          `${matchup.challenger.id} vs ${matchup.members.map((m) => m.id).join("/")}: ` +
            `${report.longestGap}f = ${(report.longestGap / FPS).toFixed(2)}s at frame ` +
            `${report.longestGapAt}`,
        );
      }
    }
    expect(failures.join("\n")).toBe("");
  }, 120_000);

  it("counts the opening, so a slow start cannot hide in it", () => {
    const result = run("baker", ["silencer", "councillor", "inspector"]);
    const firstBeat = result.events.find((e) => e.type === "hit" || e.type === "crit");
    expect(firstBeat).toBeDefined();
    expect(firstBeat!.frame).toBeLessThanOrEqual(MAX_QUIET_FRAMES);
  });

  it("reports something for every worker", () => {
    for (const worker of byFaction("workers", roster)) {
      const result = run(worker.id, ["chairman", "councillor", "arbiter"]);
      const report = tempoReport(result);
      expect(report.durationFrames).toBeGreaterThan(0);
      expect(report.quietShare).toBeGreaterThanOrEqual(0);
      expect(report.quietShare).toBeLessThan(0.5);
    }
  }, 60_000);
});

describe("movement", () => {
  it("never leaves a fighter standing still for more than 10 frames", () => {
    // The whole reason positions exist. A still fighter is invisible to every
    // other gate: the layout is correct, the events keep landing, the picture
    // just does not move.
    const result = run("plumber", ["chairman", "silencer", "arbiter"]);
    // The hold after a death repeats one snapshot on purpose, so the collapse
    // has frames to play in. Nobody is standing there: they are falling over.
    const holds = new Set<number>();
    for (const round of result.rounds) {
      const death = result.events
        .filter((e) => e.type === "death" && e.frame >= round.startFrame && e.frame < round.endFrame)
        .at(-1);
      if (!death) continue;
      for (let f = death.frame; f < round.endFrame; f += 1) holds.add(f);
    }

    const worst = { id: "", frames: 0 };
    for (const side of ["challenger", "opponent"] as const) {
      let still = 0;
      let last: { x: number; y: number } | null = null;
      for (const snap of result.snapshots) {
        if (holds.has(snap.frame)) {
          still = 0;
          last = null;
          continue;
        }
        const at = snap[side];
        if (last && Math.abs(at.x - last.x) < 1e-6 && Math.abs(at.y - last.y) < 1e-6) {
          still += 1;
          if (still > worst.frames) worst.frames = still;
          if (still > worst.frames - 1) worst.id = `${side} at frame ${snap.frame}`;
        } else {
          still = 0;
        }
        last = { x: at.x, y: at.y };
      }
    }
    expect(worst.frames, `${worst.id} held still ${worst.frames} frames`).toBeLessThanOrEqual(
      MAX_STILL_FRAMES,
    );
  });

  it("keeps the two of them in their own depth lanes", () => {
    const result = run("baker", ["silencer", "councillor", "inspector"]);
    for (const snap of result.snapshots) {
      expect(snap.challenger.y).toBeGreaterThanOrEqual(LANES.a.min - 1e-9);
      expect(snap.challenger.y).toBeLessThanOrEqual(LANES.a.max + 1e-9);
      expect(snap.opponent.y).toBeGreaterThanOrEqual(LANES.b.min - 1e-9);
      expect(snap.opponent.y).toBeLessThanOrEqual(LANES.b.max + 1e-9);
    }
  });

  it("actually travels — the pair closes and breaks apart", () => {
    const result = run("courier", ["chairman", "arbiter", "viceroy"]);
    const spreads = result.snapshots.map((s) => Math.abs(s.opponent.x - s.challenger.x));
    const range = Math.max(...spreads) - Math.min(...spreads);
    expect(range, "the gap between them never changes").toBeGreaterThan(0.1);
  });

  it("replays identically — movement is on the same seeded streams", () => {
    const a = run("plumber", ["chairman", "silencer", "arbiter"]);
    const b = run("plumber", ["chairman", "silencer", "arbiter"]);
    expect(a.snapshots.map((s) => [s.challenger.x, s.opponent.y])).toEqual(
      b.snapshots.map((s) => [s.challenger.x, s.opponent.y]),
    );
  });
});
