import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findBestMatch } from "../sim/drama.js";
import { abilityMatch } from "../sim/testFixtures.js";
import { renderSingleFrame } from "../render/frame.js";

/**
 * Renders a handful of sample frames for eyeballing the composition:
 *   pnpm frame [frame ...]
 */
function main(): void {
  const outDir = join(process.cwd(), "out", "preview");
  mkdirSync(outDir, { recursive: true });

  const best = findBestMatch(abilityMatch(), { count: 500 });
  const { result } = best;
  console.log(
    `seed ${best.seed}  drama ${best.score.toFixed(1)}  ` +
      `${(result.durationFrames / 30).toFixed(1)}s  winner ${result.winnerId}`,
  );

  const requested = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  const frames =
    requested.length > 0
      ? requested
      : [
          0,
          Math.floor(result.durationFrames * 0.25),
          Math.floor(result.durationFrames * 0.6),
          result.durationFrames - 1,
        ];

  for (const frame of frames) {
    const png = renderSingleFrame(result, frame, {
      victoryOverlay: frame === result.durationFrames - 1,
    });
    const path = join(outDir, `frame_${String(frame).padStart(6, "0")}.png`);
    writeFileSync(path, png);
    console.log(`${path}  ${(png.length / 1024).toFixed(0)} KB`);
  }
}

main();
