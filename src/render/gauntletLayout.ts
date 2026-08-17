import type { GauntletResult } from "../sim/gauntlet.js";
import { FIGHTER_OUTLINE } from "./drawFighter.js";
import { eventsAt, type RenderIndex } from "./frame.js";
import {
  ARENA,
  CAPTION_CAP,
  GAUNTLET_LAYOUT as L,
  HP_WIDGET,
  HP_WIDGET_SLOTS,
  HUD_OFFSETS,
} from "./gauntletTheme.js";
import {
  arenaOnScreen,
  cameraTrack,
  FIGHTER_HEIGHT_UNITS,
  worldToScreen,
  type CameraFrame,
} from "./gauntletCamera.js";
import { minionMotionBounds } from "./silhouette.js";
import { PHOTO_OUTLINE } from "./photo.js";
import { font, HEIGHT, WIDTH, ensureFonts } from "./theme.js";
import type { Canvas } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Where everything goes, computed before anything is drawn.
 *
 * The renderer draws from this and `layout.test.ts` asserts on it, so
 * composition rules — nothing overlapping, nobody clipped, fighters big enough
 * to read — are checked directly rather than inferred from pixels.
 *
 * The arena is not part of that solve. It is a constant (`ARENA`): a fixed
 * square at a fixed place with a fixed border and two fixed ground lines. The
 * only thing that changes between frames is the camera looking into it — a pan
 * and a zoom in the arena's own world coordinates. The height floor
 * (`MIN_FIGHTER_HEIGHT_SHARE`, 19%) is met by zooming the camera in, never by
 * growing the arena or moving its walls.
 *
 * `gauntletFrameLayout` reads the camera track from `gauntletCamera.ts`. There
 * used to be a second solver here, `roundPlacement`, left from the version
 * without movement; it answered the same questions from a static worst case and
 * nothing in the render path called it. It is gone, along with the gate that
 * measured it. Feasibility is now proved where it is felt: the per-frame gate
 * walks real rendered frames of all 36 pairings.
 */

export interface Rect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Camera over the scene.
 *
 * A pure translation in screen pixels: the title, the arena and the caption are
 * one rigid group and the camera slides all of it together. There is no zoom —
 * the reference's arena measures 612-613px tall in all 721 frames.
 */
export interface Camera {
  dx: number;
  dy: number;
}

export interface GauntletFrameLayout {
  /** Scale of the near fighter. Kept for callers that want one number. */
  fighterSize: number;
  /** Per-side scales: the far fighter is drawn smaller. */
  sizeFar: number;
  sizeNear: number;
  /** Screen y each fighter stands on — two lines, staged in depth. */
  groundY: number;
  groundFarY: number;
  /** Always the `ARENA` constant; the gate checks that it stays that way. */
  arena: Rect;
  camera: Camera;
  /** `sprite` is the resting box; `reach` includes room for motion. */
  challenger: { sprite: Rect; reach: Rect; centre: { x: number; y: number }; hp: Rect };
  opponent: { sprite: Rect; reach: Rect; centre: { x: number; y: number }; hp: Rect };
  /** Fixed overlay boxes: challenger name, VS, roster panel, caption. */
  hud: Rect[];
  /** Floating damage numbers currently on screen. */
  damageNumbers: Rect[];
  /** Summons on screen this frame, placed and held inside the arena wall. */
  minions: MinionPlacement[];
}

export interface MinionPlacement {
  /** Which fighter summoned it, so the renderer picks the right sprite. */
  ownerId: string;
  /** Where `drawFighter` is centred. Read this rather than recomputing it. */
  origin: { x: number; y: number };
  /** Everything this summon draws, keyline and health bar included. */
  reach: Rect;
  /** The little health bar under it. */
  bar: Rect;
  hp: number;
  maxHp: number;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The arena as a rect, for gate comparisons. */
export const ARENA_RECT: Rect = {
  name: "arena",
  x: ARENA.x,
  y: ARENA.y,
  w: ARENA.side,
  h: ARENA.side,
};

/** The arena's inner box — the wall nothing may cross. */
export const ARENA_INNER: Rect = {
  name: "arenaInner",
  x: ARENA.inner.x,
  y: ARENA.inner.y,
  w: ARENA.inner.w,
  h: ARENA.inner.h,
};

/** Frames a damage number stays up, matching the renderer. */
export const DAMAGE_NUMBER_FRAMES = 15;

/** Gap kept between the two HP widgets. */
const HP_WIDGET_GAP = Math.round(WIDTH * 0.02);

/**
 * Floor of the band damage numbers may occupy: under the HP widgets, inside the
 * arena. Numbers are clamped into this band, crits included.
 */
export const NUMBER_CEILING = HP_WIDGET_SLOTS.y + HP_WIDGET.height + Math.round(HEIGHT * 0.008);

let measure: Canvas | null = null;
function textWidth(text: string, size: number): number {
  ensureFonts();
  const canvas = (measure ??= createCanvas(8, 8));
  const ctx = canvas.getContext("2d");
  ctx.font = font(size);
  return ctx.measureText(text).width;
}

/**
 * How far the ink rises above the baseline, and how tall it is.
 *
 * The reference's overlay offsets are distances to the **ink** — 76px from the
 * arena's top border to the first pixel of the title, 32px from its bottom
 * border to the first pixel of the caption. Hanging the blocks off a nominal
 * font size instead leaves whatever slack the face happens to carry above its
 * caps, which is how ours ended up 32px too high and 11px too low respectively.
 */
function inkBox(text: string, size: number): { ascent: number; height: number } {
  ensureFonts();
  const canvas = (measure ??= createCanvas(8, 8));
  const ctx = canvas.getContext("2d");
  ctx.font = font(size);
  const m = ctx.measureText(text);
  return { ascent: m.actualBoundingBoxAscent, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
}

/**
 * Font size whose ink is `cap` tall. Solved, because the face is vendored and
 * its caps do not sit where the reference's do.
 *
 * `inkOf` maps a size to the ink height being matched — for the caption that is
 * one line, for the title it is the two-line block from the first line's ascent
 * to the second's descender. Ratio first, then a short scan either side, because
 * rounding to whole pixels leaves the ratio step short of the best answer.
 */
function solveSize(inkOf: (size: number) => number, cap: number, startSize: number): number {
  let size = startSize;
  for (let i = 0; i < 20; i += 1) {
    const ink = inkOf(size);
    if (ink === 0) break;
    const next = Math.max(8, Math.round(size * (cap / ink)));
    if (next === size) break;
    size = next;
  }
  let best = size;
  let bestErr = Math.abs(inkOf(size) - cap);
  for (let s = Math.max(8, size - 4); s <= size + 4; s += 1) {
    const err = Math.abs(inkOf(s) - cap);
    if (err < bestErr) {
      best = s;
      bestErr = err;
    }
  }
  return best;
}

/** Shrinks a font until the text fits, mirroring what the renderer does. */
export function fitText(text: string, startSize: number, maxWidth: number, minSize: number): number {
  let size = startSize;
  while (size > minSize && textWidth(text, size) > maxWidth) size -= 1;
  return size;
}

export interface HudMetrics {
  titleSize: number;
  lineHeight: number;
  captionSize: number;
  /** Scene-space baselines, so the renderer draws exactly where the gate looks. */
  firstBaseline: number;
  secondBaseline: number;
  captionBaseline: number;
  /** The two lines themselves, so the renderer never re-derives them. */
  first: string;
  second: string;
}

/** The reference closes every video on this, so we do too. */
export const CAPTION = "Like and Subscribe!";

/**
 * Ink height of the whole two-line title, as a share of frame height, and the
 * spacing between its baselines. Measured: 67-68px on a 1024-tall frame in both
 * references, on every frame where the title is not clipped.
 */
const TITLE_BLOCK_CAP = 67 / 1024;
const TITLE_LINE_SPACING = 1.18;

/**
 * The overlay: two centred lines above the arena and one below it.
 *
 * That is the *entire* overlay in the reference — "<A> vs" on the first line,
 * "<B>" on the second, and the channel's call to action under the square. The
 * roster panel, the VS mark, the round caption and the progress bar are gone.
 * They were invented here; none of them exists in the format being copied.
 *
 * **Laid out in scene space, not screen space.** These positions are where the
 * overlay sits relative to the arena; `gauntletFrameLayout` then slides the whole
 * group — overlay and arena together — by the camera's translation. The overlay
 * used to be pinned to the screen while the arena panned out from under it, so
 * the two visibly slid against each other. In the reference they never do: the
 * caption holds 30-32px under the arena's bottom border for all 721 frames while
 * both travel a quarter of the frame. See `gauntletCamera.ts`.
 *
 * It follows that the title can be cut in half by the edge of the frame. That is
 * the format, not a defect — it happens constantly in the reference and in both
 * frames the owner sent as the target.
 */
export function hudLayout(result: GauntletResult): { rects: Rect[]; metrics: HudMetrics } {
  const margin = Math.round(WIDTH * 0.04);
  const room = WIDTH - margin * 2;
  const second = result.team.members[0]?.name ?? "";
  const first = `${result.challenger.name} vs`;

  // One size for both lines, so the title reads as a single block, and the
  // block is sized by its own ink: top of the first line to the bottom of the
  // second is 67-68px on a 1024-tall reference frame, in both references.
  // Sizing off a nominal cap instead put ours at 74.
  const blockInk = (size: number): number =>
    Math.round(size * TITLE_LINE_SPACING) + inkBox(first, size).ascent + (inkBox(second, size).height - inkBox(second, size).ascent);
  const wanted = solveSize(blockInk, HEIGHT * TITLE_BLOCK_CAP, Math.round(HEIGHT * 0.034));
  const titleSize = Math.min(
    fitText(first, wanted, room, Math.round(HEIGHT * 0.022)),
    fitText(second, wanted, room, Math.round(HEIGHT * 0.022)),
  );
  const lineHeight = Math.round(titleSize * TITLE_LINE_SPACING);
  // The caption is sized by its ink, not by a nominal cap: the reference's is
  // 22px tall on a 1024-tall frame and the vendored face does not put its caps
  // where the reference's face does.
  const captionSize = solveSize(
    (size) => inkBox(CAPTION, size).height,
    HEIGHT * CAPTION_CAP,
    L.captionSize,
  );

  // Both blocks hang off the arena's own edges at the measured offsets, and the
  // offsets are to the first pixel of ink — see `inkBox`.
  const firstBaseline = ARENA.y - HUD_OFFSETS.titleAbove + inkBox(first, titleSize).ascent;
  const secondBaseline = firstBaseline + lineHeight;
  const captionBaseline =
    ARENA.y + ARENA.side + HUD_OFFSETS.captionBelow + inkBox(CAPTION, captionSize).ascent;

  const line = (name: string, text: string, baseline: number): Rect => ({
    name,
    x: WIDTH / 2 - textWidth(text, titleSize) / 2,
    y: baseline - titleSize,
    w: textWidth(text, titleSize),
    h: titleSize * 1.15,
  });

  return {
    rects: [
      line("titleFirst", first, firstBaseline),
      line("titleSecond", second, secondBaseline),
      {
        name: "caption",
        x: WIDTH / 2 - textWidth(CAPTION, captionSize) / 2,
        y: captionBaseline - captionSize,
        w: textWidth(CAPTION, captionSize),
        h: captionSize * 1.15,
      },
    ],
    metrics: {
      titleSize,
      lineHeight,
      captionSize,
      firstBaseline,
      secondBaseline,
      captionBaseline,
      first,
      second,
    },
  };
}

/** Slides a rect by the camera's scene translation. */
function shifted(rect: Rect, cam: CameraFrame): Rect {
  return { ...rect, x: rect.x + cam.dx, y: rect.y + cam.dy };
}

/** Full layout for one frame. Pure in `(result, frame)`. */
export function gauntletFrameLayout(
  result: GauntletResult,
  frame: number,
  index: RenderIndex,
  hud: { rects: Rect[]; metrics: HudMetrics },
): GauntletFrameLayout {
  const snap = result.snapshots[frame]!;
  const opponent = result.team.members[snap.round] ?? result.team.members[0]!;
  const track = cameraTrack(result);
  const cam = track.frames[frame] ?? track.frames[track.frames.length - 1]!;

  // Position and size both come from the simulation now; the renderer projects.
  // A fighter is a photo, so its box is the photo — there is nothing to solve.
  // The arena no longer scales, so the inner box is a constant and a fighter is
  // the same size in every frame of every video.
  const onScreen = arenaOnScreen(cam);
  const innerPx = ARENA.inner.w;
  const boxFor = (name: string, fighter: { aspect: number }, at: { x: number; y: number }): Rect => {
    const h = FIGHTER_HEIGHT_UNITS * innerPx;
    const w = h * fighter.aspect;
    const centre = worldToScreen(at.x, at.y, cam);
    return { name, x: centre.x - w / 2, y: centre.y - h / 2, w, h };
  };
  const spriteA = boxFor("challengerSprite", result.challenger, snap.challenger);
  const spriteB = boxFor("opponentSprite", opponent, snap.opponent);
  const originAx = spriteA.x + spriteA.w / 2;
  const originBx = spriteB.x + spriteB.w / 2;
  const originAy = spriteA.y + spriteA.h / 2;
  const originBy = spriteB.y + spriteB.h / 2;
  const sizeFar = spriteA.h;
  const sizeNear = spriteB.h;

  // The HP cross rides above its own fighter's head, as in the reference —
  // it used to be pinned in a fixed band at the top of the arena, which left a
  // viewer working out which of two identical plus signs belonged to whom.
  // Scaled with the camera so it stays glued to the figure at any zoom.
  const hpFor = (name: string, box: Rect): Rect => ({
    name,
    x: box.x + box.w / 2 - HP_WIDGET.width / 2,
    y: box.y - HP_WIDGET.height - HP_WIDGET_GAP,
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  });
  const hpA = hpFor("challengerHp", spriteA);
  const hpB = hpFor("opponentHp", spriteB);

  // A photo has no wind-up and no death throw, so the box it draws is the box
  // it claims — grown only by the keyline, which is drawn pixels too.
  const reachOf = (name: string, box: Rect): Rect => ({
    name: `${name}Reach`,
    x: box.x - PHOTO_OUTLINE,
    y: box.y - PHOTO_OUTLINE,
    w: box.w + PHOTO_OUTLINE * 2,
    h: box.h + PHOTO_OUTLINE * 2,
  });

  const damageNumbers = damageNumberRects(result, frame, index, {
    challenger: {
      origin: originAx,
      top: spriteA.y,
      height: spriteA.h,
      width: spriteA.w,
      outward: -1,
    },
    opponent: {
      origin: originBx,
      top: spriteB.y,
      height: spriteB.h,
      width: spriteB.w,
      outward: 1,
    },
  }, [hpA, hpB]);

  const minions = minionPlacements(snap, {
    challenger: { id: snap.challenger.id, spriteId: result.challenger.spriteId, sprite: spriteA, originX: originAx },
    opponent: { id: snap.opponent.id, spriteId: opponent.spriteId, sprite: spriteB, originX: originBx },
    groundY: originBy,
  });

  return {
    fighterSize: sizeNear,
    sizeFar,
    sizeNear,
    groundY: originBy,
    groundFarY: originAy,
    arena: { name: "arena", x: onScreen.x, y: onScreen.y, w: onScreen.side, h: onScreen.side },
    camera: { dx: cam.dx, dy: cam.dy },
    challenger: {
      sprite: spriteA,
      reach: reachOf("challengerSprite", spriteA),
      centre: { x: originAx, y: originAy },
      hp: hpA,
    },
    opponent: {
      sprite: spriteB,
      reach: reachOf("opponentSprite", spriteB),
      centre: { x: originBx, y: originBy },
      hp: hpB,
    },
    // The overlay rides the camera with everything else — see `hudLayout`.
    hud: hud.rects.map((rect) => shifted(rect, cam)),
    damageNumbers,
    minions,
  };
}

/** Height of a summon's health bar, and how far under it sits. */
const MINION_BAR_HEIGHT = 7;
const MINION_BAR_DROP = 0.6;
const MINION_BAR_WIDTH = 0.7;
/** Keyline a summon is drawn with — thinner than a fighter's. */
export const MINION_OUTLINE = Math.round(FIGHTER_OUTLINE * 0.7);

interface MinionSide {
  id: string;
  spriteId: string;
  sprite: Rect;
  originX: number;
}

/**
 * Where the summons stand.
 *
 * They cluster behind their owner, alternating sides and stepping outward. The
 * renderer used to work this out inline, which meant a summon had no rectangle
 * anywhere in the layout and no gate could see where it went. Checked against
 * real pixels, it turns out it never actually crossed the wall — a councillor's
 * summon draws 77px wide inside a 119px box, and the slack covered the formula.
 * That is luck, not a guarantee, and it held only because nothing had changed
 * the art or the spacing.
 *
 * So the placement lives here and is clamped against the same measured envelope
 * the fighters use (`minionMotionBounds`), and the gate checks it every frame of
 * every pairing. The clamp is currently slack on the shipped roster; it exists
 * so that a wider summon, or a bigger step, cannot quietly walk out of the arena.
 *
 * Clamped rather than shrunk: a summon pushed in by a few pixels still reads as
 * standing behind its owner, where a smaller one costs readability everywhere.
 */
export function minionPlacements(
  snap: GauntletResult["snapshots"][number],
  sides: { challenger: MinionSide; opponent: MinionSide; groundY: number },
): MinionPlacement[] {
  if (snap.minions.length === 0) return [];
  const out: MinionPlacement[] = [];
  const size = L.minionSize;
  const left = ARENA.inner.x;
  const right = ARENA.inner.x + ARENA.inner.w;

  for (const side of [sides.challenger, sides.opponent]) {
    const bounds = minionMotionBounds(side.spriteId);
    const mine = snap.minions.filter((m) => m.ownerId === side.id);
    mine.forEach((minion, i) => {
      const away = i % 2 === 0 ? -1 : 1;
      const wanted = side.originX + away * (side.sprite.w * 0.6 + Math.floor(i / 2) * size);

      // Everything this summon draws, relative to its origin: the figure with
      // its keyline, and the health bar, which is narrower but sits lower.
      const drawLeft = Math.min(bounds.left * size - MINION_OUTLINE, (-MINION_BAR_WIDTH / 2) * size);
      const drawRight = Math.max(bounds.right * size + MINION_OUTLINE, (MINION_BAR_WIDTH / 2) * size);
      const originX = Math.max(left - drawLeft, Math.min(wanted, right - drawRight));
      const originY = sides.groundY - size * 0.5;

      const top = originY + bounds.top * size - MINION_OUTLINE;
      const bottom = Math.max(
        originY + bounds.bottom * size + MINION_OUTLINE,
        originY + size * MINION_BAR_DROP + MINION_BAR_HEIGHT,
      );
      out.push({
        ownerId: side.id,
        origin: { x: originX, y: originY },
        reach: {
          name: `minion:${side.id}:${i}`,
          x: originX + drawLeft,
          y: top,
          w: drawRight - drawLeft,
          h: bottom - top,
        },
        bar: {
          name: `minionBar:${side.id}:${i}`,
          x: originX - (size * MINION_BAR_WIDTH) / 2,
          y: originY + size * MINION_BAR_DROP,
          w: size * MINION_BAR_WIDTH,
          h: MINION_BAR_HEIGHT,
        },
        hp: minion.hp,
        maxHp: minion.maxHp,
      });
    });
  }
  return out;
}


export interface DamageNumberAnchors {
  /** `outward` points away from the opponent, so numbers clear the faces. */
  challenger: { origin: number; top: number; height: number; width: number; outward: -1 };
  opponent: { origin: number; top: number; height: number; width: number; outward: 1 };
}

/** Font size per event type. A crit's weight is carried here, not by travel. */
function numberStyle(type: string): { size: number; heavy: boolean } | null {
  switch (type) {
    // Nearly twice the cap height of an ordinary hit — that is the whole tell.
    case "crit":
      return { size: Math.round(WIDTH * 0.1), heavy: true };
    case "hit":
      return { size: Math.round(WIDTH * 0.055), heavy: false };
    case "minion_hit":
    case "aoe":
      return { size: Math.round(WIDTH * 0.043), heavy: false };
    case "heal":
      return { size: Math.round(WIDTH * 0.052), heavy: false };
    case "pickup_claim":
      return { size: Math.round(WIDTH * 0.048), heavy: false };
    default:
      return null;
  }
}

/** Text per event type, shared by the layout and the renderer. */
export function numberText(type: string, value: number | undefined): string {
  if (type === "pickup_claim") return "+BUFF";
  if (type === "heal") return `+${value}`;
  // **No exclamation mark.** A crit used to read "-120!", and nothing in any of
  // the four references ever writes one: every number they show is a bare minus
  // and a figure. It was ours, and at thumbnail size it reads as part of the
  // number.
  return `-${value}`;
}

/**
 * Rects for the numbers floating this frame, matching what the renderer draws.
 *
 * A number stays where the blow landed: it lifts by a few percent of the frame
 * and no more, and the whole rect is clamped into the band between the HP
 * widgets and the arena floor. A crit reads as a crit because it is far bigger
 * and brighter, not because it flies further — travelling further used to walk
 * it up over the arena wall and into the HUD.
 */
export function damageNumberRects(
  result: GauntletResult,
  frame: number,
  index: RenderIndex,
  anchors: DamageNumberAnchors,
  widgets: Rect[] = [],
): Rect[] {
  const out: Rect[] = [];
  // Held to the frame rather than to the arena: the arena moves and is cropped,
  // and a number that follows it off the edge helps nobody.
  const left = 0;
  const right = WIDTH;
  const top = Math.round(HEIGHT * 0.24);
  const bottom = Math.round(HEIGHT * 0.9);

  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      const style = numberStyle(event.type);
      if (!style) continue;
      const text = numberText(event.type, event.value);

      const onChallenger =
        event.type === "pickup_claim" || event.type === "heal"
          ? event.actorId === result.challenger.id
          : event.targetId === result.challenger.id;
      const anchor = onChallenger ? anchors.challenger : anchors.opponent;
      const age = back / DAMAGE_NUMBER_FRAMES;
      // Crits pop on the first frames and settle; ordinary hits barely move.
      const scale = 1 + (style.heavy ? 0.22 : 0.1) * (1 - age);
      const w = textWidth(text, style.size * scale);
      const h = style.size * scale * 1.05;

      const jitter = numberJitter(`${event.frame}:${event.actorId}:${event.type}`, WIDTH * 0.04);
      // Beside the fighter at chest height, pushed to its outer side.
      //
      // It used to sit at shoulder height under a fixed HUD band. The HP cross
      // now rides directly above the head, so a number up there lands on top of
      // it — measured, 242 frames of one video had exactly that collision.
      const rise = age * (HEIGHT * 0.022);
      let x = anchor.origin + anchor.outward * anchor.width * 0.42 + jitter - w / 2;
      let y = anchor.top + anchor.height * 0.45 - h / 2 - rise;

      x = Math.max(left, Math.min(x, right - w));
      y = Math.max(top, Math.min(y, bottom - h));

      // Both crosses ride their own fighter now, so when the two close on each
      // other a number aimed beside one of them can land on the other's widget.
      // Slide it clear rather than letting it sit on the one number a viewer is
      // actually tracking.
      const rect: Rect = { name: `damage:${event.type}@${event.frame}`, x, y, w, h };

      // **Clear of the HP crosses and clear of the other numbers, together.**
      //
      // These were two passes, widgets first and then numbers, and the second
      // one could push a number straight back onto a cross the first had just
      // moved it off — the per-frame gate caught exactly that. One loop, both
      // rules, until the rect is clean or the guard runs out.
      //
      // The numbers have to be pushed at all because a contact damages both
      // fighters on the same frame and the abilities land on top of that, so
      // with the pair close their numbers shared pixels: measured on the shipped
      // cut, "-118" drawn over "-128". The reference never stacks two.
      const step = Math.round(h * 0.85);
      for (let guard = 0; guard < 12; guard += 1) {
        const clash =
          widgets.find((widget) => intersects(rect, widget)) ??
          out.find((other) => intersects(rect, other));
        if (!clash) break;
        const below = clash.y + clash.h + Math.round(HEIGHT * 0.005);
        // Downward while there is room, upward against the floor, so a late
        // number in a crowded frame never walks off the bottom.
        rect.y = below + h <= bottom ? below : Math.max(top, rect.y - step);
      }

      out.push(rect)
    }
  }
  return out;
}

/** Same deterministic jitter the renderer uses. */
export function numberJitter(seed: string, spread: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

export { ARENA };
