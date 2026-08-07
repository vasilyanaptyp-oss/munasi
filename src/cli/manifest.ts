import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ManifestColdOpen {
  startFrame: number;
  endFrame: number;
  reason: "damage_burst" | "lead_change";
  damage: number;
  leadChanges: number;
  /** Human-readable reason this window was picked. */
  why: string;
}

export interface ManifestEntry {
  /** File name inside the output directory. */
  file: string;
  fighters: [string, string];
  fighterNames: [string, string];
  seed: number;
  /** Drama score of the chosen seed, 0..100. */
  dramaScore: number;
  /** Duration of the finished mp4, seconds. */
  durationSeconds: number;
  frames: number;
  winnerId: string | null;
  sizeBytes: number;
  generatedAt: string;
  /** Present when the video opens on an earlier moment of the fight. */
  coldOpen?: ManifestColdOpen;
  /** Present for gauntlet runs. */
  gauntlet?: {
    challengerId: string;
    teamIds: string[];
    /** True when the challenger cleared the whole team. */
    cleared: boolean;
    /** 1-based round the run was decided in. */
    decidedInRound: number;
    /** Challenger HP at the end of each round. */
    hpByRound: number[];
  };
}

export interface Manifest {
  entries: ManifestEntry[];
}

export function manifestPath(outDir: string): string {
  return join(outDir, "manifest.json");
}

export function readManifest(outDir: string): Manifest {
  const path = manifestPath(outDir);
  if (!existsSync(path)) return { entries: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const entries = (parsed as Manifest).entries;
    return Array.isArray(entries) ? { entries } : { entries: [] };
  } catch {
    // A corrupt manifest should not stop a batch; it gets rewritten.
    return { entries: [] };
  }
}

export function writeManifest(outDir: string, manifest: Manifest): void {
  writeFileSync(manifestPath(outDir), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Order-independent key for a matchup, used to skip pairs already rendered. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function renderedPairs(manifest: Manifest): Set<string> {
  return new Set(manifest.entries.map((e) => pairKey(e.fighters[0], e.fighters[1])));
}

/** Key for a gauntlet matchup: challenger plus the team, order-independent. */
export function gauntletKey(challengerId: string, teamIds: string[]): string {
  return `${challengerId}|${[...teamIds].sort().join("+")}`;
}

export function renderedGauntlets(manifest: Manifest): Set<string> {
  const out = new Set<string>();
  for (const entry of manifest.entries) {
    if (entry.gauntlet) out.add(gauntletKey(entry.gauntlet.challengerId, entry.gauntlet.teamIds));
  }
  return out;
}
