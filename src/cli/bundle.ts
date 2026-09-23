import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRIVATE_ROSTER } from "../content/roster.private.js";
import { SHIPPED_ROSTER } from "../content/roster.js";
import { isMain } from "../util/main.js";
import { inPackage } from "../util/paths.js";

/**
 * Builds the thing that is sold:
 *
 *   pnpm bundle            dist/munasi-<version>/ and dist/munasi-<version>.zip
 *   pnpm bundle --quick    same, without re-solving the balance (for CI)
 *
 * The owner's own repository fights with fourteen fighters, and four of them
 * are stock photographs of real people licensed to him and nobody else. The
 * product ships the other ten, so it is a different project: its own roster,
 * its own balance, its own `fighters.json`. This builds that project from the
 * repository and then **uses it the way a buyer would** — a clean install from
 * the lockfile, the whole test suite, one real video — before zipping it. A
 * bundle that has only ever been checked from inside the checkout it came from
 * is exactly how the first packaging shipped a binary that could not start.
 *
 * **An allowlist, not a denylist.** A new file added to the repository does not
 * reach buyers until someone decides it should; the failure mode of a denylist
 * is a private photograph going out because nobody thought to exclude it.
 */

/** Always shipped, as git names them. */
const ALWAYS = new Set([
  "README.md",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  ".gitignore",
  "assets/fighters/source/README.md",
  "assets/props/README.md",
]);

/** The owner's release tooling. It needs his git history and his private cast. */
const RELEASE_ONLY = new Set(["src/cli/bundle.ts", "src/cli/bundle.test.ts"]);

const PRIVATE_ROSTER_FILE = "src/content/roster.private.ts";

/**
 * Props that ship. `compass` is Public Domain (Wikimedia Commons) and `glasses`
 * is the owner's own photograph. `glove` does not: it is cut out of the stock
 * photograph of Boxer Guy and carries that photograph's licence.
 */
export const SHIPPED_PROPS = ["compass", "glasses"];

/** File name without directory or image/sidecar extension. */
function stem(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(cut\.json|png|jpe?g|webp)$/i, "");
}

/** Which of the repository's tracked files go into the product. */
export function shippedFiles(tracked: string[], spriteIds: string[]): string[] {
  const sprites = new Set(spriteIds);
  return tracked.filter((path) => {
    if (ALWAYS.has(path)) return true;
    if (RELEASE_ONLY.has(path) || path === PRIVATE_ROSTER_FILE) return false;
    if (path.startsWith("src/") || path.startsWith("assets/fonts/") || path.startsWith("docs/")) {
      return true;
    }
    if (path.startsWith("assets/fighters/")) return sprites.has(stem(path));
    if (path.startsWith("assets/props/")) return SHIPPED_PROPS.includes(stem(path));
    return false;
  });
}

/**
 * Anything in the list that must never leave the owner's hands. Checked after
 * the allowlist rather than trusted to it: the two are written by the same
 * person, and a second, independent reading of the result is the only kind of
 * check that catches a mistake in the first.
 */
export function leaks(files: string[], privateSpriteIds: string[]): string[] {
  const forbidden = new Set([...privateSpriteIds, "glove"]);
  return files.filter(
    (path) =>
      forbidden.has(stem(path)) ||
      path.startsWith("refs/") ||
      path.startsWith("out/") ||
      path.startsWith(".claude/") ||
      path === "CLAUDE.md" ||
      path === PRIVATE_ROSTER_FILE,
  );
}

/** What the product's private-roster file says. */
const PRIVATE_STUB = [
  'import type { FighterSpec } from "./roster.js";',
  "",
  "/**",
  " * Your private cast, if you have one: fighters you are licensed to use but not",
  " * to pass on. Declared here instead of in `roster.ts`, they stay out of",
  " * anything you share, and `pnpm solve` balances them together with the rest.",
  " * Empty in the product.",
  " */",
  "export const PRIVATE_ROSTER: FighterSpec[] = [];",
  "",
].join("\n");

/**
 * `pnpm` inside the bundle. A shell on Windows only, where `pnpm` is a `.cmd`
 * shim that cannot be started without one; the arguments are fixed strings.
 */
function pnpm(cwd: string, args: string[]): void {
  console.log(`\n$ pnpm ${args.join(" ")}`);
  const run = spawnSync("pnpm", args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (run.status !== 0) throw new Error(`pnpm ${args.join(" ")} exited with ${String(run.status)}`);
}

function main(): void {
  const quick = process.argv.includes("--quick");
  const pkg = JSON.parse(readFileSync(inPackage("package.json"), "utf8")) as {
    version: string;
    scripts: Record<string, string>;
  };
  const name = `munasi-${pkg.version}`;
  const dist = inPackage("dist");
  const out = join(dist, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: inPackage(), encoding: "utf8" })
    .split("\0")
    .filter((path) => path !== "");
  const files = shippedFiles(tracked, SHIPPED_ROSTER.map((f) => f.spriteId));
  const leaked = leaks(files, PRIVATE_ROSTER.map((f) => f.spriteId));
  if (leaked.length > 0) throw new Error(`refusing to bundle private files:\n  ${leaked.join("\n  ")}`);
  for (const sprite of SHIPPED_ROSTER.map((f) => f.spriteId)) {
    if (!files.includes(`assets/fighters/${sprite}.png`)) {
      throw new Error(`${sprite} ships in the roster but its cut-out is not tracked`);
    }
  }

  for (const path of files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    copyFileSync(inPackage(path), join(out, path));
  }
  writeFileSync(join(out, PRIVATE_ROSTER_FILE), PRIVATE_STUB);
  const shippedPkg = { ...pkg, scripts: { ...pkg.scripts } };
  delete shippedPkg.scripts["bundle"];
  writeFileSync(join(out, "package.json"), `${JSON.stringify(shippedPkg, null, 2)}\n`);
  console.log(`${files.length} files -> ${out}`);

  // The buyer's first five minutes, in order.
  pnpm(out, ["install", "--frozen-lockfile"]);
  pnpm(out, ["calibrate"]);
  if (!quick) pnpm(out, ["solve", "4", "240"]);

  const fighters = JSON.parse(readFileSync(join(out, "src", "content", "fighters.json"), "utf8")) as {
    id: string;
  }[];
  const expected = SHIPPED_ROSTER.map((f) => f.id);
  if (JSON.stringify(fighters.map((f) => f.id)) !== JSON.stringify(expected)) {
    throw new Error(`bundle fighters.json holds ${fighters.map((f) => f.id).join(", ")}`);
  }

  pnpm(out, ["typecheck"]);
  pnpm(out, ["test"]);
  pnpm(out, ["generate", "--count", "1", "--seeds", "60"]);

  // Leave nothing the verification made behind in what is handed over.
  for (const scratch of ["node_modules", "out", join("assets", "audio")]) {
    rmSync(join(out, scratch), { recursive: true, force: true });
  }

  const zip = join(dist, `${name}.zip`);
  rmSync(zip, { force: true });
  const zipped = spawnSync("zip", ["-r", "-q", `${name}.zip`, name], { cwd: dist, stdio: "inherit" });
  console.log(
    zipped.status === 0
      ? `\n${zip}`
      : `\nno zip on this machine — ${out} is the bundle; archive it by hand`,
  );
  if (!existsSync(join(out, "README.md"))) throw new Error("bundle has no README");
}

if (isMain(import.meta.url)) main();
