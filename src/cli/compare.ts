import { basename } from "node:path";
import { comparisonRows, measureVideo, type VideoMeasure } from "../export/measure.js";
import { isMain } from "../util/main.js";

/**
 * Measures the same things in our videos and in a reference, side by side:
 *
 *   pnpm compare out/samples/*.mp4 -- refs/videos/guitar.mp4
 *
 * Everything before `--` is ours, everything after is a reference. Both are
 * measured by identical code off their own pixels, which is the whole point:
 * the six composition misses this project has paid for were all invisible to
 * gates that only looked at our own numbers, and all six fell out the moment
 * the same quantity was read in both files.
 *
 * There is no pass or fail here on purpose. A difference is not automatically a
 * defect — the reference has a guitar track filling a third of its arena, so its
 * blue share is lower and always will be — and a tool that cried wolf about that
 * would stop being read. It prints; you compare.
 */

interface Args {
  ours: string[];
  refs: string[];
  fps: number;
}

export function parseArgs(argv: string[]): Args {
  const split = argv.indexOf("--");
  const before = split < 0 ? argv : argv.slice(0, split);
  const after = split < 0 ? [] : argv.slice(split + 1);
  const flag = (name: string): string | undefined => {
    const at = before.indexOf(`--${name}`);
    return at < 0 ? undefined : before[at + 1];
  };
  const fpsRaw = flag("fps");
  return {
    ours: before.filter((a) => a.endsWith(".mp4")),
    refs: after.filter((a) => a.endsWith(".mp4")),
    fps: fpsRaw === undefined ? 30 : Number(fpsRaw),
  };
}

/** Pads to a visible width, counting characters rather than bytes. */
function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - [...text].length));
}

export function renderTable(measures: VideoMeasure[], labels: string[]): string {
  const rows = comparisonRows(measures);
  const head = ["", ...labels];
  const widths = head.map((h, i) =>
    Math.max(
      [...h].length,
      ...rows.map((r) => [...(i === 0 ? r.label : (r.values[i - 1] ?? ""))].length),
    ),
  );
  const line = (cells: string[]): string =>
    cells.map((c, i) => pad(c, widths[i]!)).join("  ").trimEnd();
  return [
    line(head),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map((r) => line([r.label, ...r.values])),
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.ours.length === 0) {
    console.log("usage: pnpm compare <ours.mp4> [more.mp4 ...] [-- <reference.mp4> ...]");
    return;
  }
  const files = [...args.ours, ...args.refs];
  const measures: VideoMeasure[] = [];
  for (const file of files) {
    process.stdout.write(`меряю ${basename(file)}...\r`);
    measures.push(await measureVideo(file, args.fps));
  }
  process.stdout.write(" ".repeat(60) + "\r");

  const labels = [
    ...args.ours.map((f) => basename(f, ".mp4")),
    ...args.refs.map((f) => `РЕФ ${basename(f, ".mp4")}`),
  ];
  console.log(renderTable(measures, labels));
  if (args.refs.length === 0) {
    console.log("\n(референса не передано — добавь `-- путь/к/референсу.mp4`, чтобы было с чем сравнивать)");
  }
}

if (isMain(import.meta.url)) await main();
