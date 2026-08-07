import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFighter, loadFighters } from "../content/index.js";
import { findBestMatch } from "../sim/drama.js";
import { renderSingleFrame } from "../render/frame.js";

/**
 * Renders sample frames of a real matchup for eyeballing the composition:
 *   pnpm frame [frame ...]           frames of the default matchup
 *   pnpm frame --a=plumber --b=baker chosen fighters
 */
function main(): void {
  const outDir = join(process.cwd(), "out", "preview");
  mkdirSync(outDir, { recursive: true });

  const roster = loadFighters();
  const flag = (name: string): string | undefined =>
    process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const a = getFighter(flag("a") ?? "plumber", roster);
  const b = getFighter(flag("b") ?? "councillor", roster);
  console.log(`${a.name} vs ${b.name}`);

  const best = findBestMatch({ a, b }, { count: 500 });
  const { result } = best;
  console.log(
    `seed ${best.seed}  drama ${best.score.toFixed(1)}  ` +
      `${(result.durationFrames / 30).toFixed(1)}s  winner ${result.winnerId}`,
  );

  const requested = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .map(Number)
    .filter((n) => Number.isFinite(n));
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
