import { existsSync } from "node:fs";
import { join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { assetDir } from "../util/paths.js";

export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Layout anchors, top to bottom. */
export const LAYOUT = {
  titleBaseline: 150,
  a: { barY: 290, spriteY: 660, floorY: 880 },
  divider: 1000,
  b: { barY: 1150, spriteY: 1500, floorY: 1720 },
  progressY: HEIGHT - 46,
  centerX: WIDTH / 2,
  spriteSize: 400,
  minionSize: 118,
  barWidth: 760,
  barHeight: 46,
} as const;

export const COLORS = {
  bgTop: "#0d1220",
  bgBottom: "#171226",
  arenaGlowA: "#2a3a63",
  arenaGlowB: "#4a2440",
  ink: "#f5f7ff",
  inkDim: "#9aa5bd",
  outline: "#05070d",
  hpFillA: "#4fd1ff",
  hpFillB: "#ff7a59",
  hpTrack: "#1b2233",
  hpGhost: "#ffffff",
  crit: "#ffd23f",
  heal: "#6ee7a8",
  aoe: "#ff8a5b",
  minionDamage: "#cbd5e6",
  accent: "#ffd23f",
} as const;

const FONT_ALIAS = "MunasiSans";

let fontsReady = false;

/**
 * Registers the vendored DejaVu faces. Text metrics are part of the frame
 * bytes, so shipping the font is what keeps output identical across machines
 * rather than depending on whatever fontconfig happens to serve.
 */
export function ensureFonts(): void {
  if (fontsReady) return;
  const dir = assetDir("fonts");
  for (const file of ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"]) {
    const path = join(dir, file);
    if (existsSync(path)) GlobalFonts.registerFromPath(path, FONT_ALIAS);
  }
  fontsReady = true;
}

/** CSS font shorthand using the registered face, with system fallbacks. */
export function font(size: number, weight: "bold" | "normal" = "bold"): string {
  return `${weight} ${size}px "${FONT_ALIAS}", "DejaVu Sans", "Liberation Sans", sans-serif`;
}
