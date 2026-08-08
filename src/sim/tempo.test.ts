import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, byFaction, GAUNTLET_RULES, gauntletMatchups } from "../content/teams.js";
import { findBestGauntlet } from "./gauntlet.js";
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
