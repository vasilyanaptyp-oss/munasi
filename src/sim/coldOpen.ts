import type { FighterSnapshot, MatchEvent, Side } from "./types.js";
import { FPS } from "./types.js";

/**
 * Cold-open selection: find the most arresting stretch of a fight to show
 * *before* the fight starts.
 *
 * Two hard rules, because a hook that spoils the ending costs more retention
 * than a weak opening:
 *   - the window may not contain a killing blow
 *   - the window may not come from the closing stretch of the match
 * Both are asserted in the tests, not just documented here.
 */

/** Frames shown before the match proper. One second at 30fps. */
export const COLD_OPEN_FRAMES = 30;
/** The window must end before this share of the match. */
export const COLD_OPEN_LATEST = 0.8;
/** HP-percentage gap below which neither side counts as leading. */
const LEAD_DEADBAND = 0.02;

export type ColdOpenReason = "damage_burst" | "lead_change";

export interface ColdOpenWindow {
  /** First frame of the window. */
  startFrame: number;
  /** One past the last frame. */
  endFrame: number;
  reason: ColdOpenReason;
  /** Total damage dealt inside the window. */
  damage: number;
  /** Times the HP lead changed hands inside the window. */
  leadChanges: number;
  /** Combined score the window was chosen on. */
  score: number;
}

export interface ColdOpenOptions {
  /** Window length in frames. Defaults to 30. */
  length?: number;
  /**
   * A lead change is worth this multiple of the average fighter's max HP when
   * scoring against a pure damage burst. A swap of who is winning is rarer and
   * reads better than a big number, so it outweighs a typical burst.
   */
  leadChangeWeight?: number;
}

function isDamage(type: string): boolean {
  return type === "hit" || type === "crit" || type === "aoe" || type === "minion_hit";
}

/**
 * Picks the window to open on, or null when the match is too short to spare
 * one that satisfies the rules.
 */
/**
 * The shape both formats share: a frame count, an HP curve for each side and
 * an event list. Written against this so a gauntlet can be hooked the same way
 * a duel is.
 */
export interface ColdOpenSource {
  durationFrames: number;
  events: MatchEvent[];
  snapshots: { a?: FighterSnapshot; b?: FighterSnapshot; challenger?: FighterSnapshot; opponent?: FighterSnapshot }[];
  fighters?: { a: { maxHp: number }; b: { maxHp: number } };
  challenger?: { maxHp: number };
}

export function findColdOpen(
  result: ColdOpenSource,
  options: ColdOpenOptions = {},
): ColdOpenWindow | null {
  const length = options.length ?? COLD_OPEN_FRAMES;
  const leadChangeWeight = options.leadChangeWeight ?? 0.35;
  const { snapshots, durationFrames } = result;

  // Never reach into the closing stretch: seeing the finish first kills it.
  const latestEnd = Math.floor(durationFrames * COLD_OPEN_LATEST);
  if (latestEnd < length || snapshots.length === 0) return null;

  // Frames that must not appear in the window at all.
  const forbidden = new Set<number>();
  for (const event of result.events) {
    if (event.type === "death" || event.type === "victory") forbidden.add(event.frame);
  }

  const damageAt = new Array<number>(durationFrames).fill(0);
  for (const event of result.events) {
    if (isDamage(event.type) && event.frame < durationFrames) {
      damageAt[event.frame] = damageAt[event.frame]! + event.value;
    }
  }

  const leaderAt = new Array<Side | null>(durationFrames).fill(null);
  for (let f = 0; f < durationFrames; f += 1) {
    const snap = snapshots[f];
    if (!snap) continue;
    const left = snap.a ?? snap.challenger;
    const right = snap.b ?? snap.opponent;
    if (!left || !right) continue;
    const gap =
      (left.maxHp > 0 ? left.hp / left.maxHp : 0) - (right.maxHp > 0 ? right.hp / right.maxHp : 0);
    leaderAt[f] = Math.abs(gap) >= LEAD_DEADBAND ? (gap > 0 ? "a" : "b") : null;
  }

  const firstSnap = snapshots[0];
  const meanMaxHp = result.fighters
    ? (result.fighters.a.maxHp + result.fighters.b.maxHp) / 2
    : ((firstSnap?.challenger?.maxHp ?? 1000) + (firstSnap?.opponent?.maxHp ?? 1000)) / 2;
  const leadChangeValue = meanMaxHp * leadChangeWeight;

  let best: ColdOpenWindow | null = null;
  for (let start = 0; start + length <= latestEnd; start += 1) {
    const end = start + length;

    let blocked = false;
    let damage = 0;
    for (let f = start; f < end; f += 1) {
      if (forbidden.has(f)) {
        blocked = true;
        break;
      }
      damage += damageAt[f]!;
    }
    if (blocked) continue;

    let leadChanges = 0;
    let leader: Side | null = null;
    for (let f = start; f < end; f += 1) {
      const current = leaderAt[f] ?? null;
      if (current === null) continue;
      if (leader !== null && current !== leader) leadChanges += 1;
      leader = current;
    }

    const score = damage + leadChanges * leadChangeValue;
    if (best === null || score > best.score) {
      best = {
        startFrame: start,
        endFrame: end,
        // Which criterion actually carried this window.
        reason: leadChanges * leadChangeValue > damage ? "lead_change" : "damage_burst",
        damage: Math.round(damage),
        leadChanges,
        score: Math.round(score),
      };
    }
  }
  return best;
}

/** One-line explanation for the manifest. */
export function describeColdOpen(window: ColdOpenWindow): string {
  const at = (window.startFrame / FPS).toFixed(1);
  return window.reason === "lead_change"
    ? `lead changed ${window.leadChanges}x at ${at}s (${window.damage} damage in the window)`
    : `biggest damage burst: ${window.damage} at ${at}s`;
}
