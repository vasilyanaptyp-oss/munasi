import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet } from "../sim/gauntlet.js";
import { defaultPlan, VICTORY_CARD_FRAMES } from "../render/framePlan.js";
import { renderFrames } from "../render/index.js";
import { exportVideo } from "./video.js";
import { describeMotion, judgeMotion, STATIC_TAIL_ALLOWANCE } from "./motion.js";

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
 *
 * **The whole file is measured, not a window.** It used to be six seconds from
 * the middle, and the middle is the kindest part: the closing stretch of shipped
 * videos ran 6.7-7.7% changed with 22-30% of frames static — failing numbers, on
 * files that passed. The end really is allowed to hold still, so the allowance
 * is named and bounded instead of being hidden by where the gate happened to
 * look.
 */

const roster = loadFighters();
let workdir: string | null = null;
let video: string | null = null;

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
  beforeAll(async () => {
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
    video = exported.path;
  }, 600_000);

  it("moves as much as the reference does, over the whole file", () => {
    const verdict = judgeMotion(video!);
    const summary =
      `whole file: ${describeMotion(verdict.whole)}; ` +
      `body: ${describeMotion(verdict.body)}; ` +
      `${verdict.staticFrames} static frames against an allowance of ${STATIC_TAIL_ALLOWANCE}`;
    expect(verdict.failures.join("\n"), summary).toBe("");
  }, 120_000);

  it("fails when the stillness runs past the closing card", () => {
    // The allowance has to bite, or it is only a wider window with extra steps.
    // A second of frozen frames welded onto the same video must fail.
    const frozen = join(workdir!, "frozen.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      video!,
      "-vf",
      "tpad=stop_mode=clone:stop_duration=1.5",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-an",
      frozen,
    ]);
    const verdict = judgeMotion(frozen);
    expect(verdict.staticBeyondAllowance).toBeGreaterThan(0);
    expect(verdict.failures.join("\n")).toMatch(/static frames in the file/);
  }, 120_000);
});
