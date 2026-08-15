import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, byFaction, GAUNTLET_RULES, gauntletMatchups } from "../content/teams.js";
import { findBestGauntlet, ROUND_HOLD_FRAMES } from "./gauntlet.js";
import { FIGHTER_HALF_HEIGHT, MAX_STILL_FRAMES } from "./movement.js";
import { MAX_QUIET_FRAMES, tempoReport } from "./tempo.js";
import { FPS } from "./types.js";

/**
 * Pacing gate.
 *
 * Geometry is not the same as motion: a video can pass every composition rule
 * and still stand still. Nothing may go longer than `MAX_QUIET_FRAMES` without
 * an event, and the fix for a breach is to compress the pause, never to paper
 * over it with effects.
 *
 * The limit is 5.0s, taken from the reference's own worst gap of 4.87s — see the
 * note in `tempo.ts` for why it is not the 1.2s it used to be. Short version: a
 * gap between hits stopped meaning a frozen picture once the fighters started
 * bouncing, and `motion.test.ts` measures the picture directly anyway.
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
  it("never goes longer without a hit than the reference does", () => {
    const result = run("compass", ["bodyguard"]);
    const report = tempoReport(result);
    expect(
      report.longestGap,
      `quiet for ${report.longestGap}f from frame ${report.longestGapAt}`,
    ).toBeLessThanOrEqual(MAX_QUIET_FRAMES);
  });

  it("keeps every round change under the limit too", () => {
    // This is where the dead air lived: the death animation's hold plus the
    // newcomer's first cooldown used to add up to 2.00s.
    const result = run("compass", ["bodyguard"]);
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
    for (const matchup of gauntletMatchups(roster)) {
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
    const result = run("compass", ["bodyguard"]);
    const firstBeat = result.events.find((e) => e.type === "hit" || e.type === "crit");
    expect(firstBeat).toBeDefined();
    expect(firstBeat!.frame).toBeLessThanOrEqual(MAX_QUIET_FRAMES);
  });

  it("reports something for every worker", () => {
    for (const worker of byFaction("left", roster)) {
      const result = run(worker.id, ["bodyguard"]);
      const report = tempoReport(result);
      expect(report.durationFrames).toBeGreaterThan(0);
      expect(report.quietShare).toBeGreaterThanOrEqual(0);
      // Also re-based on the reference. Scored the same way — a frame counts as
      // quiet when no hit landed in the preceding 15 — the reference itself
      // comes out at 0.66, because it lands 16 hits in 721 frames and lets the
      // bouncing carry the rest. Ours sits at 0.60. The old bound of 0.5 was
      // set when a fighter without an event to play was standing still.
      expect(report.quietShare).toBeLessThan(0.7);
    }
  }, 60_000);
});

describe("movement", () => {
  it("never leaves a fighter standing still for more than 10 frames", () => {
    // The whole reason positions exist. A still fighter is invisible to every
    // other gate: the layout is correct, the events keep landing, the picture
    // just does not move.
    const result = run("compass", ["bodyguard"]);
    // The hold after a death repeats one snapshot on purpose, so the collapse
    // has frames to play in. Nobody is standing there: they are falling over.
    // Frames where stillness is the intent, not a bug: NOBODY MOVES stops the
    // other fighter dead — that is the entire ability — and the hold after a
    // death repeats one snapshot so the fall has frames to play in.
    const holds = new Set<number>();
    for (const event of result.events) {
      if (event.type !== "signature") continue;
      for (let f = event.frame - 2; f <= event.frame + Math.ceil(1.6 * FPS); f += 1) holds.add(f);
    }
    // Every round ends on a held frame whether or not anyone died — a timeout
    // holds too, and that is where this last slipped through.
    for (const round of result.rounds) {
      for (let f = round.endFrame - ROUND_HOLD_FRAMES - 1; f < round.endFrame; f += 1) holds.add(f);
    }
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

  it("keeps every fighter's box inside the arena", () => {
    // The simulation bounces a box of exactly the size the renderer draws, so
    // staying inside here is what keeps a figure off the wall on screen.
    const result = run("compass", ["bodyguard"]);
    const roster = loadFighters();
    const half = (id: string): { w: number; h: number } => {
      const f = getFighter(id, roster);
      return { w: FIGHTER_HALF_HEIGHT * f.aspect, h: FIGHTER_HALF_HEIGHT };
    };
    const a = half("compass");
    const b = half("bodyguard");
    for (const snap of result.snapshots) {
      expect(snap.challenger.x).toBeGreaterThanOrEqual(a.w - 1e-9);
      expect(snap.challenger.x).toBeLessThanOrEqual(1 - a.w + 1e-9);
      expect(snap.challenger.y).toBeGreaterThanOrEqual(a.h - 1e-9);
      expect(snap.challenger.y).toBeLessThanOrEqual(1 - a.h + 1e-9);
      expect(snap.opponent.x).toBeGreaterThanOrEqual(b.w - 1e-9);
      expect(snap.opponent.x).toBeLessThanOrEqual(1 - b.w + 1e-9);
    }
  });

  it("pushes the two apart — they never sit inside each other", () => {
    // The owner's first complaint about the last cut: the two figures walked
    // through each other. They collide now, and this is the gate on it.
    //
    // Measured against the same box the collision uses, not the drawn box: a
    // photograph is mostly air at its corners, so the bodies collide on their
    // core and a stray arm may still overlap, which is what the reference does.
    const result = run("compass", ["bodyguard"]);
    const roster = loadFighters();
    const core = (id: string) => {
      const f = getFighter(id, roster);
      return { w: FIGHTER_HALF_HEIGHT * f.aspect, h: FIGHTER_HALF_HEIGHT };
    };
    const a = core("compass");
    const b = core("bodyguard");
    // The same 0.75 the simulation collides on, minus a hair for float drift.
    const halfW = (a.w + b.w) * 0.75 * 0.98;
    const halfH = (a.h + b.h) * 0.75 * 0.98;

    const worst: string[] = [];
    for (const snap of result.snapshots) {
      const dx = Math.abs(snap.challenger.x - snap.opponent.x);
      const dy = Math.abs(snap.challenger.y - snap.opponent.y);
      if (dx < halfW && dy < halfH) {
        worst.push(
          `frame ${snap.frame}: apart by ${dx.toFixed(3)}x${dy.toFixed(3)}, ` +
            `needs ${halfW.toFixed(3)}x${halfH.toFixed(3)}`,
        );
      }
    }
    expect(worst.slice(0, 5).join("\n")).toBe("");
  });

  it("actually collides — the pair meet often enough for it to matter", () => {
    // A collision rule that never fires is not a fixed bug, it is a dead branch.
    // Two fighters crossing a shared arena for thirty seconds have to meet.
    const result = run("compass", ["bodyguard"]);
    let near = 0;
    for (const snap of result.snapshots) {
      const dx = Math.abs(snap.challenger.x - snap.opponent.x);
      const dy = Math.abs(snap.challenger.y - snap.opponent.y);
      if (dx < 0.45 && dy < 0.45) near += 1;
    }
    expect(near, "the two never come near each other").toBeGreaterThan(10);
  });

  it("bounces — it reaches both sides of the arena and turns around", () => {
    // The thing the previous model got wrong. A fighter that drifts near one
    // spot passes a "does it move" check and is still not what the reference
    // does: there, a fighter crosses the whole arena and comes back.
    const result = run("compass", ["bodyguard"]);
    const xs = result.snapshots.map((s) => s.challenger.x);
    expect(Math.max(...xs) - Math.min(...xs), "never crosses the arena").toBeGreaterThan(0.45);

    let turns = 0;
    for (let i = 2; i < xs.length; i += 1) {
      const before = xs[i - 1]! - xs[i - 2]!;
      const after = xs[i]! - xs[i - 1]!;
      if (before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after)) turns += 1;
    }
    expect(turns, "never turns around").toBeGreaterThanOrEqual(1);
  });

  it("replays identically — movement is on the same seeded streams", () => {
    const a = run("compass", ["bodyguard"]);
    const b = run("compass", ["bodyguard"]);
    expect(a.snapshots.map((s) => [s.challenger.x, s.opponent.y])).toEqual(
      b.snapshots.map((s) => [s.challenger.x, s.opponent.y]),
    );
  });
});
