#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inPackage, inProject, projectRoot } from "../util/paths.js";
import { runTs } from "../util/tsx.js";

/**
 * The one entry point an installed copy exposes:
 *
 *   munasi <command> [args]
 *
 * The `pnpm <script>` names stay exactly as they are for working inside this
 * checkout — they are what every note in CLAUDE.md refers to — and this maps the
 * same names onto a single binary for everybody else. A tool people install has
 * to be one word plus a verb; `pnpm run` is a repository, not a product.
 */

const COMMANDS: Record<string, { file: string; blurb: string }> = {
  init: { file: "", blurb: "scaffold a project in the current directory" },
  generate: { file: "src/cli/generate.ts", blurb: "render videos for the best matchups" },
  audit: { file: "src/cli/audit.ts", blurb: "read a finished mp4 frame by frame and check it against the simulation" },
  cutout: { file: "src/content/cutout.ts", blurb: "photo on white -> cut-out PNG" },
  calibrate: { file: "src/content/calibrate.ts", blurb: "rebuild fighters.json from the roster" },
  balance: { file: "src/content/validateBalance.ts", blurb: "winrate matrix for every pair" },
  solve: { file: "src/content/solveField.ts", blurb: "even the roster out as a fixed point" },
  frame: { file: "src/cli/frame.ts", blurb: "render sample frames to out/preview" },
  compare: { file: "src/cli/compare.ts", blurb: "measure our videos and a reference the same way" },
  sheet: { file: "src/cli/sheet.ts", blurb: "contact sheet of a batch, one image" },
  motion: { file: "src/cli/motion.ts", blurb: "how much a finished mp4 actually moves" },
  smoke: { file: "src/cli/smoke.ts", blurb: "the shipped path end to end" },
};

function usage(): void {
  console.log("munasi <command> [args]\n");
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, { blurb }] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(width)}  ${blurb}`);
  }
  console.log("\nMUNASI_PROJECT  work on a directory you are not in");
  console.log("MUNASI_ROSTER   use a roster from somewhere else");
  console.log("FFMPEG_PATH     ffmpeg somewhere other than PATH");
}

/**
 * Lays out an empty project.
 *
 * Deliberately does **not** copy the shipped cast: those photographs are
 * licensed to this project's owner, and a scaffold that quietly duplicates them
 * into somebody else's repository is how a licence gets breached by accident.
 * It creates the directories the pipeline reads and says what to put in them.
 */
function init(): void {
  const root = projectRoot();
  const made: string[] = [];
  for (const dir of [
    ["assets", "fighters", "source"],
    ["assets", "props", "source"],
    ["out"],
  ]) {
    const path = join(root, ...dir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      made.push(dir.join("/"));
    }
  }
  const readme = join(root, "FIGHTERS.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      [
        "# Your cast",
        "",
        "1. Put photographs on a **white studio background** in",
        "   `assets/fighters/source/`. Cropped waist-up, one person, 700px or",
        "   more on the short side. The background is flood-filled from the edge",
        "   of the frame, so anything that is not near-white will stay.",
        "2. `pnpm cutout` — removes the background and reads each figure's",
        "   outline out of the alpha channel.",
        "3. Add each one to `src/content/roster.ts` (or `roster.private.ts` for",
        "   fighters you may not share), then `pnpm solve` to even the roster out.",
        "   Step by step: `docs/ADDING-A-FIGHTER.md`.",
        "4. `pnpm generate --count 10`.",
        "",
        "**Licensing is yours.** Stock photography usually forbids showing a model",
        "in an unflattering light, and this format has them losing fights. Buy the",
        "licence that covers it; a free-to-use licence covers copyright, not a",
        "person's right to their own image.",
        "",
      ].join("\n"),
      "utf8",
    );
    made.push("FIGHTERS.md");
  }
  console.log(
    made.length === 0
      ? `nothing to do — ${root} is already set up`
      : `created in ${root}:\n  ${made.join("\n  ")}`,
  );
  console.log("\nnext: put photographs in assets/fighters/source/, then `pnpm cutout`");
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    usage();
    return;
  }
  const entry = COMMANDS[command];
  if (entry === undefined) {
    console.error(`unknown command: ${command}\n`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (command === "init") {
    init();
    return;
  }
  // The sources ship as TypeScript — a build step is one more thing to keep in
  // step with the determinism guarantee — so each command runs under tsx's
  // loader. See `runTs` for why that is Node itself and not the `tsx` shim.
  const result = runTs(inPackage(entry.file), rest, { stdio: "inherit", cwd: inProject() });
  process.exitCode = result.status ?? 1;
}

main();
