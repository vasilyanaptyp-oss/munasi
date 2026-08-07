import type { SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { GauntletResult, GauntletSnapshot } from "../sim/gauntlet.js";
import type { PickupType } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { DEATH_FRAMES, drawFighter, RECOVERY_FRAMES, WINDUP_FRAMES } from "./drawFighter.js";
import {
  buildRenderIndex,
  eventsAt,
  jitter,
  strokedText,
  type RenderIndex,
} from "./frame.js";
import type { PlannedFrame } from "./framePlan.js";
import { ARENA, GAUNTLET_COLORS as C, GAUNTLET_LAYOUT as L, HP_WIDGET } from "./gauntletTheme.js";
import { ensureFonts, font, HEIGHT, WIDTH } from "./theme.js";

type Ctx = SKRSContext2D;

const DAMAGE_NUMBER_FRAMES = Math.round(FPS * 0.5);
const FLASH_FRAMES = 4;
const SHAKE_FRAMES = 8;

/**
 * The gauntlet frame, following the reference's composition: a flat blue field,
 * a square arena wider than the frame, and a camera that pans over it.
 *
 * One deliberate departure: the reference moves its overlay text *with* the
 * camera, so the roster panel and captions slide off frame (two of the six
 * reference frames have the panel cut in half). Our fighter names are long
 * enough that losing half of one costs the joke, so the overlay is screen-fixed
 * and only the arena and its occupants move.
 */

/** Where a fighter stands in scene space. */
function fighterPosition(side: "challenger" | "opponent"): { x: number; y: number } {
  const spread = ARENA.inner * L.fighterSpread;
  return {
    x: L.sceneCentre.x + (side === "challenger" ? -spread : spread),
    y: L.sceneCentre.y + ARENA.inner * 0.16,
  };
}

/**
 * Camera offset for a frame. Pure: it reads the event list, never previous
 * frames, so workers can render any stripe and get identical bytes.
 */
export function cameraOffset(
  index: RenderIndex,
  frame: number,
  result: GauntletResult,
): { x: number; y: number } {
  // Drift keeps the shot alive even when nothing is happening.
  let x = Math.sin(frame * 0.013) * (WIDTH * 0.035);
  let y = Math.cos(frame * 0.0171) * (HEIGHT * 0.018);

  // Lean toward whoever was hit most recently, easing off over half a second.
  const challengerId = result.challenger.id;
  const FOLLOW_FRAMES = 16;
  for (let back = 0; back <= FOLLOW_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    const hit = eventsAt(index, f).find(
      (e) => e.type === "hit" || e.type === "crit" || e.type === "aoe",
    );
    if (!hit) continue;
    const towardChallenger = hit.targetId === challengerId;
    const weight = (1 - back / (FOLLOW_FRAMES + 1)) * 0.55;
    const target = fighterPosition(towardChallenger ? "challenger" : "opponent");
    x += (target.x - L.sceneCentre.x) * weight;
    break;
  }

  // Crits and deaths kick the camera.
  for (let back = 0; back <= SHAKE_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    const punch = eventsAt(index, f).find((e) => e.type === "crit" || e.type === "death");
    if (!punch) continue;
    const amp = (punch.type === "death" ? 40 : 24) * (1 - back / (SHAKE_FRAMES + 1));
    x += Math.sin(frame * 2.7) * amp;
    y += Math.cos(frame * 3.1) * amp * 0.6;
    break;
  }
  return { x, y };
}

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
function drawHpWidget(ctx: Ctx, x: number, y: number, hp: number, maxHp: number): void {
  const { width: w, height: h, stem, barWidth, barHeight } = HP_WIDGET;
  const share = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

  ctx.save();
  ctx.translate(x, y);

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
  // Dark digits on the light fill, light digits once the widget goes dark.
  const onLight = share > HP_WIDGET.hurtBelow;
  strokedText(
    ctx,
    label,
    0,
    barTop + barHeight / 2,
    size,
    onLight ? "#3c3d3d" : "#e8ecf2",
    onLight ? 0 : 5,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

const PICKUP_LABEL: Record<PickupType, string> = {
  heal: "+HP",
  damage_buff: "+УРОН",
  attack_speed: "+СКОР",
};
const PICKUP_COLOR: Record<PickupType, string> = {
  heal: C.buffText,
  damage_buff: C.critText,
  attack_speed: C.hpHealthy,
};

/** The item on the floor: a disc that pulses until someone reaches it. */
function drawPickup(ctx: Ctx, snap: GauntletSnapshot): void {
  const pickup = snap.pickup;
  if (!pickup) return;
  const age = snap.frame - pickup.spawnFrame;
  const pulse = 1 + Math.sin(age * 0.25) * 0.08;
  const x = L.sceneCentre.x;
  const y = L.sceneCentre.y - ARENA.inner * 0.2;
  const r = WIDTH * 0.045 * pulse;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = PICKUP_COLOR[pickup.type];
  ctx.fill();
  ctx.lineWidth = Math.max(3, Math.round(WIDTH * 0.006));
  ctx.strokeStyle = C.outline;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  strokedText(ctx, PICKUP_LABEL[pickup.type], x, y + r + WIDTH * 0.04, Math.round(WIDTH * 0.032), PICKUP_COLOR[pickup.type], 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
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
): { flash: number; strike: number | null; death: number } {
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
  return { flash, strike: strikePhase(index, frame, fighterId), death };
}

/** Team panel, top right: heading, then members with the active one marked. */
function drawRosterPanel(ctx: Ctx, result: GauntletResult, snap: GauntletSnapshot): void {
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const x = L.panelRight;
  let y = L.panelTop + L.panelLineHeight;

  // The panel owns the right half; names shrink rather than reach across it.
  const maxWidth = WIDTH * 0.47;
  let size = Math.round(HEIGHT * 0.028);
  const longest = result.team.members.reduce((a, b) => (a.name.length >= b.name.length ? a : b)).name;
  ctx.font = font(size);
  while (ctx.measureText(longest).width > maxWidth && size > 18) {
    size -= 1;
    ctx.font = font(size);
  }
  const lineHeight = Math.round(size * 1.34);

  strokedText(ctx, result.team.name, x, y, Math.round(size * 1.1), C.teamHeading, 8);
  y += lineHeight;

  result.team.members.forEach((member, i) => {
    const defeated = i < snap.round;
    const active = i === snap.round;
    const colour = defeated ? C.memberDefeated : C.memberAlive;
    strokedText(ctx, member.name, x, y, size, colour, 8);

    if (active) {
      // Pointer sits to the left of the name, like the reference's triangle.
      ctx.font = font(size);
      const width = ctx.measureText(member.name).width;
      const px = x - width - Math.round(WIDTH * 0.03);
      ctx.beginPath();
      ctx.moveTo(px, y - size * 0.62);
      ctx.lineTo(px + size * 0.55, y - size * 0.32);
      ctx.lineTo(px, y - size * 0.02);
      ctx.closePath();
      ctx.fillStyle = C.teamHeading;
      ctx.fill();
    }
    y += lineHeight;
  });
  ctx.textAlign = "left";
}

/** Challenger's name and the VS mark, left of the panel. */
function drawChallengerLabel(ctx: Ctx, name: string): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const maxWidth = WIDTH * 0.36;
  let size = Math.round(HEIGHT * 0.030);
  ctx.font = font(size);
  while (ctx.measureText(name).width > maxWidth && size > 18) {
    size -= 1;
    ctx.font = font(size);
  }
  // Sits against the middle of the roster block, not across its first line.
  const y = L.panelTop + Math.round(HEIGHT * 0.052);
  strokedText(ctx, name, Math.round(WIDTH * 0.035), y, size, C.ink, 8);

  // VS sits under the challenger's name, so the panel keeps the right half
  // to itself no matter how long either side's names run.
  const vsSize = Math.round(HEIGHT * 0.038);
  strokedText(ctx, "VS", Math.round(WIDTH * 0.035), y + vsSize * 1.15, vsSize, C.vs, 9);
}

function drawDamageNumbers(
  ctx: Ctx,
  index: RenderIndex,
  frame: number,
  result: GauntletResult,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      let text: string;
      let colour: string;
      let size: number;
      switch (event.type) {
        case "crit":
          text = `-${event.value}!`;
          colour = C.critText;
          size = Math.round(WIDTH * 0.085);
          break;
        case "hit":
          text = `-${event.value}`;
          colour = C.damageText;
          size = Math.round(WIDTH * 0.058);
          break;
        case "minion_hit":
        case "aoe":
          text = `-${event.value}`;
          colour = C.damageText;
          size = Math.round(WIDTH * 0.045);
          break;
        case "heal":
          text = `+${event.value}`;
          colour = C.buffText;
          size = Math.round(WIDTH * 0.055);
          break;
        case "pickup_claim":
          text = "+БАФ";
          colour = C.buffText;
          size = Math.round(WIDTH * 0.05);
          break;
        default:
          continue;
      }

      const onChallenger =
        event.type === "pickup_claim" || event.type === "heal"
          ? event.actorId === result.challenger.id
          : event.targetId === result.challenger.id;
      const anchor = fighterPosition(onChallenger ? "challenger" : "opponent");
      const age = back / DAMAGE_NUMBER_FRAMES;
      const x = anchor.x + jitter(`${event.frame}:${event.actorId}:${event.type}`, WIDTH * 0.07);
      const y = anchor.y - L.fighterSize * 0.78 - HP_WIDGET.height * 0.9 - age * (HEIGHT * 0.07);
      ctx.globalAlpha = 1 - age;
      strokedText(ctx, text, x, y, size * (1 + 0.12 * (1 - age)), colour, size * 0.16);
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawVictoryBanner(ctx: Ctx, result: GauntletResult): void {
  ctx.fillStyle = "rgba(5,20,30,0.66)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const won = result.challengerWon;
  strokedText(
    ctx,
    won ? "ПРОШЁЛ ВСЕХ" : "НЕ СПРАВИЛСЯ",
    WIDTH / 2,
    HEIGHT / 2 - HEIGHT * 0.06,
    Math.round(WIDTH * 0.075),
    won ? C.hpHealthy : C.hpHurt,
  );
  strokedText(
    ctx,
    won ? result.challenger.name : (result.rounds.at(-1)?.opponentName ?? ""),
    WIDTH / 2,
    HEIGHT / 2 + HEIGHT * 0.02,
    Math.round(WIDTH * 0.085),
    C.ink,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export interface GauntletFrameOptions {
  index?: RenderIndex;
  victoryOverlay?: boolean;
  planned?: PlannedFrame;
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

  const camera = cameraOffset(index, frame, result);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // Square arena, wider than the frame, so a wall is usually off screen.
  const half = ARENA.outer / 2;
  ctx.lineWidth = ARENA.border;
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(
    L.sceneCentre.x - half + ARENA.border / 2,
    L.sceneCentre.y - half + ARENA.border / 2,
    ARENA.outer - ARENA.border,
    ARENA.outer - ARENA.border,
  );

  drawPickup(ctx, snap);

  const sides = [
    { key: "challenger" as const, state: snap.challenger, fighter: result.challenger },
    {
      key: "opponent" as const,
      state: snap.opponent,
      fighter: result.team.members[snap.round] ?? result.team.members[0]!,
    },
  ];

  for (const { key, state, fighter } of sides) {
    const pos = fighterPosition(key);
    const vis = visualState(index, frame, state.id);
    const facing: 1 | -1 = key === "challenger" ? 1 : -1;

    // Minions cluster behind their owner.
    snap.minions
      .filter((m) => m.ownerId === state.id)
      .forEach((minion, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const mx = pos.x + side * (L.fighterSize * 0.62 + Math.floor(i / 2) * L.minionSize);
        const my = pos.y + L.fighterSize * 0.18;
        ctx.save();
        ctx.translate(mx, my);
        drawFighter(ctx, fighter.spriteId, {
          size: L.minionSize,
          facing,
          frame,
          asMinion: true,
        });
        ctx.restore();
        const w = L.minionSize * 0.7;
        const share = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(mx - w / 2, my + L.minionSize * 0.6, w, 7);
        ctx.fillStyle = C.buffText;
        ctx.fillRect(mx - w / 2, my + L.minionSize * 0.6, w * share, 7);
      });

    ctx.save();
    ctx.translate(pos.x, pos.y);
    drawFighter(ctx, fighter.spriteId, {
      size: L.fighterSize,
      facing,
      frame,
      strike: vis.strike,
      death: vis.death,
      flash: vis.flash,
      buffed: state.buffed,
    });
    ctx.restore();

    drawHpWidget(
      ctx,
      pos.x,
      pos.y - L.fighterSize * 0.78,
      state.hp,
      state.maxHp,
    );
  }

  drawDamageNumbers(ctx, index, frame, result);
  ctx.restore();

  // Overlay is screen-fixed so long names stay readable.
  drawChallengerLabel(ctx, result.challenger.name);
  drawRosterPanel(ctx, result, snap);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  strokedText(
    ctx,
    `РАУНД ${snap.round + 1}/${result.team.members.length}`,
    WIDTH / 2,
    L.captionBaseline,
    L.captionSize,
    C.ink,
  );
  ctx.textAlign = "left";

  const progressWidth = WIDTH - Math.round(WIDTH * 0.15);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect((WIDTH - progressWidth) / 2, L.progressY, progressWidth, 8);
  ctx.fillStyle = C.hpHealthy;
  ctx.fillRect(
    (WIDTH - progressWidth) / 2,
    L.progressY,
    (progressWidth * (frame + 1)) / Math.max(1, result.durationFrames),
    8,
  );

  const planned = options.planned;
  if (planned?.flash !== undefined && planned.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, planned.flash).toFixed(3)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (options.victoryOverlay || planned?.victoryOverlay) drawVictoryBanner(ctx, result);

  return canvas.toBuffer("image/png");
}
