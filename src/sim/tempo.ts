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
 * **This gate used to measure dead air. It no longer does, and the limit has
 * been re-derived because of it.** When fighters stood in slots, the only thing
 * that ever moved was an event, so a gap between events really was a frozen
 * picture. They bounce now and the camera pans continuously, so a stretch with
 * no hit in it is not dead air — it is two people crossing the arena.
 *
 * The number comes from the reference, measured the same way as everything else
 * here: 721 frames at full resolution, tracking the white silhouette flash the
 * format uses for a hit. It lands 16 hits, a median of 36 frames apart, and its
 * own worst stretch without one is **146 frames — 4.87 seconds**. A gate at 1.2s
 * would fail the thing being copied, four times over.
 *
 * What actually guards liveliness now is `motion.test.ts`, which measures
 * changed pixels on the encoded mp4 and is not fooled by an event list.
 */

/**
 * Longest run of frames allowed with nothing happening.
 *
 * 5.0s, just past the reference's own worst of 4.87s. A breach now means the
 * fight has genuinely stalled, not that it is between blows.
 */
export const MAX_QUIET_FRAMES = Math.round(FPS * 5);

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
