import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ensureFonts, font } from "../render/theme.js";
import { isMain } from "../util/main.js";
import { ffmpegBin, ffprobeBin } from "../util/tools.js";

/**
 * One picture that shows a whole batch:
 *
 *   pnpm sheet out/samples/*.mp4
 *
 * A row per video, a handful of frames spread evenly across each, captioned
 * with the file name and length. Written to `out/sheet.png`.
 *
 * It exists because reviewing happens on a phone. Twenty videos is twenty
 * downloads and twenty playbacks to notice that one of them has the caption cut
 * off; the same twenty as one image is a glance. It replaces nothing — a defect
 * in *motion* only shows in playback — but every composition mistake this
 * project has shipped was visible in a still.
 */

/** Frames sampled per video. Six across a 25-second fight is one every 4s. */
const COLUMNS = 6;
/** Width each sampled frame is drawn at. Legible on a phone at full width. */
const CELL_WIDTH = 300;
const LABEL_HEIGHT = 34;
const PADDING = 8;

export interface SheetRow {
  file: string;
  seconds: number;
  frames: string[];
}

function durationOf(file: string): number {
  try {
    const out = execFileSync(
      ffprobeBin(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    ).trim();
    return Number.isFinite(Number(out)) ? Number(out) : 0;
  } catch {
    return 0;
  }
}

/**
 * Pulls `COLUMNS` frames spread across the video.
 *
 * Sampled by time rather than by frame number, and the first sample is a beat
 * in rather than at zero: frame zero is the face-off before anything has
 * happened, and a sheet of six face-offs says nothing.
 */
function sampleFrames(file: string, dir: string, seconds: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < COLUMNS; i += 1) {
    const at = seconds * (0.08 + (0.84 * i) / (COLUMNS - 1));
    const name = join(dir, `${out.length}.png`);
    execFileSync(
      ffmpegBin(),
      ["-v", "error", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-y", name],
      { stdio: "ignore" },
    );
    out.push(name);
  }
  return out;
}

export async function buildSheet(files: string[], outPath: string): Promise<SheetRow[]> {
  ensureFonts();
  const dir = mkdtempSync(join(tmpdir(), "munasi-sheet-"));
  const rows: SheetRow[] = [];
  try {
    for (const file of files) {
      const seconds = durationOf(file);
      const sub = mkdtempSync(join(dir, "v-"));
      rows.push({ file, seconds, frames: sampleFrames(file, sub, seconds) });
    }
    if (rows.length === 0) return rows;

    const first = await loadImage(rows[0]!.frames[0]!);
    const cellHeight = Math.round((CELL_WIDTH * first.height) / first.width);
    const rowHeight = cellHeight + LABEL_HEIGHT + PADDING;
    const canvas = createCanvas(
      COLUMNS * (CELL_WIDTH + PADDING) + PADDING,
      rows.length * rowHeight + PADDING,
    );
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r]!;
      const y = PADDING + r * rowHeight;
      ctx.fillStyle = "#e8edf2";
      ctx.font = font(20);
      ctx.textBaseline = "top";
      ctx.fillText(`${basename(row.file)}   ${row.seconds.toFixed(1)}s`, PADDING, y);
      for (let c = 0; c < row.frames.length; c += 1) {
        const image = await loadImage(row.frames[c]!);
        ctx.drawImage(
          image,
          PADDING + c * (CELL_WIDTH + PADDING),
          y + LABEL_HEIGHT,
          CELL_WIDTH,
          cellHeight,
        );
      }
    }
    writeFileSync(outPath, canvas.toBuffer("image/png"));
    return rows;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.filter((a) => a.endsWith(".mp4"));
  if (files.length === 0) {
    console.log("usage: pnpm sheet <file.mp4> [more.mp4 ...] [--out out/sheet.png]");
    return;
  }
  const at = args.indexOf("--out");
  const outPath = at >= 0 ? args[at + 1]! : join(process.cwd(), "out", "sheet.png");
  const rows = await buildSheet(files, outPath);
  console.log(`${rows.length} video(s) -> ${outPath}`);
  for (const row of rows) console.log(`  ${basename(row.file)}  ${row.seconds.toFixed(1)}s`);
}

if (isMain(import.meta.url)) await main();

/** Kept for the CLI test to reach without shelling out. */
export const SHEET_COLUMNS = COLUMNS;
