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
