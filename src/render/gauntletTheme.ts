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
  /**
   * Damage numbers are **yellow**, not white. Sampled off the reference at full
   * resolution: every floating number in it reads about #ffff50. Ours were white
   * with a dark outline, which on the flat blue field is the same colour as the
   * fighters' keylines, the HP plus and the title — the one number a viewer is
   * meant to catch had no colour of its own.
   */
  damageText: "#ffef4d",
  // Hotter still, so a crit reads on colour as well as on size.
  critText: "#fffbc2",
  /**
   * The impact mark at the point of contact, and the "!" over it. Both sampled
   * off the reference, which draws red slashes and an orange exclamation at
   * every blow — the one thing that told a viewer where the damage came from,
   * and the one thing we had nothing of.
   */
  impact: "#e02b1e",
  telegraph: "#ff9d1c",
  ink: "#ffffff",
  vs: "#0f7fa8",
  /** Victory card plate: lighter than the field, never a blackout. */
  cardPlate: "#0d6f97",
  /**
   * HP digits. **There is no plate.**
   *
   * The reference writes the number straight onto the plus — no box, no plate,
   * nothing behind it — and lets it run nearly the full width of the shape. Ours
   * drew a filled rectangle across the whole crossbar and put the digits in
   * that, which hid the plus's arms completely and turned the one white shape
   * above each fighter into a box on a stick. That is the thing the owner has
   * now circled in two separate screenshots.
   *
   * The colour flips with what is behind it, which is what the reference does:
   * grey digits while that part of the plus is still white, near-white once the
   * drain has passed them.
   */
  hpDigitsOnLight: "#8a8a8a",
  hpDigitsOnDark: "#e9ecec",
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
  /**
   * The HP plus, measured off the reference at native resolution by isolating
   * the shape itself — not eyeballed off a scaled crop, which is how this got
   * written down wrong twice.
   *
   * It is **78x78px on a 576x1024 frame: exactly square**, with a stem 31% of
   * the width and an arm 31% of the height. A symmetric plus. It was 140x161
   * here (h/w 1.15, a stretched crucifix), then 160x141 (h/w 0.88, squat) on my
   * own bad measurement. Square is the answer.
   */
  hpWidgetWidth: 0.148, // of frame width
  hpWidgetAspect: 1.0, // height over width — square, measured
  hpStemWidth: 0.31, // of the widget width
  hpBarHeight: 0.31, // of the widget height
  captionCap: 0.033, // of frame height
  /**
   * Where the overlay sits relative to the arena — not relative to the screen.
   *
   * Measured across 721 reference frames: the caption's top edge is 30-32px
   * under the arena's bottom border (spread 2px over the whole video) and the
   * title's top edge is 76-77px above the arena's top border. Both hold while
   * the pair of them slides 200-250px around the frame, which is the proof that
   * the overlay and the arena are one rigid scene.
   */
  titleAboveArena: 76 / 1024, // of frame height
  captionBelowArena: 30 / 1024, // of frame height
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
 * **One rule, one constant** — `gauntletCamera.ts` sizes against it and
 * `layout.test.ts` asserts it, and it was written down twice before.
 *
 * Set from the reference rather than from taste. Measured off a reference frame
 * at 576x1024: the two fighters stand about 230px and 150px tall, which is 22%
 * and 15% of frame height. Ours run 16-20% as the camera breathes. The old floor
 * was 19%, inherited from the format with a fixed arena and two ground lines —
 * the reference itself would fail it.
 */
export const MIN_FIGHTER_HEIGHT_SHARE = 0.15;

const hpWidth = Math.round(WIDTH * F.hpWidgetWidth);
const hpHeight = Math.round(hpWidth * F.hpWidgetAspect);

export const HP_WIDGET = {
  width: hpWidth,
  /** Total height of the plus — **shorter than it is wide**, as in the reference. */
  height: hpHeight,
  stem: Math.round(hpWidth * F.hpStemWidth),
  /** The horizontal arm spans the whole plus, as in the reference. */
  barWidth: hpWidth,
  barHeight: Math.round(hpHeight * F.hpBarHeight),
  /** Above half HP the fill reads white, below it turns red. */
  hurtBelow: 0.5,
} as const;

/** Overlay offsets from the arena, in pixels. See `F.titleAboveArena`. */
export const HUD_OFFSETS = {
  titleAbove: Math.round(HEIGHT * F.titleAboveArena),
  captionBelow: Math.round(HEIGHT * F.captionBelowArena),
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
