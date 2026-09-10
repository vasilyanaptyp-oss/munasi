import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Where things live, once this is a package somebody else installs.
 *
 * Two roots, and the split is the whole point:
 *
 * - **`packageRoot()`** — files that belong to the *tool*. The vendored DejaVu
 *   faces are the case that matters: text metrics are part of the frame bytes,
 *   which is what keeps a seed reproducible across machines, so the font must
 *   be the one that shipped and not whatever the user happens to have.
 * - **`projectRoot()`** — files that belong to the *user*: the fighters, the
 *   props, the roster, the output. `process.cwd()`, so running the tool in a
 *   directory means working on that directory's characters.
 *
 * Both used to be `process.cwd()`, which works exactly as long as the tool is
 * only ever run from its own checkout. Installed anywhere else it would find no
 * font, register nothing, and silently render every frame in whatever face
 * fontconfig served — different pixels on different machines, which is the one
 * guarantee this project actually sells.
 */

/** Set by `MUNASI_PROJECT` if you want to work on a directory you are not in. */
export function projectRoot(): string {
  const override = process.env["MUNASI_PROJECT"];
  return override !== undefined && override.trim() !== ""
    ? resolve(override)
    : process.cwd();
}

/**
 * The installed package's own directory.
 *
 * Walks up from this file looking for the `package.json` that names us, rather
 * than counting `..`s: the count differs between running from source (`src/`)
 * and running from a build, and a wrong count fails as a missing font rather
 * than as an error.
 */
export function packageRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return import.meta.dirname;
}

/** A path inside the user's project, absolute paths passed through. */
export function inProject(...parts: string[]): string {
  const first = parts[0];
  if (first !== undefined && isAbsolute(first)) return join(...parts);
  return join(projectRoot(), ...parts);
}

/** A path inside the installed package. */
export function inPackage(...parts: string[]): string {
  return join(packageRoot(), ...parts);
}

/**
 * The roster the tool should read.
 *
 * A user's own `fighters.json` in their project wins; otherwise the one that
 * shipped with the package, so `munasi generate` does something out of the box
 * instead of failing on an empty directory.
 */
export function rosterPath(): string {
  const override = process.env["MUNASI_ROSTER"];
  if (override !== undefined && override.trim() !== "") return resolve(override);
  const own = inProject("fighters.json");
  return existsSync(own) ? own : inPackage("src", "content", "fighters.json");
}

/**
 * Where the fighters' cut-outs are.
 *
 * The user's directory if it **has cut-outs in it**, the package's otherwise.
 *
 * "Has the directory" is not the test, and using it was a real bug: `munasi
 * init` creates an empty `assets/fighters/` for you to fill, so a fresh project
 * satisfied `existsSync` on the first run, resolved to a folder with no PNGs in
 * it, and the render worker died with an exit code and no explanation. The
 * point of shipping a cast at all is that the first run works.
 */
export function assetDir(name: "fighters" | "props" | "audio" | "fonts"): string {
  if (name === "fonts") return inPackage("assets", "fonts");
  const own = inProject("assets", name);
  if (name === "audio") return own;
  if (hasCutouts(own)) return own;
  const shipped = inPackage("assets", name);
  return hasCutouts(shipped) ? shipped : own;
}

function hasCutouts(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((f) => f.endsWith(".png"));
  } catch {
    return false;
  }
}

/**
 * The cut-outs in a directory, or a straight answer about why there are none.
 *
 * The published package deliberately carries **no fighters**: they are
 * photographs of people, licensed to whoever bought them, and shipping them
 * inside a package anybody can install is how a licence gets breached by
 * accident. So a fresh install has an empty cast, and the failure a user
 * actually hits has to say that — not throw `ENOENT` from `readdirSync` three
 * frames into a render worker whose stderr nobody sees.
 */
export function requireCutouts(dir: string): string[] {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")) : [];
  if (files.length > 0) return files;
  throw new Error(
    [
      `no fighters found in ${dir}`,
      "  munasi ships no cast: the characters are photographs of real people and",
      "  are not the author's to redistribute.",
      "  1. put photos on a white background in assets/fighters/source/",
      "  2. munasi cutout",
      "  3. describe them in fighters.json, then munasi calibrate",
      "  see docs/ADDING-A-FIGHTER.md",
    ].join("\n"),
  );
}
