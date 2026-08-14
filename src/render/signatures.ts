import type { SKRSContext2D } from "@napi-rs/canvas";
import type { MatchEvent } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { GAUNTLET_COLORS as C } from "./gauntletTheme.js";
import { strokedText } from "./frame.js";
import { font } from "./theme.js";

/**
 * The signature abilities, drawn across the whole arena.
 *
 * This is the part that makes the format watchable, and the part this project
 * did not have. In the reference an ability is not a number over a head — it is
 * hundreds of particle arcs, or a blast that fills the square, or a compass rose
 * over everything. A character is a photo plus one effect you can see from
 * across the room.
 *
 * Both of these seize *movement*, which in a game whose entire picture is two
 * figures bouncing is the strongest thing an ability can do.
 */

type Ctx = SKRSContext2D;

/** Frames each effect plays for. */
export const SIGNATURE_FRAMES = Math.round(FPS * 1.4);

export interface ArenaBox {
  x: number;
  y: number;
  side: number;
  border: number;
}

/**
 * MAGNETIC NORTH — Compass Guy.
 *
 * A compass rose fills the arena, the needle spins and slams onto the heading
 * everyone else has just been pointed at.
 */
function magneticNorth(ctx: Ctx, arena: ArenaBox, age: number, heading: number, width: number): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const cx = arena.x + arena.side / 2;
  const cy = arena.y + arena.side / 2;
  const inner = arena.side - arena.border * 2;
  const radius = inner * 0.46;
  // Fades in fast, holds, then goes; the needle lands two-thirds of the way in.
  const alpha = t < 0.12 ? t / 0.12 : t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1;

  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.translate(cx, cy);

  // Two rings and the tick marks.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(3, inner * 0.008);
  for (const r of [radius, radius * 0.78]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(2, inner * 0.005);
  for (let i = 0; i < 32; i += 1) {
    const a = (i / 32) * Math.PI * 2;
    const long = i % 8 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.lineTo(Math.cos(a) * radius * (long ? 0.82 : 0.9), Math.sin(a) * radius * (long ? 0.82 : 0.9));
    ctx.stroke();
  }

  // N E S W.
  const letter = Math.round(inner * 0.075);
  ctx.font = font(letter);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const marks: [string, number][] = [["N", -Math.PI / 2], ["E", 0], ["S", Math.PI / 2], ["W", Math.PI]];
  for (const [text, a] of marks) {
    strokedText(ctx, text, Math.cos(a) * radius * 0.66, Math.sin(a) * radius * 0.66, letter, "#ffffff", 6);
  }

  // The needle: spins hard, then settles on the heading it handed out.
  const spins = 4;
  const settle = Math.min(1, t / 0.66);
  const eased = 1 - Math.pow(1 - settle, 3);
  const angle = heading + (1 - eased) * Math.PI * 2 * spins;
  ctx.rotate(angle);
  const len = radius * 0.72;
  for (const [dir, colour] of [[1, "#ed1e2a"], [-1, "#ffffff"]] as const) {
    ctx.beginPath();
    ctx.moveTo(len * dir, 0);
    ctx.lineTo(-len * 0.06 * dir, -inner * 0.035);
    ctx.lineTo(-len * 0.06 * dir, inner * 0.035);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = Math.max(2, inner * 0.004);
    ctx.strokeStyle = C.outline;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = Math.round(inner * 0.062);
  // Centred on the frame, not the arena: the arena slides and gets cropped, and
  // a name that runs off the edge is the one thing the overlay may never do.
  strokedText(ctx, "MAGNETIC NORTH", width / 2, arena.y + arena.border + inner * 0.09, label, "#ffe45c", 8);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * NOBODY MOVES — Bodyguard Guy.
 *
 * A white flash swallows the frame, and when it clears the other fighter is
 * standing still. The stillness is the effect; the flash is how you notice it.
 */
function nobodyMoves(ctx: Ctx, arena: ArenaBox, age: number, width: number, height: number): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const inner = arena.side - arena.border * 2;

  // The flash is short and covers everything; the rest of the effect is the
  // frozen fighter, which needs the screen back to be readable.
  const flash = t < 0.22 ? 1 - t / 0.22 : 0;
  if (flash > 0) {
    ctx.save();
    ctx.globalAlpha = flash;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const alpha = t < 0.1 ? t / 0.1 : t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Two hard bars closing on the arena, the visual of everything being held.
  const bar = inner * 0.055;
  const squeeze = Math.min(1, t / 0.35);
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, arena.y + arena.border + inner * 0.5 * squeeze - bar / 2, width, bar);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = Math.round(inner * 0.075);
  strokedText(ctx, "NOBODY MOVES", width / 2, arena.y + arena.border + inner * 0.5 * squeeze, label, "#ffffff", 9);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Draws whichever signature is playing on this frame, if any. */
export function drawSignatures(
  ctx: Ctx,
  events: MatchEvent[],
  frame: number,
  arena: ArenaBox,
  size: { width: number; height: number },
  kindOf: (actorId: string) => "magnetic_north" | "nobody_moves" | null,
): void {
  for (const event of events) {
    if (event.type !== "signature") continue;
    const age = frame - event.frame;
    if (age < 0 || age >= SIGNATURE_FRAMES) continue;
    const kind = kindOf(event.actorId);
    if (kind === "magnetic_north") magneticNorth(ctx, arena, age, event.value, size.width);
    else if (kind === "nobody_moves") nobodyMoves(ctx, arena, age, size.width, size.height);
  }
}
