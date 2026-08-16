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
  CAPTION,
  DAMAGE_NUMBER_FRAMES,
  gauntletFrameLayout,
  hudLayout,
  MINION_OUTLINE,
  numberText,
  type GauntletFrameLayout,
  type HudMetrics,
  type Rect,
} from "./gauntletLayout.js";
import { ARENA, GAUNTLET_COLORS as C, GAUNTLET_LAYOUT as L, HP_WIDGET } from "./gauntletTheme.js";
import { drawPhoto } from "./photo.js";
import { drawSignatures, SIGNATURE_KINDS, type SignatureKind } from "./signatures.js";
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

/**
 * Traces the plus-shaped HP widget, centred on the origin.
 *
 * The proportions are the reference's, measured at full resolution: 85x75px on a
 * 576-wide frame, so the plus is **wider than it is tall**, with a stem a third
 * of its width and an arm that spans the full width. Ours was 140x161 — taller
 * than wide — which is why it read as a stretched crucifix instead.
 */
function plusPath(ctx: Ctx, w: number, h: number, stem: number, barW: number, barH: number): void {
  const halfStem = stem / 2;
  const halfBarW = barW / 2;
  const top = -h / 2;
  const bottom = h / 2;
  // The arm is **centred**. Measured across the reference's frames: 33-36% of
  // the shape above the arm and 36-38% below it, on every plus in every frame.
  // It sat at 24% above and 45% below here, and a long bottom leg is exactly
  // what makes a plus read as a crucifix.
  const barTop = top + (h - barH) / 2;
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
 * HP as a plus that drains from the top: white while healthy, the empty part
 * dark grey, with the number written straight onto it.
 *
 * All of this is the reference's, isolated from its frames at native
 * resolution:
 *
 * - the plus is white and the drained part is dark grey. **There is no red.**
 *   Ours turned red under half HP, which is invented;
 * - the number sits **directly on the plus** and runs nearly its full width.
 *   There is no plate, no box, nothing behind it. Ours filled a rectangle across
 *   the whole crossbar, which covered the plus's arms and left a box on a stick;
 * - the digits are grey where the plus is still white and near-white where the
 *   drain has reached them.
 *
 * The plate existed to dodge one real problem: the fill line crosses the arm
 * around half HP, so a single digit colour is wrong for part of that band. It is
 * handled the way it has to be handled without a plate — the colour is chosen
 * from the fill at the arm, and the digits carry a thin keyline in the opposite
 * tone so they still read while the line is passing through them.
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
  ctx.fillStyle = C.hpHealthy;
  ctx.fillRect(-w, h / 2 - fillHeight, w * 2, fillHeight);
  ctx.restore();

  // A hairline. Measured on the reference: 1px on a 78px plus — 1.3% of its
  // width. Ours was 5px on a 160px plus, nearly three times heavier in
  // proportion, and a thick black edge is most of what made the shape look
  // clumsy next to the reference's.
  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.lineWidth = Math.max(2, Math.round(w * 0.02));
  ctx.strokeStyle = C.outline;
  ctx.stroke();

  const barTop = -h / 2 + (h - barHeight) / 2;
  const barMiddle = barTop + barHeight / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Sized against the whole plus, not the arm: in the reference the number is
  // as wide as the shape and overhangs the arm on both sides.
  //
  // **Regular weight, not bold.** Every other piece of text in this format is
  // heavy — the title, the caption, the damage numbers — and the HP number is
  // the one that is not: in the reference it is a thin, wide-set grey figure
  // sitting quietly on the plus. Ours was the same bold face as the title and
  // read as a blunt slab.
  // Measured off the reference's own digits: a two-digit number inks 32% of the
  // plus's width at a cap height 26% of its height, so a four-digit one lands
  // near 70% of the width with clear air either side. Ours ran to 86% and
  // crowded the arm edge to edge. The width bound is the one that bites — the
  // vendored face is wider per digit than the reference's, and given the choice
  // between matching its cap height and matching its fit, the fit is what reads
  // as tidy.
  let size = Math.round(h * 0.3);
  const label = String(Math.max(0, Math.round(hp)));
  ctx.font = font(size, "normal");
  while (ctx.measureText(label).width > w * 0.72 && size > 12) {
    size -= 1;
    ctx.font = font(size, "normal");
  }

  // Is the drain past the digits yet? The fill grows from the bottom, so the
  // arm's middle is white while `h/2 - fillHeight` is above it.
  const onWhite = h / 2 - fillHeight < barMiddle;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  // The halo is the *background's* colour, not a dark keyline: it is invisible
  // while the number sits on one uniform tone and only does anything in the band
  // where the drain line runs through the digits. Thin, because at the old
  // weight it thickened the glyphs into the slab this is meant to undo.
  ctx.lineWidth = Math.max(2, Math.round(size * 0.05));
  ctx.strokeStyle = onWhite ? "#ffffff" : C.hpEmpty;
  ctx.strokeText(label, 0, barMiddle);
  ctx.fillStyle = onWhite ? C.hpDigitsOnLight : C.hpDigitsOnDark;
  ctx.fillText(label, 0, barMiddle);
  ctx.restore();

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
  // The arm the digits are written on. There is no plate any more — the number
  // goes straight onto the plus — so the gate reads the band the digits occupy.
  return {
    name: "hpDigitBand",
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
 * The whole overlay: two centred title lines above the arena, the caption below.
 *
 * **It rides the camera along with the arena**, because in the reference the two
 * are one rigid scene — measured over 721 frames, the caption holds 30-32px under
 * the arena's bottom border while the pair of them travels a quarter of the frame.
 * This used to be screen-fixed, so the arena visibly slid out from under the
 * title. A consequence, and the correct one: the title can now be cut in half by
 * the edge of the frame, exactly as it is in the reference.
 */
function drawOverlay(ctx: Ctx, metrics: HudMetrics, cam: { dx: number; dy: number }): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const x = WIDTH / 2 + cam.dx;
  strokedText(ctx, metrics.first, x, metrics.firstBaseline + cam.dy, metrics.titleSize, C.ink, 9);
  strokedText(ctx, metrics.second, x, metrics.secondBaseline + cam.dy, metrics.titleSize, C.ink, 9);
  strokedText(ctx, CAPTION, x, metrics.captionBaseline + cam.dy, metrics.captionSize, C.ink, 9);
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

  // The arena rides the camera: it slides and the frame crops it, which is what
  // the reference does in every single frame. It does not scale — measured, the
  // reference's arena is 612-613px tall in all 721 of them.
  const border = ARENA.border;
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
      // **The loser goes, he does not turn into a ghost.** The reference's last
      // frames have one fighter in the arena and nothing where the other was;
      // ours held the beaten man at 15% opacity for the rest of the video, a
      // pale figure standing under a plus reading 0. Fading all the way out is
      // both the reference's behaviour and the readable one.
      ...(vis.death === undefined ? {} : { fade: vis.death }),
    });

    // The plus goes with its fighter. Left drawing, it hung on as a dark plus
    // reading 0 over an empty patch of arena for the rest of the video — the
    // widget belongs to a figure that is no longer there.
    if (vis.death < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - vis.death;
      drawHpWidget(ctx, place.hp, state.hp, state.maxHp);
      ctx.restore();
    }
  }

  // **No drawn impact mark.** It was three yellow slashes at the point of
  // contact — illustration, like the ability effects that went with it. What
  // marks a blow now is what marks it in the reference: the victim flashes to a
  // solid white silhouette and a yellow number climbs off him.

  // Signatures go over the fighters and under the overlay: they are the scene's
  // biggest moment, but the title still has to be readable through one.
  // Straight off the event: a fighter can carry more than one signature — the
  // glasses man has his throw and his volley — and looking it up by owner and
  // taking the first drew his ult every time he threw a single pair.
  const kindOf = (event: { ability?: string }): SignatureKind | null =>
    event.ability !== undefined && SIGNATURE_KINDS.has(event.ability as never)
      ? (event.ability as SignatureKind)
      : null;
  // Both ends of the effect come from this frame's layout, so it stays attached
  // to two fighters who are still moving.
  const positionOf = (id: string): { x: number; y: number } | null => {
    if (id === snap.challenger.id) return layout.challenger.centre;
    if (id === snap.opponent.id) return layout.opponent.centre;
    return null;
  };
  drawSignatures(
    ctx,
    result.events,
    frame,
    { x: layout.arena.x, y: layout.arena.y, side: layout.arena.w, border },
    kindOf,
    positionOf,
    layout.opponent.sprite.h,
  );

  // **The numbers go on top of the effects.** They are the readout the whole
  // fight is followed by, and an ability that buries its own number under a
  // shockwave has undone the thing it was drawn to explain.
  drawDamageNumbers(ctx, index, frame, layout);

  drawOverlay(ctx, hud.metrics, layout.camera);

  // **The overlay is the title and the caption. That is all of it.**
  //
  // What used to be here as well, and is not in any of the four references:
  // a closing card reading "<winner> WINS / 25 HP LEFT" on a plate, a white
  // rectangle drawn round the winner's plus, and two badges for the cold open.
  // On the frames the owner compared they were the whole bottom of the shot —
  // the card's second line was cut in half by the frame edge, and the ring
  // round the plus, which by then had drifted above the arena wall, read as a
  // selection box someone had left on. The reference ends the way it runs: the
  // loser is gone, the winner is still bouncing, nothing else appears.
  const planned = options.planned;
  if (planned?.flash !== undefined && planned.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, planned.flash).toFixed(3)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  return canvas.toBuffer("image/png");
}
