import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assetDir,
  inPackage,
  inProject,
  packageRoot,
  projectRoot,
  requireCutouts,
  rosterPath,
} from "./paths.js";

/**
 * The split between "belongs to the tool" and "belongs to whoever installed it".
 *
 * Worth gating because getting it wrong does not throw. A font resolved against
 * the wrong root registers nothing and the renderer quietly falls back to
 * whatever fontconfig serves — different text metrics, different pixels, and the
 * byte-for-byte reproducibility this whole project is built on is gone with no
 * error anywhere.
 */

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("paths", () => {
  it("finds the package by its own package.json, not by counting directories", () => {
    expect(existsSync(join(packageRoot(), "package.json"))).toBe(true);
    expect(existsSync(inPackage("src", "util", "paths.ts"))).toBe(true);
  });

  it("keeps the vendored font with the tool wherever it is run from", () => {
    const dir = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    process.env["MUNASI_PROJECT"] = dir;
    expect(projectRoot()).toBe(dir);
    // The project moved; the font did not.
    expect(assetDir("fonts")).toBe(inPackage("assets", "fonts"));
    expect(existsSync(join(assetDir("fonts"), "DejaVuSans.ttf"))).toBe(true);
  });

  it("puts output in the project, not in the package", () => {
    const dir = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    process.env["MUNASI_PROJECT"] = dir;
    expect(inProject("out")).toBe(join(dir, "out"));
    expect(inProject("out").startsWith(packageRoot())).toBe(false);
  });

  it("passes an absolute path straight through", () => {
    expect(inProject("/somewhere/else")).toBe("/somewhere/else");
  });

  it("prefers the project's own roster and falls back to the shipped one", () => {
    const dir = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    process.env["MUNASI_PROJECT"] = dir;
    delete process.env["MUNASI_ROSTER"];
    // Nothing there yet: the shipped cast, so a first run does something.
    expect(rosterPath()).toBe(inPackage("src", "content", "fighters.json"));
    writeFileSync(join(dir, "fighters.json"), "[]");
    expect(rosterPath()).toBe(join(dir, "fighters.json"));
  });

  it("lets an explicit roster win over both", () => {
    const dir = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    writeFileSync(join(dir, "mine.json"), "[]");
    process.env["MUNASI_ROSTER"] = join(dir, "mine.json");
    expect(rosterPath()).toBe(join(dir, "mine.json"));
  });

  it("treats a blank override as unset", () => {
    process.env["MUNASI_PROJECT"] = "   ";
    expect(projectRoot()).toBe(process.cwd());
  });

  it("falls back to the shipped cast when the project has no fighters yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    process.env["MUNASI_PROJECT"] = dir;
    expect(assetDir("fighters")).toBe(inPackage("assets", "fighters"));
  });

  it("is not fooled by an empty directory that `init` just made", () => {
    // The bug this exists for: `munasi init` creates `assets/fighters/` for you
    // to fill, an existence check said "the project has fighters", and the first
    // run of a fresh project died in a render worker with an exit code and
    // nothing else.
    const dir = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    process.env["MUNASI_PROJECT"] = dir;
    mkdirSync(join(dir, "assets", "fighters", "source"), { recursive: true });
    expect(assetDir("fighters")).toBe(inPackage("assets", "fighters"));
    // One cut-out of their own, and it is their directory from then on.
    writeFileSync(join(dir, "assets", "fighters", "someone.png"), "");
    expect(assetDir("fighters")).toBe(join(dir, "assets", "fighters"));
  });

  it("explains an empty cast instead of throwing ENOENT at it", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "munasi-elsewhere-")), "nope");
    expect(() => requireCutouts(missing)).toThrow(/no fighters found/);
    // And says what to do about it, because this is the first thing a new
    // install hits and the render worker's stderr is not shown to anybody.
    expect(() => requireCutouts(missing)).toThrow(/munasi cutout/);

    const empty = mkdtempSync(join(tmpdir(), "munasi-elsewhere-"));
    expect(() => requireCutouts(empty)).toThrow(/no fighters found/);
    writeFileSync(join(empty, "someone.png"), "");
    expect(requireCutouts(empty)).toEqual(["someone.png"]);
  });
});
