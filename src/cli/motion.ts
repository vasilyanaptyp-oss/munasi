import {
  describeMotion,
  judgeMotion,
  measureMotion,
  MOTION_TARGET,
  STATIC_TAIL_ALLOWANCE,
} from "../export/motion.js";
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
    const verdict = judgeMotion(file);
    const ok = verdict.failures.length === 0;
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${file}\n     ${describeMotion(verdict.whole)}`);
    console.log(
      `     body     ${(verdict.body.meanChanged * 100).toFixed(1)}% changed, ` +
        `${(verdict.body.staticShare * 100).toFixed(1)}% static`,
    );
    console.log(
      `     still    ${verdict.staticFrames} frames, allowance ${STATIC_TAIL_ALLOWANCE}` +
        (verdict.staticBeyondAllowance > 0 ? ` (${verdict.staticBeyondAllowance} over)` : ""),
    );

    // The three windows separately, because the ends of a video do not behave
    // like its middle and a single number in a README should not come from the
    // kindest six seconds of the file.
    for (const [label, share] of [["opening", 0.06], ["middle", 0.5], ["closing", 0.94]] as const) {
      const at = measureMotion(file, { startShare: share });
      console.log(
        `     ${label.padEnd(8)} ${(at.meanChanged * 100).toFixed(1)}% changed, ` +
          `${(at.staticShare * 100).toFixed(1)}% static`,
      );
    }
    for (const reason of verdict.failures) console.log(`     ! ${reason}`);
  }
  console.log(
    `\ntarget: body >= ${(MOTION_TARGET.meanChanged * 100).toFixed(0)}% changed per frame and ` +
      `< ${(MOTION_TARGET.staticShare * 100).toFixed(0)}% static, ` +
      `and no more than ${STATIC_TAIL_ALLOWANCE} still frames in the whole file`,
  );
  if (failures > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
