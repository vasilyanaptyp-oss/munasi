import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet } from "../sim/gauntlet.js";
import { defaultPlan } from "../render/framePlan.js";
import { renderFrames } from "../render/index.js";
import { VICTORY_CARD_FRAMES } from "../render/gauntletLayout.js";
import { exportVideo } from "./video.js";
import { describeMotion, measureMotion, MOTION_TARGET } from "./motion.js";

/**
 * Motion gate — the one that catches what the geometry gates cannot.
 *
 * A video can pass every composition rule and every pacing rule and still be a
 * slideshow: figures pinned to slots, numbers blinking on and off, a background
 * that never moves. This is measured on the encoded mp4, because that is what
 * the viewer gets.
 *
 * Reference channel, same method: 12.7% of pixels changing per frame and not a
 * single static frame. Before fighters had positions ours managed 3.0-4.9%
 * with 9-27% of frames static.
 */

const roster = loadFighters();
let workdir: string | null = null;

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasFfmpeg())("motion", () => {
  it("moves as much as the reference does", async () => {
    workdir = mkdtempSync(join(tmpdir(), "munasi-motion-"));
    const config = buildGauntlet(
      getFighter("plumber", roster),
      ["chairman", "silencer", "arbiter"].map((id) => getFighter(id, roster)),
    );
    const { result } = findBestGauntlet(config, { count: 24, rules: GAUNTLET_RULES });
    const plan = defaultPlan(result, VICTORY_CARD_FRAMES);
    const frames = join(workdir, "frames");
    await renderFrames(result, frames, { plan });
    const exported = await exportVideo(result, {
      framesDir: frames,
      outDir: workdir,
      silent: true,
    });

    const report = measureMotion(exported.path);
    expect(report.meanChanged, describeMotion(report)).toBeGreaterThanOrEqual(
      MOTION_TARGET.meanChanged,
    );
    expect(report.staticShare, describeMotion(report)).toBeLessThan(MOTION_TARGET.staticShare);
  }, 600_000);
});
