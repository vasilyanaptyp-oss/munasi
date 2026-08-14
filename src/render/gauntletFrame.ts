import type { SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { GauntletResult } from "../sim/gauntlet.js";
import {
  DEATH_FRAMES,
  drawFighter,
  RECOVERY_FRAMES,
  WINDUP_FRAMES,
} from "./drawFighter.js";
import { buildRenderIndex, eventsAt, strokedText, type RenderIndex } from "./frame.js";
import type { PlannedFrame } from "./framePlan.js";
import {
  ARENA_RECT,
  CAPTION,
  DAMAGE_NUMBER_FRAMES,
  gauntletFrameLayout,
  hudLayout,
  MINION_OUTLINE,
  numberText,
  victoryCardLayout,
  type GauntletFrameLayout,
  type HudMetrics,
  type Rect,
} from "./gauntletLayout.js";
import { ARENA, GAUNTLET_COLORS as C, GAUNTLET_LAYOUT as L, HP_WIDGET } from "./gauntletTheme.js";
import { drawPhoto } from "./photo.js";
import { drawSignatures } from "./signatures.js";
import { ensureFonts, font, HEIGHT, WIDTH } from "./theme.js";

type Ctx = SKRSContext2D;

const FLASH_FRAMES = 4;

/**
 * The gauntlet frame, following the reference's composition: a flat blue field
 * and a square arena the fighters play inside.
 *
 * The arena is a constant — fixed square, fixed border, fixed ground line — and
 * the camera pans and zooms inside it. It used to be fitted around whoever was
 * fighting, which meant the one element that should hold still moved whenever
 * the pair did.
 *
 * One deliberate departure from the reference: it moves its overlay text *with*
 * the camera, so the roster panel and captions slide off frame (two of the six
 * reference frames have the panel cut in half). Our fighter names are long
 * enough that losing half of one costs the joke, so the overlay is screen-fixed.
 */

/** Traces the plus-shaped HP widget, centred on the origin. */
function plusPath(ctx: Ctx, w: number, h: number, stem: number, barW: number, barH: number): void {
  const halfStem = stem / 2;
  const halfBarW = barW / 2;
  const top = -h / 2;
  const bottom = h / 2;
  // The crossbar sits a little above the middle, as in the reference.
  const barTop = top + h * 0.24;
  const barBottom = barTop + barH;
  void w;

  ctx.beginPath();
  ctx.moveTo(-halfStem, top);
  ctx.lineTo(halfStem, top);
  ctx.lineTo(halfStem, barTop);
  ctx.lineTo(halfBarW, barTop);
  ctx.lineTo(halfBarW, barBottom);
  ctx.lineTo(halfStem, barBottom);
  ctx.lineTo(halfStem, bottom);
  ctx.lineTo(-halfStem, bottom);
  ctx.lineTo(-halfStem, barBottom);
  ctx.lineTo(-halfBarW, barBottom);
  ctx.lineTo(-halfBarW, barTop);
  ctx.lineTo(-halfStem, barTop);
  ctx.closePath();
}

/**
 * HP as a plus sign that fills bottom-up: white while healthy, red once past
 * halfway, with the current HP printed across the bar.
 */
function drawHpWidget(ctx: Ctx, rect: Rect, hp: number, maxHp: number): void {
  const { stem, barWidth, barHeight } = HP_WIDGET;
  const w = rect.w;
  const h = rect.h;
  const share = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

  ctx.save();
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);

  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.fillStyle = C.hpEmpty;
  ctx.fill();

  // Fill from the bottom, clipped to the plus.
  ctx.save();
  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.clip();
  const fillHeight = h * share;
  ctx.fillStyle = share > HP_WIDGET.hurtBelow ? C.hpHealthy : C.hpHurt;
  ctx.fillRect(-w, h / 2 - fillHeight, w * 2, fillHeight);
  ctx.restore();

  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.lineWidth = Math.max(3, Math.round(WIDTH * 0.005));
  ctx.strokeStyle = C.outline;
  ctx.stroke();

  const barTop = -h / 2 + h * 0.24;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.round(barHeight * 0.86);
  const label = String(Math.max(0, Math.round(hp)));
  ctx.font = font(size);
  while (ctx.measureText(label).width > barWidth * 0.86 && size > 12) {
    size -= 1;
    ctx.font = font(size);
  }

  // The digits get a plate of their own rather than taking their colour from
  // how full the widget is. Switching between dark-on-light and light-on-dark
  // works only if the fill is uniform behind the number, and it never is: the
  // fill line crosses the crossbar somewhere around half HP, which put dark
  // digits half on white and half on the empty grey.
  ctx.fillStyle = C.hpPlate;
  ctx.fillRect(-barWidth / 2, barTop, barWidth, barHeight);
  strokedText(ctx, label, 0, barTop + barHeight / 2, size, C.hpDigits, Math.round(size * 0.14));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

/**
 * Renders one widget onto a blank canvas and returns the plate the digits sit
 * on, for the contrast gate.
 *
 * The plate rect is the point of the return value. Measuring contrast over the
 * whole canvas reads the brightest pixel anywhere against the darkest pixel
 * anywhere — and above half HP the widget's own fill is white, so the reading
 * came back at 15:1 no matter what colour the digits were. The gate has to look
 * inside this rectangle and nowhere else.
 */
export function drawHpWidgetForTest(ctx: Ctx, share: number): Rect {
  const rect: Rect = {
    name: "test",
    x: 40,
    y: 40,
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  };
  drawHpWidget(ctx, rect, Math.round(1400 * share), 1400);
  // Mirrors the plate `drawHpWidget` fills, in canvas coordinates.
  return {
    name: "hpDigitPlate",
    x: rect.x + rect.w / 2 - HP_WIDGET.barWidth / 2,
    y: rect.y + rect.h * 0.24,
    w: HP_WIDGET.barWidth,
    h: HP_WIDGET.barHeight,
  };
}

function strikePhase(index: RenderIndex, frame: number, fighterId: string): number | null {
  let best: number | null = null;
  for (let f = frame - RECOVERY_FRAMES; f <= frame + WINDUP_FRAMES; f += 1) {
    if (f < 0) continue;
    const swung = eventsAt(index, f).some(
      (e) => e.actorId === fighterId && (e.type === "hit" || e.type === "crit" || e.type === "minion_hit"),
    );
    if (!swung) continue;
    if (best === null || Math.abs(f - frame) < Math.abs(best - frame)) best = f;
  }
  if (best === null) return null;
  return best > frame ? (frame - best) / WINDUP_FRAMES : (frame - best) / RECOVERY_FRAMES;
}

function visualState(
  index: RenderIndex,
  frame: number,
  fighterId: string,
): { flash: number; hurt: number; strike: number | null; death: number } {
  let flash = 0;
  for (let back = 0; back <= FLASH_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      if (
        event.targetId === fighterId &&
        (event.type === "hit" || event.type === "crit" || event.type === "minion_hit")
      ) {
        flash = Math.max(flash, 0.8 * (1 - back / (FLASH_FRAMES + 1)));
      }
    }
  }
  const died = index.deathFrame.get(fighterId);
  const death = died === undefined || frame < died ? 0 : Math.min(1, (frame - died) / DEATH_FRAMES);
  // The flash curve peaks at 0.8; the recoil rides the same decay at full scale.
  return { flash, hurt: flash / 0.8, strike: strikePhase(index, frame, fighterId), death };
}

/**
 * The whole overlay: two centred title lines above the arena, the caption
 * below. Screen-fixed while the arena slides under the camera.
 */
function drawOverlay(ctx: Ctx, metrics: HudMetrics): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  strokedText(ctx, metrics.first, WIDTH / 2, metrics.firstBaseline, metrics.titleSize, C.ink, 9);
  strokedText(ctx, metrics.second, WIDTH / 2, metrics.secondBaseline, metrics.titleSize, C.ink, 9);
  strokedText(ctx, CAPTION, WIDTH / 2, L.captionBaseline, metrics.captionSize, C.ink, 9);
  ctx.textAlign = "left";
}

function drawDamageNumbers(
  ctx: Ctx,
  index: RenderIndex,
  frame: number,
  layout: GauntletFrameLayout,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rects = layout.damageNumbers;
  let i = 0;
  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      let colour: string;
      switch (event.type) {
        // A crit is louder, not longer-flying: bigger cap height (the layout
        // sets it) and the brightest colour on the frame.
        case "crit":
          colour = C.critText;
          break;
        case "hit":
        case "minion_hit":
        case "aoe":
          colour = C.damageText;
          break;
        case "heal":
        case "pickup_claim":
          colour = C.buffText;
          break;
        default:
          continue;
      }
      // Positions come from the layout, which the gate also reads.
      const rect = rects[i];
      i += 1;
      if (!rect) continue;
      const age = back / DAMAGE_NUMBER_FRAMES;
      ctx.globalAlpha = 1 - age;
      strokedText(
        ctx,
        numberText(event.type, event.value),
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        rect.h / 1.05,
        colour,
        rect.h * (event.type === "crit" ? 0.19 : 0.15),
      );
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Cold-open / cut badge, in the gap between the arena and the caption so it
 * never lands on the HUD or on a fighter.
 */
function drawBadge(ctx: Ctx, text: string, accent: string): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = Math.round(HEIGHT * 0.026);
  ctx.font = font(size);
  const w = ctx.measureText(text).width + size * 1.6;
  const h = size * 1.7;
  const x = WIDTH / 2 - w / 2;
  const y = ARENA_RECT.y + ARENA_RECT.h + Math.round(HEIGHT * 0.03);

  ctx.fillStyle = "rgba(5,18,26,0.82)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, Math.round(WIDTH * 0.008), h);
  strokedText(ctx, text, WIDTH / 2, y + h / 2, size, accent, 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawVictoryBanner(ctx: Ctx, result: GauntletResult): void {
  const card = victoryCardLayout(result);

  // A plate, not a blackout. The old card dimmed the whole frame to 34%
  // brightness, which hid the winner and both HP widgets at the exact moment
  // the viewer wants to read them.
  ctx.fillStyle = C.cardPlate;
  ctx.fillRect(card.plate.x, card.plate.y, card.plate.w, card.plate.h);
  ctx.lineWidth = Math.max(4, Math.round(WIDTH * 0.006));
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(
    card.plate.x + ctx.lineWidth / 2,
    card.plate.y + ctx.lineWidth / 2,
    card.plate.w - ctx.lineWidth,
    card.plate.h - ctx.lineWidth,
  );

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of card.lines) {
    strokedText(
      ctx,
      line.text,
      line.rect.x + line.rect.w / 2,
      line.rect.y + line.rect.h / 2,
      line.size,
      line.accent ? (result.challengerWon ? C.hpHealthy : C.hpHurt) : C.ink,
      Math.round(line.size * 0.16),
    );
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Ring drawn round the winner's HP widget, so the eye lands on the number. */
function markWinner(ctx: Ctx, rect: Rect, won: boolean): void {
  ctx.save();
  ctx.strokeStyle = won ? C.hpHealthy : C.hpHurt;
  ctx.lineWidth = Math.max(4, Math.round(WIDTH * 0.007));
  const pad = Math.round(WIDTH * 0.012);
  ctx.strokeRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);
  ctx.restore();
}

export interface GauntletFrameOptions {
  index?: RenderIndex;
  victoryOverlay?: boolean;
  planned?: PlannedFrame;
  /** Precomputed HUD, so a long render lays it out once. */
  hud?: ReturnType<typeof hudLayout>;
}

/**
 * Renders one gauntlet frame. Pure in `(result, frame)` — the camera, the poses
 * and the floating numbers are all derived from the event list, never from
 * previously rendered frames.
 */
export function renderGauntletFrame(
  result: GauntletResult,
  frame: number,
  options: GauntletFrameOptions = {},
): Buffer {
  ensureFonts();
  const snap = result.snapshots[frame];
  if (!snap) {
    throw new Error(
      `renderGauntletFrame: frame ${frame} is out of range (0..${result.durationFrames - 1})`,
    );
  }
  const index = options.index ?? buildRenderIndex(result);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Flat field, no gradient — measured off the reference.
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const hud = options.hud ?? hudLayout(result);
  const layout = gauntletFrameLayout(result, frame, index, hud);

  // The arena rides the camera: it pans and scales and the frame crops it, which
  // is what the reference does in every single frame.
  const border = ARENA.border * layout.camera.zoom;
  ctx.lineWidth = border;
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(
    layout.arena.x + border / 2,
    layout.arena.y + border / 2,
    layout.arena.w - border,
    layout.arena.h - border,
  );

  const sides = [
    {
      state: snap.challenger,
      fighter: result.challenger,
      place: layout.challenger,
      size: layout.sizeFar,
      facing: 1 as const,
    },
    {
      state: snap.opponent,
      fighter: result.team.members[snap.round] ?? result.team.members[0]!,
      place: layout.opponent,
      size: layout.sizeNear,
      facing: -1 as const,
    },
  ];

  for (const { state, fighter, place, size, facing } of sides) {
    const vis = visualState(index, frame, state.id);

    // Minions cluster behind their owner, on the ground line. Where exactly is
    // the layout's business, not this function's: placing them inline meant
    // nothing held them inside the arena wall and no gate could see that they
    // were not.
    for (const minion of layout.minions) {
      if (minion.ownerId !== state.id) continue;
      ctx.save();
      ctx.translate(minion.origin.x, minion.origin.y);
      drawFighter(ctx, fighter.spriteId, {
        size: L.minionSize,
        facing,
        frame,
        asMinion: true,
        lungeAxis: "x",
        outline: MINION_OUTLINE,
      });
      ctx.restore();
      const share = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(minion.bar.x, minion.bar.y, minion.bar.w, minion.bar.h);
      ctx.fillStyle = C.buffText;
      ctx.fillRect(minion.bar.x, minion.bar.y, minion.bar.w * share, minion.bar.h);
    }

    // A cut-out photo with a white keyline, exactly the reference's treatment.
    // There is no wind-up and no lunge to draw: the figure is a photograph, and
    // what animates is where it is, not what it is doing.
    void size;
    void facing;
    drawPhoto(ctx, fighter.spriteId, {
      x: place.sprite.x + place.sprite.w / 2,
      y: place.sprite.y + place.sprite.h / 2,
      w: place.sprite.w,
      h: place.sprite.h,
      flash: vis.flash,
      ...(vis.death === undefined ? {} : { fade: vis.death * 0.85 }),
    });

    drawHpWidget(ctx, place.hp, state.hp, state.maxHp);
  }

  drawDamageNumbers(ctx, index, frame, layout);

  // Signatures go over the fighters and under the overlay: they are the scene's
  // biggest moment, but the title still has to be readable through one.
  const kindOf = (actorId: string): "magnetic_north" | "nobody_moves" | null => {
    const who =
      actorId === result.challenger.id
        ? result.challenger
        : result.team.members.find((m) => m.id === actorId);
    const ability = who?.abilities.find(
      (a) => a.type === "magnetic_north" || a.type === "nobody_moves",
    );
    return ability ? (ability.type as "magnetic_north" | "nobody_moves") : null;
  };
  drawSignatures(
    ctx,
    result.events,
    frame,
    { x: layout.arena.x, y: layout.arena.y, side: layout.arena.w, border },
    { width: WIDTH, height: HEIGHT },
    kindOf,
  );

  drawOverlay(ctx, hud.metrics);

  const planned = options.planned;
  if (planned?.coldOpenLabel !== undefined) drawBadge(ctx, planned.coldOpenLabel, C.critText);
  if (planned?.startLabel !== undefined) drawBadge(ctx, planned.startLabel, C.hpHealthy);
  if (planned?.flash !== undefined && planned.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, planned.flash).toFixed(3)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (options.victoryOverlay || planned?.victoryOverlay) {
    const winner = result.challengerWon ? layout.challenger : layout.opponent;
    markWinner(ctx, winner.hp, result.challengerWon);
    drawVictoryBanner(ctx, result);
  }

  return canvas.toBuffer("image/png");
}
