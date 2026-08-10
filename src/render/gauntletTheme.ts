import { HEIGHT, WIDTH } from "./theme.js";

/**
 * Layout for the gauntlet. Everything is expressed as a fraction of frame width
 * or height, then scaled here — the reference is 576x1024 and we render
 * 1080x1920, so nothing is copied in raw pixels.
 *
 * **Not all of these fractions come from the reference**, and it matters which
 * do. Measured off it (`refs/README.md`) and used as measured: the palette, the
 * HP widget's total width and stem, the caption's cap height. Chosen here
 * instead: the arena's side (0.92 against the reference's 1.064, which runs the
 * square off both edges of the frame and leaves one wall permanently off
 * screen), its border (0.032 against 0.042), its top edge, the HP crossbar
 * (0.115 against 0.090, so four digits fit), and both ground lines — the
 * reference has no fixed arena position at all, it pans.
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
  // Brighter than plain white damage, so a crit reads on colour alone.
  critText: "#ffe45c",
  ink: "#ffffff",
  vs: "#0f7fa8",
  /** Victory card plate: lighter than the field, never a blackout. */
  cardPlate: "#0d6f97",
  /** Constant plate under the HP digits, and the digits themselves. */
  hpPlate: "#23262b",
  hpDigits: "#ffffff",
} as const;

/** Fractions of frame width or height. See the note above on which are measured. */
const F = {
  arenaSide: 0.92, // square side, of frame width
  arenaTop: 0.295, // of frame height
  border: 0.032, // of frame width
  /**
   * Two ground lines, as shares of the arena's inner height.
   *
   * There is no single floor: the pair is staged in depth, as in the reference.
   * The near fighter stands lower and is drawn larger and on top; the far one
   * stands higher up the arena and smaller. One shared line left the top third
   * of the square empty in every frame.
   */
  groundNear: 0.84,
  groundFar: 0.66,
  hpWidgetWidth: 0.13, // of frame width
  hpStemWidth: 0.036,
  hpBarWidth: 0.115,
  hpBarHeight: 0.052,
  captionCap: 0.033, // of frame height
} as const;

const side = Math.round(WIDTH * F.arenaSide);
const border = Math.round(WIDTH * F.border);
const originX = Math.round((WIDTH - side) / 2);
const originY = Math.round(HEIGHT * F.arenaTop);
const innerSide = side - border * 2;

/**
 * The arena is nailed down, not solved for.
 *
 * It was previously fitted around whoever happened to be fighting, which meant
 * the backdrop moved when the fighters did — the one thing in the shot that
 * should be still. Now it is a square of a fixed size at a fixed place, with a
 * fixed border and a fixed ground line, and the only thing that moves between
 * frames is the camera looking into it (see `gauntletLayout.ts`).
 */
export const ARENA = {
  /** Outer square: side, and where its top-left corner sits on screen. */
  side,
  x: originX,
  y: originY,
  border,
  inner: {
    x: originX + border,
    y: originY + border,
    w: innerSide,
    h: innerSide,
  },
  centre: { x: originX + side / 2, y: originY + side / 2 },
  /** Screen y the near fighter stands on. Constant, inside the arena. */
  groundY: originY + border + Math.round(innerSide * F.groundNear),
  /** Screen y the far fighter stands on — higher up, because it is further off. */
  groundFarY: originY + border + Math.round(innerSide * F.groundFar),
  /** How much larger the near fighter is drawn. Perspective, not importance. */
  nearScale: 1.12,
} as const;

/**
 * Hard floor on a fighter's height, as a share of the frame.
 *
 * **One rule, one constant.** It lives here, next to the arena it is in tension
 * with, because two files need it and neither may own it: `gauntletCamera.ts`
 * solves the zoom against it and `layout.test.ts` asserts it on every frame. It
 * was written down twice — 0.19 in the gate, 0.20 in the camera — with nothing
 * tying them together.
 *
 * Lowered from 22% when the fighters were given positions. Four requirements
 * meet here and the last one has to give: the arena is a fixed 924px square,
 * nothing either fighter draws may cross its wall, the pair travels back and
 * forth, and fighters must stay readable. At the widest moments of a round the
 * camera pulls back to keep the wall guarantee and everything shrinks with it.
 * Measured over 12,067 frames of the shipped path: 20.2% at the worst moment,
 * 29.5% on average, no frame under this floor.
 */
export const MIN_FIGHTER_HEIGHT_SHARE = 0.19;

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

/**
 * HP widgets sit in a fixed band at the top of the arena.
 *
 * Vertically pinned, horizontally free: letting the widget ride the head made
 * it bob and, on a tall fighter, climb out of the arena — but pinning both axes
 * left the viewer working out which plus belonged to whom. So the band is
 * constant and the widget tracks its own fighter along it.
 */
export const HP_WIDGET_SLOTS = {
  y: ARENA.inner.y + Math.round(HEIGHT * 0.004),
} as const;

export const GAUNTLET_LAYOUT = {
  minionSize: Math.round(WIDTH * 0.11),
  /** Overlay stays screen-fixed; see the note in gauntletFrame.ts. */
  panelRight: WIDTH - Math.round(WIDTH * 0.04),
  panelTop: Math.round(HEIGHT * 0.045),
  captionBaseline: HEIGHT - Math.round(HEIGHT * 0.055),
  captionSize: Math.round(HEIGHT * F.captionCap * 1.35),
  progressY: HEIGHT - Math.round(HEIGHT * 0.022),
} as const;
