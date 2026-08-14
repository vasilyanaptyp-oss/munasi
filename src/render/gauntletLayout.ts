import type { GauntletResult } from "../sim/gauntlet.js";
import { FIGHTER_OUTLINE } from "./drawFighter.js";
import { eventsAt, type RenderIndex } from "./frame.js";
import {
  ARENA,
  GAUNTLET_LAYOUT as L,
  HP_WIDGET,
  HP_WIDGET_SLOTS,
} from "./gauntletTheme.js";
import { cameraTrack, FIGHTER_HEIGHT_PX, worldToScreen } from "./gauntletCamera.js";
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
 * Camera over arena world space.
 *
 * World origin is the arena's centre on the x axis and the ground line on the
 * y axis, so a fighter stands at world y 0. One world unit is one screen pixel
 * at zoom 1.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
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

/** Breathing room inside the arena walls, where the pair has to stay. */
const ARENA_PAD = Math.round(WIDTH * 0.01);
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

/** Shrinks a font until the text fits, mirroring what the renderer does. */
export function fitText(text: string, startSize: number, maxWidth: number, minSize: number): number {
  let size = startSize;
  while (size > minSize && textWidth(text, size) > maxWidth) size -= 1;
  return size;
}

export interface HudMetrics {
  challengerNameSize: number;
  vsSize: number;
  panelSize: number;
  panelLineHeight: number;
  captionSize: number;
  /** Baselines and top edge, so the renderer draws exactly where the gate looks. */
  nameBaseline: number;
  vsBaseline: number;
  panelTop: number;
}

/**
 * The overlay is laid out once per run, not per frame: it is a fixed HUD, and
 * anything that moves under it is scene, not chrome.
 */
export function hudLayout(result: GauntletResult): { rects: Rect[]; metrics: HudMetrics } {
  const left = Math.round(WIDTH * 0.03);
  const top = L.panelTop;

  // The challenger's name gets its own full-width line.
  //
  // It used to share the band with the roster panel, which left it 36% of the
  // frame and shrank "САНТЕХНИК ЖЭКА" to 35px — 1.8% of frame height, unreadable
  // at thumbnail size, and frame 0 is the thumbnail. Stacking the three blocks
  // costs vertical room the header had spare.
  const nameSize = fitText(
    result.challenger.name,
    Math.round(HEIGHT * 0.034),
    WIDTH - left * 2,
    Math.round(HEIGHT * 0.022),
  );
  const vsSize = Math.round(HEIGHT * 0.034);
  const longest = result.team.members.reduce((a, b) => (a.name.length >= b.name.length ? a : b)).name;
  const panelSize = fitText(
    longest,
    Math.round(HEIGHT * 0.025),
    WIDTH - left * 2,
    Math.round(HEIGHT * 0.019),
  );
  const panelLineHeight = Math.round(panelSize * 1.34);
  const captionSize = L.captionSize;

  const nameBaseline = top + nameSize;
  const vsBaseline = nameBaseline + Math.round(vsSize * 1.2);
  const panelTop = vsBaseline + Math.round(HEIGHT * 0.014);

  const header: Rect[] = [
    {
      name: "challengerName",
      x: left,
      y: nameBaseline - nameSize,
      w: textWidth(result.challenger.name, nameSize),
      h: nameSize * 1.15,
    },
    {
      name: "vs",
      x: left,
      y: vsBaseline - vsSize,
      w: textWidth("VS", vsSize),
      h: vsSize * 1.15,
    },
  ];

  // Panel is right-aligned; its box spans the widest line it holds.
  const panelWidth = Math.max(
    textWidth(result.team.name, Math.round(panelSize * 1.1)),
    ...result.team.members.map((m) => textWidth(m.name, panelSize)),
  );
  const panelHeight = panelLineHeight * (result.team.members.length + 1) + panelSize * 0.4;
  const panel: Rect = {
    name: "teamPanel",
    x: L.panelRight - panelWidth,
    y: panelTop,
    w: panelWidth,
    h: panelHeight,
  };

  const caption: Rect = {
    name: "caption",
    x: WIDTH / 2 - textWidth("РАУНД 3/3", captionSize) / 2,
    y: L.captionBaseline - captionSize,
    w: textWidth("РАУНД 3/3", captionSize),
    h: captionSize * 1.15,
  };

  return {
    rects: [...header, panel, caption],
    metrics: {
      challengerNameSize: nameSize,
      vsSize,
      panelSize,
      panelLineHeight,
      captionSize,
      nameBaseline,
      vsBaseline,
      panelTop,
    },
  };
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
  const boxFor = (name: string, fighter: { aspect: number }, at: { x: number; y: number }): Rect => {
    const h = FIGHTER_HEIGHT_PX * cam.zoom;
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

  // Pinned vertically to the arena's top band, tracking its own fighter along
  // it so it stays readable as *whose* health it is.
  const hpFor = (name: string, centreX: number): Rect => ({
    name,
    x: Math.max(
      ARENA.inner.x + ARENA_PAD,
      Math.min(
        centreX - HP_WIDGET.width / 2,
        ARENA.inner.x + ARENA.inner.w - ARENA_PAD - HP_WIDGET.width,
      ),
    ),
    y: HP_WIDGET_SLOTS.y,
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  });
  let hpA = hpFor("challengerHp", originAx);
  let hpB = hpFor("opponentHp", originBx);
  const clash = hpA.x + HP_WIDGET.width + HP_WIDGET_GAP - hpB.x;
  if (clash > 0) {
    hpA = hpFor("challengerHp", originAx - clash / 2);
    hpB = hpFor("opponentHp", originBx + clash / 2);
  }

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
  });

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
    arena: { ...ARENA_RECT },
    camera: { x: cam.x, y: cam.y, zoom: cam.zoom },
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
    hud: hud.rects,
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

export interface VictoryCard {
  /** Plate behind the text. */
  plate: Rect;
  lines: { name: string; text: string; rect: Rect; size: number; accent: boolean }[];
  /** Which side won, so the renderer can mark the right widget. */
  winner: "challenger" | "opponent";
  /** HP the winner finished on. The whole point of the card. */
  hpLeft: number;
}

/**
 * The closing card.
 *
 * It replaced a full-frame dark scrim with an unfitted name that ran off both
 * edges of a 1080px frame, held for two seconds, over two HP widgets that both
 * looked like zero. The number that matters is what the winner had left —
 * "cleared it on 8 HP" is the entire drama of a gauntlet — so it gets its own
 * line, and the card is a plate inside the arena rather than a blackout.
 */
export function victoryCardLayout(result: GauntletResult): VictoryCard {
  const won = result.challengerWon;
  const last = result.snapshots[result.durationFrames - 1]!;
  const hpLeft = Math.max(0, Math.round(won ? last.challenger.hp : last.opponent.hp));
  const name = won ? result.challenger.name : (result.rounds.at(-1)?.opponentName ?? "");

  // The card lives in the band under the arena — the strip the round caption
  // already occupies. Over the arena it covered the winner from the chest down,
  // which defeated the point of keeping them in shot.
  const pad = Math.round(WIDTH * 0.02);
  const room = WIDTH - Math.round(WIDTH * 0.03) * 2 - pad * 2;

  // Both sides can hit zero on the same tick — damage is applied after every
  // actor has swung, so a mutual kill is a real outcome, not a rounding
  // artefact. "ОСТАЛОСЬ 0 HP" is true there and reads as a broken card, so that
  // case gets its own line.
  const trade = hpLeft <= 0;
  const headlineSize = Math.round(WIDTH * 0.036);
  const nameSize = fitText(name, Math.round(WIDTH * 0.062), room, Math.round(WIDTH * 0.03));
  const hpText = trade ? "РАЗМЕН — УПАЛИ ОБА" : `ОСТАЛОСЬ ${hpLeft} HP`;
  const hpSize = fitText(hpText, Math.round(WIDTH * 0.048), room, Math.round(WIDTH * 0.026));

  const headline = trade ? "ДОБИЛ И УПАЛ" : won ? "ПРОШЁЛ ВСЕХ" : "НЕ СПРАВИЛСЯ";
  const sizes = [headlineSize, nameSize, hpSize];
  const texts = [headline, name, hpText];
  const names = ["victoryHeadline", "victoryName", "victoryHp"];
  const gap = Math.round(HEIGHT * 0.005);
  const bodyHeight = sizes.reduce((sum, size) => sum + size * 1.2, 0) + gap * (sizes.length - 1);

  // Under the arena, never over it. The strip between the arena's bottom edge
  // and the progress bar is already empty and already meant for text.
  const plateHeight = bodyHeight + pad * 2;
  const bandTop = ARENA.y + ARENA.side;
  const bandBottom = L.progressY - Math.round(HEIGHT * 0.008);
  const plate: Rect = {
    name: "victoryPlate",
    x: Math.round(WIDTH * 0.03),
    y: Math.round(bandTop + (bandBottom - bandTop - plateHeight) / 2),
    w: WIDTH - Math.round(WIDTH * 0.03) * 2,
    h: plateHeight,
  };

  let y = plate.y + pad;
  const lines = texts.map((text, i) => {
    const size = sizes[i]!;
    const w = textWidth(text, size);
    const rect: Rect = {
      name: names[i]!,
      x: WIDTH / 2 - w / 2,
      y,
      w,
      h: size * 1.2,
    };
    y += size * 1.2 + gap;
    return { name: names[i]!, text, rect, size, accent: i === 2 };
  });

  return { plate, lines, winner: won ? "challenger" : "opponent", hpLeft };
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
  if (type === "pickup_claim") return "+БАФ";
  if (type === "heal") return `+${value}`;
  if (type === "crit") return `-${value}!`;
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
): Rect[] {
  const out: Rect[] = [];
  const left = ARENA.inner.x;
  const right = ARENA.inner.x + ARENA.inner.w;
  const bottom = ARENA.inner.y + ARENA.inner.h;

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
      // Anchored on the upper body, where the blow landed. The lift is short.
      const rise = age * (HEIGHT * 0.022);
      // Shoulder height, pushed to the fighter's outer side: the number sits
      // on the blow without covering the face it landed on.
      let x = anchor.origin + anchor.outward * anchor.width * 0.34 + jitter - w / 2;
      let y = anchor.top + anchor.height * 0.16 - h / 2 - rise;

      x = Math.max(left, Math.min(x, right - w));
      y = Math.max(NUMBER_CEILING, Math.min(y, bottom - h));

      out.push({ name: `damage:${event.type}@${event.frame}`, x, y, w, h });
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
