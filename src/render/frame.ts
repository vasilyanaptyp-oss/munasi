import type { SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { MatchEvent, MatchResult, Side, Snapshot } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { drawSprite, minionSpriteFor, spriteFor } from "./sprites.js";
import { COLORS, ensureFonts, font, HEIGHT, LAYOUT, WIDTH } from "./theme.js";

type Ctx = SKRSContext2D;

/** Frames a floating damage number stays on screen (0.5s at 30fps). */
const DAMAGE_NUMBER_FRAMES = Math.round(FPS * 0.5);
/** Frames of lunge after a fighter swings. */
const LUNGE_FRAMES = 7;
/** Frames the white damage flash lasts. */
const FLASH_FRAMES = 4;
/** Frames the screen keeps shaking after a crit. */
const SHAKE_FRAMES = 8;
/** How far back the HP bar's "ghost" trail remembers. */
const GHOST_FRAMES = 14;

/**
 * Events bucketed by frame. Built once per match so a 1800-frame render does
 * not rescan the whole event list for every frame.
 */
export interface RenderIndex {
  byFrame: Map<number, MatchEvent[]>;
}

export function buildRenderIndex(result: MatchResult): RenderIndex {
  const byFrame = new Map<number, MatchEvent[]>();
  for (const event of result.events) {
    const bucket = byFrame.get(event.frame);
    if (bucket) bucket.push(event);
    else byFrame.set(event.frame, [event]);
  }
  return { byFrame };
}

function eventsAt(index: RenderIndex, frame: number): MatchEvent[] {
  return index.byFrame.get(frame) ?? [];
}

/** Deterministic jitter so stacked damage numbers do not overlap. */
function jitter(seed: string, spread: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

function isAttack(event: MatchEvent): boolean {
  return event.type === "hit" || event.type === "crit" || event.type === "minion_hit";
}

function strokedText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  strokeWidth = size * 0.16,
): void {
  ctx.font = font(size);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = COLORS.outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Overdraw margin so screen shake never exposes bare canvas at the edges. */
const BLEED = 80;

function drawBackground(ctx: Ctx): void {
  const bg = ctx.createLinearGradient(0, -BLEED, 0, HEIGHT + BLEED);
  bg.addColorStop(0, COLORS.bgTop);
  bg.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(-BLEED, -BLEED, WIDTH + BLEED * 2, HEIGHT + BLEED * 2);

  for (const [y, color] of [
    [LAYOUT.a.spriteY, COLORS.arenaGlowA],
    [LAYOUT.b.spriteY, COLORS.arenaGlowB],
  ] as const) {
    const glow = ctx.createRadialGradient(LAYOUT.centerX, y, 40, LAYOUT.centerX, y, 620);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = glow;
    ctx.fillRect(-BLEED, y - 620, WIDTH + BLEED * 2, 1240);
    ctx.globalAlpha = 1;
  }

  // Floor lines under each fighter give the arena a sense of ground.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 3;
  for (const y of [LAYOUT.a.floorY, LAYOUT.b.floorY]) {
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.lineTo(WIDTH - 80, y);
    ctx.stroke();
  }
}

/** The clash line between the two halves of the arena, with the match clock. */
function drawDivider(ctx: Ctx, frame: number): void {
  const y = LAYOUT.divider;
  ctx.save();
  ctx.setLineDash([18, 22]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(90, y);
  ctx.lineTo(WIDTH - 90, y);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(LAYOUT.centerX, y, 62, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.bgTop;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  strokedText(ctx, `${(frame / FPS).toFixed(1)}`, LAYOUT.centerX, y - 6, 44, COLORS.ink, 8);
  strokedText(ctx, "SEC", LAYOUT.centerX, y + 30, 22, COLORS.inkDim, 5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawTitle(ctx: Ctx, nameA: string, nameB: string): void {
  const gap = 34;
  let size = 84;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const widths = (s: number): { a: number; vs: number; b: number; total: number } => {
    ctx.font = font(s);
    const a = ctx.measureText(nameA).width;
    const b = ctx.measureText(nameB).width;
    ctx.font = font(s * 0.72);
    const vs = ctx.measureText("vs").width;
    return { a, vs, b, total: a + b + vs + gap * 2 };
  };

  // Long names shrink to fit rather than running off the frame.
  let m = widths(size);
  const maxWidth = WIDTH - 80;
  if (m.total > maxWidth) {
    size = Math.max(40, Math.floor(size * (maxWidth / m.total)));
    m = widths(size);
  }

  let x = (WIDTH - m.total) / 2;
  const y = LAYOUT.titleBaseline;
  strokedText(ctx, nameA, x, y, size, COLORS.hpFillA);
  x += m.a + gap;
  strokedText(ctx, "vs", x, y - size * 0.08, size * 0.72, COLORS.inkDim);
  x += m.vs + gap;
  strokedText(ctx, nameB, x, y, size, COLORS.hpFillB);
}

function drawHpBar(
  ctx: Ctx,
  y: number,
  name: string,
  hp: number,
  maxHp: number,
  ghostHp: number,
  fill: string,
): void {
  const x = (WIDTH - LAYOUT.barWidth) / 2;
  const h = LAYOUT.barHeight;
  const r = h / 2;

  const rounded = (px: number, py: number, w: number, ph: number, radius: number): void => {
    ctx.beginPath();
    ctx.moveTo(px + radius, py);
    ctx.arcTo(px + w, py, px + w, py + ph, radius);
    ctx.arcTo(px + w, py + ph, px, py + ph, radius);
    ctx.arcTo(px, py + ph, px, py, radius);
    ctx.arcTo(px, py, px + w, py, radius);
    ctx.closePath();
  };

  ctx.save();
  rounded(x, y, LAYOUT.barWidth, h, r);
  ctx.fillStyle = COLORS.hpTrack;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.outline;
  ctx.stroke();

  ctx.save();
  rounded(x, y, LAYOUT.barWidth, h, r);
  ctx.clip();
  const ghostShare = Math.max(0, Math.min(1, ghostHp / maxHp));
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = COLORS.hpGhost;
  ctx.fillRect(x, y, LAYOUT.barWidth * ghostShare, h);
  ctx.globalAlpha = 1;

  const share = Math.max(0, Math.min(1, hp / maxHp));
  const grad = ctx.createLinearGradient(x, y, x + LAYOUT.barWidth, y);
  grad.addColorStop(0, fill);
  grad.addColorStop(1, share < 0.25 ? "#ff4d4d" : fill);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, LAYOUT.barWidth * share, h);
  ctx.restore();
  ctx.restore();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  strokedText(ctx, name, x + 6, y - 16, 34, COLORS.inkDim, 6);
  ctx.textAlign = "right";
  strokedText(
    ctx,
    `${Math.round(hp)} / ${Math.round(maxHp)}`,
    x + LAYOUT.barWidth - 6,
    y - 16,
    34,
    COLORS.ink,
    6,
  );
  ctx.textAlign = "left";
}

function drawProgress(ctx: Ctx, frame: number, total: number): void {
  const w = WIDTH - 160;
  const x = 80;
  const y = LAYOUT.progressY;
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x, y, (w * (frame + 1)) / Math.max(1, total), 8);
}

interface FighterVisualState {
  flash: number;
  lunge: number;
  glow: number;
}

function fighterVisualState(
  index: RenderIndex,
  frame: number,
  fighterId: string,
  buffed: boolean,
): FighterVisualState {
  let flash = 0;
  let lunge = 0;
  for (let back = 0; back <= Math.max(FLASH_FRAMES, LUNGE_FRAMES); back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      if (event.targetId === fighterId && isAttack(event) && back <= FLASH_FRAMES) {
        flash = Math.max(flash, 0.75 * (1 - back / (FLASH_FRAMES + 1)));
      }
      if (event.actorId === fighterId && isAttack(event) && back <= LUNGE_FRAMES) {
        // Quick out, slow back: peak on the frame of the swing.
        lunge = Math.max(lunge, 1 - back / LUNGE_FRAMES);
      }
    }
  }
  return { flash, lunge, glow: buffed ? 0.8 : 0 };
}

function shakeOffset(index: RenderIndex, frame: number): { x: number; y: number } {
  let amp = 0;
  for (let back = 0; back <= SHAKE_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      if (event.type === "crit" || event.type === "death") {
        const strength = event.type === "death" ? 34 : 20;
        amp = Math.max(amp, strength * (1 - back / (SHAKE_FRAMES + 1)));
      }
    }
  }
  if (amp === 0) return { x: 0, y: 0 };
  return { x: Math.sin(frame * 2.7) * amp, y: Math.cos(frame * 3.1) * amp * 0.6 };
}

function ghostHpAt(snapshots: Snapshot[], frame: number, side: Side): number {
  let best = 0;
  for (let f = Math.max(0, frame - GHOST_FRAMES); f <= frame; f += 1) {
    const snap = snapshots[f];
    if (!snap) continue;
    best = Math.max(best, side === "a" ? snap.a.hp : snap.b.hp);
  }
  return best;
}

function drawMinions(
  ctx: Ctx,
  snap: Snapshot,
  ownerId: string,
  ownerSpriteId: string,
  baseY: number,
): void {
  const mine = snap.minions.filter((m) => m.ownerId === ownerId);
  const def = minionSpriteFor(ownerSpriteId);
  const facing: 1 | -1 = baseY < LAYOUT.divider ? 1 : -1;
  mine.forEach((minion, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2);
    const x = LAYOUT.centerX + side * (250 + rank * 86);
    const y = baseY + 78 + (rank % 2) * 40;
    ctx.save();
    ctx.translate(x, y);
    drawSprite(ctx, def, { size: LAYOUT.minionSize, facing });
    ctx.restore();

    // Slim HP pip under each minion.
    const w = 78;
    const pipY = y + LAYOUT.minionSize * 0.6;
    const share = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - w / 2, pipY, w, 8);
    ctx.fillStyle = COLORS.heal;
    ctx.fillRect(x - w / 2, pipY, w * share, 8);
  });
}

function drawDamageNumbers(ctx: Ctx, index: RenderIndex, frame: number, result: MatchResult): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      let text: string;
      let color: string;
      let size: number;
      switch (event.type) {
        case "crit":
          text = `${event.value}!`;
          color = COLORS.crit;
          size = 88;
          break;
        case "hit":
          text = `${event.value}`;
          color = COLORS.ink;
          size = 60;
          break;
        case "minion_hit":
          text = `${event.value}`;
          color = COLORS.minionDamage;
          size = 44;
          break;
        case "heal":
          text = `+${event.value}`;
          color = COLORS.heal;
          size = 58;
          break;
        case "aoe":
          text = `${event.value}`;
          color = COLORS.aoe;
          size = 66;
          break;
        default:
          continue;
      }

      const targetIsA = event.targetId === result.fighters.a.id;
      const targetIsB = event.targetId === result.fighters.b.id;
      const anchorY =
        event.type === "heal"
          ? event.actorId === result.fighters.a.id
            ? LAYOUT.a.spriteY
            : LAYOUT.b.spriteY
          : targetIsA
            ? LAYOUT.a.spriteY
            : targetIsB
              ? LAYOUT.b.spriteY
              : LAYOUT.divider;

      const age = back / DAMAGE_NUMBER_FRAMES;
      const x = LAYOUT.centerX + jitter(`${event.frame}:${event.actorId}:${event.type}`, 170);
      const y = anchorY - 150 - age * 130;
      ctx.globalAlpha = 1 - age;
      strokedText(ctx, text, x, y, size * (1 + 0.12 * (1 - age)), color, size * 0.14);
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawVictoryBanner(ctx: Ctx, name: string, color: string): void {
  ctx.fillStyle = "rgba(5,7,13,0.62)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  strokedText(ctx, "WINNER", WIDTH / 2, HEIGHT / 2 - 110, 92, COLORS.inkDim);
  strokedText(ctx, name, WIDTH / 2, HEIGHT / 2 + 20, 128, color);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export interface RenderFrameOptions {
  /** Prebuilt event index; built on demand when omitted. */
  index?: RenderIndex;
  /** Draws the winner overlay on top of the frame. */
  victoryOverlay?: boolean;
}

/**
 * Renders one frame to a PNG buffer. Pure: output depends only on the match
 * result and the frame number, never on previously rendered frames.
 */
export function renderSingleFrame(
  result: MatchResult,
  frame: number,
  options: RenderFrameOptions = {},
): Buffer {
  ensureFonts();
  const snap = result.snapshots[frame];
  if (!snap) {
    throw new Error(
      `renderSingleFrame: frame ${frame} is out of range (0..${result.durationFrames - 1})`,
    );
  }
  const index = options.index ?? buildRenderIndex(result);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const shake = shakeOffset(index, frame);
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawBackground(ctx);

  drawTitle(ctx, result.fighters.a.name, result.fighters.b.name);
  drawDivider(ctx, frame);

  drawHpBar(
    ctx,
    LAYOUT.a.barY,
    result.fighters.a.name,
    snap.a.hp,
    snap.a.maxHp,
    ghostHpAt(result.snapshots, frame, "a"),
    COLORS.hpFillA,
  );
  drawHpBar(
    ctx,
    LAYOUT.b.barY,
    result.fighters.b.name,
    snap.b.hp,
    snap.b.maxHp,
    ghostHpAt(result.snapshots, frame, "b"),
    COLORS.hpFillB,
  );

  drawMinions(ctx, snap, result.fighters.a.id, result.fighters.a.spriteId, LAYOUT.a.spriteY);
  drawMinions(ctx, snap, result.fighters.b.id, result.fighters.b.spriteId, LAYOUT.b.spriteY);

  for (const side of ["a", "b"] as const) {
    const fighter = result.fighters[side];
    const state = snap[side];
    const facing: 1 | -1 = side === "a" ? 1 : -1;
    const vis = fighterVisualState(index, frame, fighter.id, state.buffed);
    const bob = Math.sin(frame * 0.14 + (side === "a" ? 0 : Math.PI / 2)) * 12;
    const y = (side === "a" ? LAYOUT.a.spriteY : LAYOUT.b.spriteY) + bob + facing * vis.lunge * 62;

    ctx.save();
    ctx.translate(LAYOUT.centerX, y);
    if (!state.alive) {
      // Toppled over, faded out.
      ctx.globalAlpha = 0.45;
      ctx.rotate(facing * 1.35);
    }
    drawSprite(ctx, spriteFor(fighter.spriteId), {
      size: LAYOUT.spriteSize,
      facing,
      flash: vis.flash,
      glow: vis.glow,
    });
    ctx.restore();
  }

  drawDamageNumbers(ctx, index, frame, result);
  drawProgress(ctx, frame, result.durationFrames);
  ctx.restore();

  if (options.victoryOverlay && result.winnerId !== null) {
    const winnerIsA = result.winnerId === result.fighters.a.id;
    drawVictoryBanner(
      ctx,
      winnerIsA ? result.fighters.a.name : result.fighters.b.name,
      winnerIsA ? COLORS.hpFillA : COLORS.hpFillB,
    );
  }

  return canvas.toBuffer("image/png");
}
