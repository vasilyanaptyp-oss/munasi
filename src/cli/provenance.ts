import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ROSTER_PATH } from "../content/index.js";
import { GAUNTLET_RULES, GAUNTLET_TUNING } from "../content/teams.js";
import { ROUND_FRAME_CAP, ROUND_HOLD_FRAMES } from "../sim/gauntlet.js";
import { DAMAGE_VARIANCE } from "../sim/simulate.js";
import type { PickupRules } from "../sim/types.js";
import { VICTORY_FREEZE_FRAMES } from "../export/video.js";
import { VICTORY_CARD_FRAMES } from "../render/framePlan.js";

/**
 * What a manifest row needs to be worth anything in a month.
 *
 * A seed and a matchup are not enough to reproduce a video: every number the
 * simulation and the frame plan read is a constant somewhere in the source, and
 * those constants move. A row recorded before `attackRate: 3` landed replays
 * into a different fight today, and nothing in the row says so.
 *
 * So each row carries the commit it was cut at and a snapshot of the constants
 * that decide its bytes. The commit is the real key — with it the tree can be
 * checked out exactly — and the snapshot is the part you can read without a
 * checkout, and the part that tells you at a glance whether a row is stale.
 */

export interface Provenance {
  /** Commit the video was generated at, or null outside a git checkout. */
  commit: string | null;
  /** True when the working tree had uncommitted changes: the commit is a hint, not a key. */
  dirty: boolean;
  /** sha256 of `fighters.json` — the attack values are solved, not literal. */
  rosterHash: string;
  /** Seeds searched, and the ending the search was asked for. */
  seedsSearched: number;
  wantedOutcome?: "cleared" | "stopped";
  /** Everything the simulation and the frame plan read that is not in the row already. */
  constants: {
    tuning: { tempo: number; challengerPower: number };
    rules: {
      damageVariance: number;
      openingCooldown: number;
      attackRate: number;
      /** The pickup schedule as passed, `{}` meaning "on, with the defaults". */
      pickups: PickupRules | null;
    };
    duelDamageVariance: number;
    roundHoldFrames: number;
    roundFrameCap: number;
    victoryCardFrames: number;
    victoryFreezeFrames: number;
  };
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // No git, no checkout, or a shallow copy: the rest of the row is still useful.
    return null;
  }
}

function rosterHash(): string {
  try {
    return createHash("sha256").update(readFileSync(ROSTER_PATH)).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

export interface ProvenanceInput {
  seedsSearched: number;
  wantedOutcome?: "cleared" | "stopped";
}

export function provenance(input: ProvenanceInput): Provenance {
  const commit = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  return {
    commit,
    dirty: status !== null && status !== "",
    rosterHash: rosterHash(),
    seedsSearched: input.seedsSearched,
    ...(input.wantedOutcome === undefined ? {} : { wantedOutcome: input.wantedOutcome }),
    constants: {
      tuning: { tempo: GAUNTLET_TUNING.tempo, challengerPower: GAUNTLET_TUNING.challengerPower },
      rules: {
        damageVariance: GAUNTLET_RULES.damageVariance,
        openingCooldown: GAUNTLET_RULES.openingCooldown,
        attackRate: GAUNTLET_RULES.attackRate,
        // Recorded as an explicit null rather than dropped: a row that simply
        // lacks the key is ambiguous between "pickups off" and "written before
        // anyone recorded pickups", and the point of provenance is that a row
        // replays to the same bytes.
        pickups: null,
      },
      duelDamageVariance: DAMAGE_VARIANCE,
      roundHoldFrames: ROUND_HOLD_FRAMES,
      roundFrameCap: ROUND_FRAME_CAP,
      victoryCardFrames: VICTORY_CARD_FRAMES,
      victoryFreezeFrames: VICTORY_FREEZE_FRAMES,
    },
  };
}
