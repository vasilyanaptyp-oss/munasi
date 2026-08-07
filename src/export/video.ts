import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { MatchResult } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { buildSfxTrack, MUSIC_FILE, writeSfxTrack } from "./audio.js";

const execFileAsync = promisify(execFile);

/** Seconds of winner freeze-frame appended to every video. */
export const VICTORY_FREEZE_SECONDS = 2;
export const VICTORY_FREEZE_FRAMES = VICTORY_FREEZE_SECONDS * FPS;

const CRF = 20;
/** Music sits under the SFX rather than competing with them. */
const MUSIC_VOLUME = 0.32;
const FADE_SECONDS = 1.2;

const INSTALL_HINT =
  "ffmpeg is required to export video but was not found on PATH.\n" +
  "  Arch Linux:    sudo pacman -S ffmpeg\n" +
  "  Debian/Ubuntu: sudo apt install ffmpeg\n" +
  "  macOS:         brew install ffmpeg";

export class FfmpegMissingError extends Error {
  constructor() {
    super(INSTALL_HINT);
    this.name = "FfmpegMissingError";
  }
}

/** Throws a message you can act on if ffmpeg is not installed. */
export function checkFfmpeg(): { version: string } {
  try {
    const out = execFileSync("ffmpeg", ["-version"], { encoding: "utf8", stdio: "pipe" });
    return { version: out.split("\n")[0] ?? "unknown" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new FfmpegMissingError();
    throw error;
  }
}

/** Filesystem-safe fighter name. */
export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "fighter"
  );
}

/**
 * Named from fighter ids rather than display names: names are free to be
 * non-ASCII (the roster is in Russian), and transliterating them into a
 * filename would be lossy and locale-dependent. Ids stay ASCII by convention.
 */
export function videoFileName(result: MatchResult): string {
  return `${slug(result.fighters.a.id)}-vs-${slug(result.fighters.b.id)}-${result.seed}.mp4`;
}

export interface ExportOptions {
  /** Directory holding `frame_000000.png`… */
  framesDir: string;
  /** Where the mp4 lands. Defaults to `out/`. */
  outDir?: string;
  /** Where the WAV assets live. Defaults to `assets/audio/`. */
  audioDir?: string;
  /** Skip the audio track entirely (used by fast tests). */
  silent?: boolean;
}

export interface ExportResult {
  path: string;
  /** Duration reported by ffprobe, in seconds. */
  durationSeconds: number;
  sizeBytes: number;
}

function countFrames(dir: string): number {
  return readdirSync(dir).filter((f) => f.startsWith("frame_") && f.endsWith(".png")).length;
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

/**
 * Encodes a rendered frame sequence into an H.264 mp4 with a mixed soundtrack.
 * Returns the path and the duration ffprobe reads back from the file.
 */
export async function exportVideo(
  result: MatchResult,
  options: ExportOptions,
): Promise<ExportResult> {
  checkFfmpeg();

  const outDir = options.outDir ?? join(process.cwd(), "out");
  mkdirSync(outDir, { recursive: true });

  const totalFrames = countFrames(options.framesDir);
  if (totalFrames === 0) {
    throw new Error(`no frames found in ${options.framesDir} — render the match first`);
  }
  const videoSeconds = totalFrames / FPS;
  const outPath = join(outDir, videoFileName(result));

  const args: string[] = ["-y", "-framerate", String(FPS), "-i", join(options.framesDir, "frame_%06d.png")];
  let workDir: string | null = null;

  if (!options.silent) {
    workDir = mkdtempSync(join(tmpdir(), "munasi-audio-"));
    const sfxPath = join(workDir, "sfx.wav");
    writeSfxTrack(
      sfxPath,
      buildSfxTrack(result, {
        totalFrames,
        ...(options.audioDir === undefined ? {} : { audioDir: options.audioDir }),
      }),
    );
    const musicPath = join(options.audioDir ?? join(process.cwd(), "assets", "audio"), MUSIC_FILE);

    const fadeOutStart = Math.max(0, videoSeconds - FADE_SECONDS).toFixed(3);
    // Music loops under the whole match; the SFX bus is already timed to the
    // events, so ffmpeg only has to balance the two and fade the tail.
    const filter =
      `[1:a]volume=${MUSIC_VOLUME},afade=t=in:st=0:d=${FADE_SECONDS}[music];` +
      `[2:a]volume=1.0[sfx];` +
      `[music][sfx]amix=inputs=2:duration=longest:normalize=0[mixed];` +
      `[mixed]afade=t=out:st=${fadeOutStart}:d=${FADE_SECONDS},aresample=async=1[audio]`;

    args.push(
      "-stream_loop",
      "-1",
      "-i",
      musicPath,
      "-i",
      sfxPath,
      "-filter_complex",
      filter,
      "-map",
      "0:v",
      "-map",
      "[audio]",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
    );
  } else {
    args.push("-map", "0:v", "-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(CRF),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-shortest",
    "-movflags",
    "+faststart",
    outPath,
  );

  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed encoding ${outPath}\n${stderr.split("\n").slice(-15).join("\n")}`);
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }

  return {
    path: outPath,
    durationSeconds: await probeDuration(outPath),
    sizeBytes: statSync(outPath).size,
  };
}
