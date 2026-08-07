import { HEIGHT, WIDTH } from "./theme.js";

/**
 * Layout for the gauntlet, derived from the reference frames by measurement
 * (see `refs/README.md`). Everything is expressed as a fraction of frame width
 * or height, then scaled here — the reference is 576x1024 and we render
 * 1080x1920, so nothing is copied in raw pixels.
 */

/** Flat fill, no gradient. Measured across four frames at 69-76% of pixels. */
export const GAUNTLET_COLORS = {
  background: "#18a2d3",
  outline: "#000000",
  hpEmpty: "#3c3d3d",
  hpHurt: "#ed1e2a",
  hpHealthy: "#ffffff",
  teamHeading: "#8a0085",
  memberAlive: "#ffffff",
  memberDefeated: "#8b8b8b",
  buffText: "#00b05b",
  damageText: "#ffffff",
  critText: "#ffd23f",
  ink: "#ffffff",
  vs: "#0f7fa8",
} as const;

/** Fractions measured off the reference. */
const F = {
  arenaOuter: 1.064, // of frame width — deliberately wider than the frame
  border: 0.042, // of frame width
  hpWidgetWidth: 0.13, // of frame width
  hpStemWidth: 0.036,
  hpBarWidth: 0.115,
  hpBarHeight: 0.052,
  captionCap: 0.033, // of frame height
} as const;

export const ARENA = {
  outer: Math.round(WIDTH * F.arenaOuter),
  border: Math.round(WIDTH * F.border),
  get inner(): number {
    return this.outer - this.border * 2;
  },
} as const;

export const HP_WIDGET = {
  width: Math.round(WIDTH * F.hpWidgetWidth),
  stem: Math.round(WIDTH * F.hpStemWidth),
  barWidth: Math.round(WIDTH * F.hpBarWidth),
  barHeight: Math.round(WIDTH * F.hpBarHeight),
  /** Total height of the plus, a little taller than it is wide. */
  height: Math.round(WIDTH * F.hpWidgetWidth * 1.15),
  /** Above half HP the fill reads white, below it turns red. */
  hurtBelow: 0.5,
} as const;

export const GAUNTLET_LAYOUT = {
  /** Scene-space centre of the arena. The camera moves relative to this. */
  sceneCentre: { x: WIDTH / 2, y: HEIGHT * 0.52 },
  /** How far apart the two fighters stand, as a share of arena inner width. */
  fighterSpread: 0.26,
  fighterSize: Math.round(WIDTH * 0.3),
  minionSize: Math.round(WIDTH * 0.11),
  /** Overlay stays screen-fixed; see the note in gauntletFrame.ts. */
  titleBaseline: Math.round(HEIGHT * 0.075),
  panelRight: WIDTH - Math.round(WIDTH * 0.04),
  panelTop: Math.round(HEIGHT * 0.045),
  panelLineHeight: Math.round(HEIGHT * 0.038),
  captionBaseline: HEIGHT - Math.round(HEIGHT * 0.055),
  captionSize: Math.round(HEIGHT * F.captionCap * 1.35),
  progressY: HEIGHT - Math.round(HEIGHT * 0.022),
} as const;
