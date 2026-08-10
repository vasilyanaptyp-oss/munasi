import type { GauntletResult } from "./gauntlet.js";
import type { MatchEvent } from "./types.js";
import { FPS } from "./types.js";

/**
 * Pacing of a finished run.
 *
 * The composition gate proves the frame is laid out correctly; it says nothing
 * about whether anything is *happening* in it. This measures the other half:
 * how long the video ever goes without an event a viewer can see.
 *
 * Measured on the shipped roster before this existed: every gap over the limit
 * sat at a round change, and none sat inside a round. A change cost 27 frames
 * of death animation plus another 20-33 waiting for the newcomer's first swing
 * — up to 2.00s of a fight where nothing moved but the idle bob.
 */

/** Longest run of frames allowed with nothing happening. */
export const MAX_QUIET_FRAMES = Math.round(FPS * 1.2);

/** Event types a viewer reads as "something happened". */
const VISIBLE = new Set<MatchEvent["type"]>([
  "hit",
  "crit",
  "minion_hit",
  "aoe",
  "heal",
  "death",
  "spawn",
  "buff",
  "pickup_claim",
]);

export interface TempoReport {
  /** Longest stretch with no visible event, in frames, and where it starts. */
  longestGap: number;
  longestGapAt: number;
  /** Per round change: frames from the death to the next round's first event. */
  junctions: number[];
  /** Share of frames with no visible event in the preceding 15. */
  quietShare: number;
  durationFrames: number;
}

export function tempoReport(result: GauntletResult): TempoReport {
  const beats = [...new Set(result.events.filter((e) => VISIBLE.has(e.type)).map((e) => e.frame))]
    .sort((a, b) => a - b);

  // The opening counts: frame 0 to the first beat is dead air like any other.
  let longestGap = 0;
  let longestGapAt = 0;
  let prev = 0;
  for (const frame of beats) {
    if (frame - prev > longestGap) {
      longestGap = frame - prev;
      longestGapAt = prev;
    }
    prev = frame;
  }
  // The tail after the last beat is the victory card, not dead air, so it is
  // deliberately not counted.

  const junctions: number[] = [];
  for (let i = 0; i < result.rounds.length - 1; i += 1) {
    const round = result.rounds[i]!;
    const death = result.events
      .filter((e) => e.type === "death" && e.frame >= round.startFrame && e.frame < round.endFrame)
      .at(-1);
    const next = beats.find((f) => f >= round.endFrame);
    if (death && next !== undefined) junctions.push(next - death.frame);
  }

  const beatSet = new Set(beats);
  let quiet = 0;
  for (let frame = 0; frame < result.durationFrames; frame += 1) {
    let seen = false;
    for (let back = 0; back <= 15 && frame - back >= 0; back += 1) {
      if (beatSet.has(frame - back)) {
        seen = true;
        break;
      }
    }
    if (!seen) quiet += 1;
  }

  return {
    longestGap,
    longestGapAt,
    junctions,
    quietShare: result.durationFrames === 0 ? 0 : quiet / result.durationFrames,
    durationFrames: result.durationFrames,
  };
}
