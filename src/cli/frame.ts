import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet } from "../sim/gauntlet.js";
import { findBestMatch } from "../sim/drama.js";
import { renderAnyFrame } from "../render/index.js";

/**
 * Renders sample frames of a real matchup for eyeballing the composition:
 *   pnpm frame [frame ...]           frames of the default matchup
 *   pnpm frame --a=plumber --b=baker chosen fighters
 */
function main(): void {
  const outDir = join(process.cwd(), "out", "preview");
  mkdirSync(outDir, { recursive: true });

  const roster = loadFighters();
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

  let best: { seed: number; score: number; result: { durationFrames: number } };
  let result: Parameters<typeof renderAnyFrame>[0];

  if (argv.includes("--duel")) {
    const a = getFighter(flag("a") ?? "plumber", roster);
    const b = getFighter(flag("b") ?? "councillor", roster);
    console.log(`${a.name} vs ${b.name}`);
    const duel = findBestMatch({ a, b }, { count: 500 });
    best = duel;
    result = duel.result;
  } else {
    const challenger = getFighter(flag("a") ?? "plumber", roster);
    const members = (flag("team") ?? "arbiter,councillor,inspector")
      .split(",")
      .map((id) => getFighter(id.trim(), roster));
    console.log(`${challenger.name} vs ${members.map((m) => m.name).join(", ")}`);
    const run = findBestGauntlet(buildGauntlet(challenger, members), {
      count: 200,
      rules: GAUNTLET_RULES,
    });
    best = run;
    result = run.result;
  }
  console.log(
    `seed ${best.seed}  drama ${best.score.toFixed(1)}  ` +
      `${(best.result.durationFrames / 30).toFixed(1)}s`,
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
    const png = renderAnyFrame(result, frame, {
      planned: { source: frame, victoryOverlay: frame === result.durationFrames - 1 },
    });
    const path = join(outDir, `frame_${String(frame).padStart(6, "0")}.png`);
    writeFileSync(path, png);
    console.log(`${path}  ${(png.length / 1024).toFixed(0)} KB`);
  }
}

main();
