/**
 * Where `ffmpeg` and `ffprobe` live.
 *
 * Both are looked up on `PATH` by default, which is right on a developer's
 * machine and wrong wherever they are installed somewhere else — a CI image
 * that unpacks a static build into the workspace, a Windows box with the
 * binaries in a folder next to the project, a sandbox with a pinned build.
 * `FFMPEG_PATH` and `FFPROBE_PATH` override the lookup; `FFPROBE_PATH` falls
 * back to `ffprobe` sitting beside whatever `FFMPEG_PATH` points at, because
 * every distribution ships them together.
 *
 * Read at call time rather than at import: a test that sets the variable and
 * then calls in has to see it, and a module-level constant would not.
 */
import { dirname, join } from "node:path";

function fromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

export function ffmpegBin(): string {
  return fromEnv("FFMPEG_PATH") ?? "ffmpeg";
}

export function ffprobeBin(): string {
  const explicit = fromEnv("FFPROBE_PATH");
  if (explicit !== undefined) return explicit;
  const ffmpeg = fromEnv("FFMPEG_PATH");
  if (ffmpeg !== undefined && ffmpeg.includes("/")) {
    return join(dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  }
  return "ffprobe";
}
