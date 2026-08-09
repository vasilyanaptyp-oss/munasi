import { describeMotion, measureMotion, MOTION_TARGET } from "../export/motion.js";
import { isMain } from "../util/main.js";

/**
 * How much a finished video moves:
 *
 *   pnpm motion out/samples/*.mp4
 *
 * Measured on the encoded file, because that is what the viewer gets. See
 * `src/export/motion.ts` for the method and the reference numbers.
 */
function main(): void {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.log("usage: pnpm motion <file.mp4> [more.mp4 ...]");
    return;
  }
  let failures = 0;
  for (const file of files) {
    const report = measureMotion(file);
    const ok =
      report.meanChanged >= MOTION_TARGET.meanChanged &&
      report.staticShare < MOTION_TARGET.staticShare;
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${file}\n     ${describeMotion(report)}`);

    // The gated window is six seconds from the middle, and the ends of a video
    // do not behave like its middle: the closing stretch carries the last
    // round's death hold and the winner card, and on shipped files it measures
    // 6.7-7.7% changed with 22-30% of frames static — under the bar the middle
    // clears comfortably. That is not a defect to chase (both holds are
    // deliberate), but the one number in a README should not come from the
    // kindest six seconds of the file, so all three are printed.
    for (const [label, share] of [["opening", 0.06], ["closing", 0.94]] as const) {
      const at = measureMotion(file, { startShare: share });
      console.log(
        `     ${label.padEnd(8)} ${(at.meanChanged * 100).toFixed(1)}% changed, ` +
          `${(at.staticShare * 100).toFixed(1)}% static`,
      );
    }
  }
  console.log(
    `\ntarget (middle window only): >= ${(MOTION_TARGET.meanChanged * 100).toFixed(0)}% ` +
      `changed per frame, < ${(MOTION_TARGET.staticShare * 100).toFixed(0)}% static frames`,
  );
  if (failures > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
