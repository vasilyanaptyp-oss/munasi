import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when the module at `importMetaUrl` is the file node was asked to run.
 * Lets a module be both an importable library and a CLI entry point.
 */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}
