import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PRIVATE_ROSTER } from "../content/roster.private.js";
import { SHIPPED_ROSTER } from "../content/roster.js";
import { inPackage } from "../util/paths.js";
import { leaks, SHIPPED_PROPS, shippedFiles } from "./bundle.js";

/**
 * What goes into the product, checked against the real repository.
 *
 * The expensive half of `pnpm bundle` — installing, testing and rendering inside
 * the bundle — is too slow for the suite; the half that decides *which files*
 * ship is instant and is the half that can leak a licensed photograph, so it is
 * gated here on every run.
 */

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: inPackage(), encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "");
const files = shippedFiles(tracked, SHIPPED_ROSTER.map((f) => f.spriteId));

describe("the bundle", () => {
  it("carries none of the owner's private files", () => {
    expect(leaks(files, PRIVATE_ROSTER.map((f) => f.spriteId))).toEqual([]);
  });

  it("carries every shipped fighter, cut-out and source", () => {
    for (const { spriteId } of SHIPPED_ROSTER) {
      expect(files, spriteId).toContain(`assets/fighters/${spriteId}.png`);
      expect(
        files.some((f) => f.startsWith(`assets/fighters/source/${spriteId}.`)),
        `${spriteId} source`,
      ).toBe(true);
    }
  });

  it("carries the fonts, since text metrics are part of the rendered bytes", () => {
    expect(files.filter((f) => f.startsWith("assets/fonts/")).length).toBeGreaterThanOrEqual(3);
  });

  it("carries only the props it is licensed to", () => {
    const props = files.filter((f) => f.startsWith("assets/props/") && !f.endsWith(".md"));
    expect(props.length).toBeGreaterThan(0);
    for (const prop of props) {
      expect(SHIPPED_PROPS.some((name) => prop.includes(`/${name}.`)), prop).toBe(true);
    }
  });

  it("would refuse a private photograph that slipped past the allowlist", () => {
    const [first] = PRIVATE_ROSTER;
    if (first === undefined) return;
    expect(leaks([`assets/fighters/${first.spriteId}.png`], [first.spriteId])).toHaveLength(1);
    expect(leaks(["refs/anything.png", "CLAUDE.md", "assets/props/glove.png"], [])).toHaveLength(3);
  });
});
