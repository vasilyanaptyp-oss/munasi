import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { inPackage } from "./paths.js";

/**
 * The flags that let a child Node process read TypeScript: `--import` pointed
 * at tsx's loader.
 *
 * `execArgv` is not inherited in every runner (vitest, for one, transforms
 * in-process and passes nothing along), so it is always asked for explicitly.
 *
 * **Resolved to an absolute URL, not left as the bare name `tsx`.** Node
 * resolves a bare `--import` specifier against the child's working directory,
 * and once this is a tool somebody runs in their own folder, that directory is
 * *theirs* — no `node_modules`, no tsx. The child exited 1, the parent reported
 * "render worker exited with code 1", and nothing said why; single-process
 * rendering worked, which made it look like a concurrency bug.
 */
export function tsxImportArgs(): string[] {
  try {
    const require = createRequire(inPackage("package.json"));
    return ["--import", pathToFileURL(require.resolve("tsx")).href];
  } catch {
    // Not resolvable from the package either — let the bare name have its
    // chance rather than failing here.
    return ["--import", "tsx"];
  }
}

/**
 * Runs one of this package's TypeScript entry points in a fresh Node process.
 *
 * **`process.execPath`, never `tsx` or `pnpm` by name.** On Windows both are
 * shell shims — `tsx.cmd`, `pnpm.cmd` — and `spawnSync` without a shell cannot
 * start a `.cmd`, so every `munasi` subcommand and every round of `pnpm solve`
 * would have died there before running a line. It was never seen, because
 * nothing here had ever been run on Windows. The Node binary running this code
 * is a real executable on every platform, and `--import` is the route the
 * render workers already took.
 */
export function runTs(
  file: string,
  args: string[] = [],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  return spawnSync(process.execPath, [...tsxImportArgs(), file, ...args], options);
}
