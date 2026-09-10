import { afterEach, describe, expect, it } from "vitest";
import { ffmpegBin, ffprobeBin } from "./tools.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("ffmpeg lookup", () => {
  it("uses PATH by default", () => {
    delete process.env["FFMPEG_PATH"];
    delete process.env["FFPROBE_PATH"];
    expect(ffmpegBin()).toBe("ffmpeg");
    expect(ffprobeBin()).toBe("ffprobe");
  });

  it("honours an explicit override", () => {
    process.env["FFMPEG_PATH"] = "/opt/ff/bin/ffmpeg";
    process.env["FFPROBE_PATH"] = "/somewhere/else/ffprobe";
    expect(ffmpegBin()).toBe("/opt/ff/bin/ffmpeg");
    expect(ffprobeBin()).toBe("/somewhere/else/ffprobe");
  });

  it("finds ffprobe next to an overridden ffmpeg", () => {
    process.env["FFMPEG_PATH"] = "/opt/ff/bin/ffmpeg";
    delete process.env["FFPROBE_PATH"];
    expect(ffprobeBin()).toBe(
      process.platform === "win32" ? "/opt/ff/bin/ffprobe.exe" : "/opt/ff/bin/ffprobe",
    );
  });

  it("treats an empty variable as unset", () => {
    process.env["FFMPEG_PATH"] = "   ";
    expect(ffmpegBin()).toBe("ffmpeg");
  });
});
