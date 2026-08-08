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
  }
  console.log(
    `\ntarget: >= ${(MOTION_TARGET.meanChanged * 100).toFixed(0)}% changed per frame, ` +
      `< ${(MOTION_TARGET.staticShare * 100).toFixed(0)}% static frames`,
  );
  if (failures > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
