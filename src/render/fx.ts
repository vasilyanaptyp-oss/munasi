import type { SKRSContext2D } from "@napi-rs/canvas";
import { GAUNTLET_COLORS as C } from "./gauntletTheme.js";

/**
 * The drawing kit the signature abilities are built from.
 *
 * The effects were four one-off sketches: a flat stroke here, a circle there,
 * each written inline and each looking like it. What separates a drawn effect
 * from a designed one is not the shape — it is that every shape is built the
 * same way, out of the same few parts:
 *
 * - **A halo under a core.** One flat line on a flat blue field reads as a line.
 *   The same line drawn wide and dim underneath and thin and bright on top reads
 *   as light. Everything bright here is drawn twice.
 * - **A dark keyline on anything solid**, exactly as the format outlines its
 *   fighters in white and its HP plus in black. A bright yellow shape with no
 *   edge dissolves into the blue at thumbnail size.
 * - **Taper.** Blunt round caps read as pipes. A stroke that narrows along its
 *   length reads as speed, and it is what the reference's own marks do.
 * - **Perspective on impacts.** A shockwave is an ellipse squashed along the
 *   axis it travelled in, not a circle. A circle reads as a hoop lying on the
 *   screen; an ellipse reads as a wave leaving the point it was struck at.
 * - **Directional debris, never radial.** Sparks go in a cone the way the blow
 *   was going. Anything evenly spaced around a centre is a cartoon sun, which
 *   this project has already shipped once.
 *
 * All of it is deterministic: the only randomness is `hash01`, seeded from the
 * event, so the same frame draws the same pixels forever.
 */

type Ctx = SKRSContext2D;

/** The one colour the whole hit language is in. */
export const FX_COLOUR = C.damageText;
/** The hottest moment of an effect — a white core inside the yellow. */
export const FX_CORE = "#fffdf0";

/** Deterministic 0..1 from a seed string and an index. */
export function hash01(seed: string, index: number): number {
  let h = 0x811c9dc5 ^ index;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  return ((h >>> 8) & 0xffffff) / 0xffffff;
}

/** Symmetric jitter around zero. */
export function jitter(seed: string, index: number, spread: number): number {
  return (hash01(seed, index) * 2 - 1) * spread;
}

/** Ease-out: leaves fast, settles onto the target. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2.2);
}

/** Ease-in: gathers slowly, then goes. Used for wind-ups. */
export function easeIn(t: number): number {
  return t * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Strokes a path as light: a wide dim halo, then the crisp bright line, then an
 * optional white core down the middle of it.
 *
 * `path` is called once per pass, so it must only describe geometry.
 */
export function glowStroke(
  ctx: Ctx,
  path: () => void,
  options: {
    width: number;
    alpha: number;
    colour?: string;
    /** How much wider the halo is than the core. */
    halo?: number;
    /** Draw a white-hot centre line at this share of the core's width. */
    core?: number;
  },
): void {
  const colour = options.colour ?? FX_COLOUR;
  const halo = options.halo ?? 3.4;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.globalAlpha = options.alpha * 0.22;
  ctx.strokeStyle = colour;
  ctx.lineWidth = options.width * halo;
  path();
  ctx.stroke();

  ctx.globalAlpha = options.alpha;
  ctx.lineWidth = options.width;
  path();
  ctx.stroke();

  if (options.core !== undefined && options.core > 0) {
    ctx.globalAlpha = options.alpha;
    ctx.strokeStyle = FX_CORE;
    ctx.lineWidth = options.width * options.core;
    path();
    ctx.stroke();
  }
  ctx.restore();
}

/** Fills a shape with a dark keyline round it, the way the format outlines everything. */
export function keyedFill(
  ctx: Ctx,
  path: () => void,
  options: { fill: string; alpha: number; keyline: number },
): void {
  ctx.save();
  ctx.globalAlpha = options.alpha;
  ctx.lineJoin = "round";
  path();
  ctx.fillStyle = options.fill;
  ctx.fill();
  if (options.keyline > 0) {
    ctx.lineWidth = options.keyline;
    ctx.strokeStyle = C.outline;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A stroke that narrows from `wStart` to `wEnd` — drawn as a quad, because a
 * canvas line has one width for its whole length and a constant-width streak is
 * the single thing that most makes an effect look drawn rather than moving.
 */
export function taper(
  ctx: Ctx,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  wStart: number,
  wEnd: number,
  options: { alpha: number; colour?: string; halo?: boolean },
): void {
  const angle = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const shape = (grow: number): void => {
    const s = wStart / 2 + grow;
    const e = wEnd / 2 + grow;
    ctx.beginPath();
    ctx.moveTo(ax + nx * s, ay + ny * s);
    ctx.lineTo(bx + nx * e, by + ny * e);
    ctx.lineTo(bx - nx * e, by - ny * e);
    ctx.lineTo(ax - nx * s, ay - ny * s);
    ctx.closePath();
  };
  ctx.save();
  const colour = options.colour ?? FX_COLOUR;
  if (options.halo !== false) {
    ctx.globalAlpha = options.alpha * 0.16;
    ctx.fillStyle = colour;
    shape(Math.max(wStart, wEnd) * 0.55);
    ctx.fill();
  }
  ctx.globalAlpha = options.alpha;
  ctx.fillStyle = colour;
  shape(0);
  ctx.fill();
  ctx.restore();
}

/**
 * A shockwave: an ellipse squashed along the axis it came in on, expanding and
 * thinning. Two trailing echoes behind the leading edge give it a body.
 */
export function shockRing(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  radius: number,
  options: { squash?: number; width: number; alpha: number; colour?: string; echoes?: number },
): void {
  const squash = options.squash ?? 0.62;
  const echoes = options.echoes ?? 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  for (let i = 0; i <= echoes; i += 1) {
    const back = i * 0.16;
    const r = radius * (1 - back);
    if (r <= 0) continue;
    glowStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * squash, r, 0, 0, Math.PI * 2);
      },
      {
        width: options.width * (1 - i * 0.35),
        alpha: options.alpha * (i === 0 ? 1 : 0.4 / i),
        ...(options.colour === undefined ? {} : { colour: options.colour }),
      },
    );
  }
  ctx.restore();
}

/**
 * Debris thrown **the way the blow was going**: a handful of tapered shards in
 * a cone, unequal lengths, seeded so they are the same shards every render.
 */
export function sparkCone(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  options: {
    spread: number;
    count: number;
    near: number;
    far: number;
    width: number;
    alpha: number;
    seed: string;
    colour?: string;
  },
): void {
  for (let i = 0; i < options.count; i += 1) {
    const a = angle + jitter(options.seed, i, options.spread);
    const near = options.near * (0.8 + hash01(options.seed, i + 40) * 0.5);
    const far = near + (options.far - options.near) * (0.5 + hash01(options.seed, i + 80) * 0.8);
    taper(
      ctx,
      x + Math.cos(a) * near,
      y + Math.sin(a) * near,
      x + Math.cos(a) * far,
      y + Math.sin(a) * far,
      options.width,
      options.width * 0.12,
      {
        alpha: options.alpha,
        ...(options.colour === undefined ? {} : { colour: options.colour }),
      },
    );
  }
}

/**
 * A prop in flight, with motion blur: the same sprite stamped a few times along
 * where it has just been, dimmest and smallest at the back.
 *
 * A single crisp copy of a photograph sliding across the screen reads as a
 * sticker being dragged. The ghosts are what make it read as thrown.
 */
export function flyingSprite(
  ctx: Ctx,
  sprite: Parameters<Ctx["drawImage"]>[0],
  options: {
    x: number;
    y: number;
    /** Unit vector the thing is travelling along, for the ghosts and the streak. */
    dx: number;
    dy: number;
    width: number;
    height: number;
    rotation: number;
    spin: number;
    alpha: number;
    /** How far back the ghosts trail, in pixels. */
    trail: number;
    ghosts?: number;
  },
): void {
  const ghosts = options.ghosts ?? 3;
  // The streak first, so the prop sits on top of its own light. Long and thin,
  // pinched to nothing at the back: a short fat wedge reads as a torch beam,
  // which is what this was.
  taper(
    ctx,
    options.x - options.dx * options.trail * 2.4,
    options.y - options.dy * options.trail * 2.4,
    options.x - options.dx * options.width * 0.25,
    options.y - options.dy * options.width * 0.25,
    0,
    options.width * 0.16,
    { alpha: options.alpha * 0.6 },
  );

  for (let i = ghosts; i >= 0; i -= 1) {
    // Spread wide and dropped fast, so they read as one object moving rather
    // than as a stack of copies of it.
    const back = (i / ghosts) * options.trail * 1.25;
    const fade = i === 0 ? 1 : 0.1 / i;
    const scale = 1 - i * 0.1;
    ctx.save();
    ctx.globalAlpha = options.alpha * fade;
    ctx.translate(options.x - options.dx * back, options.y - options.dy * back);
    ctx.rotate(options.rotation - options.spin * i * 0.35);
    ctx.drawImage(
      sprite,
      (-options.width * scale) / 2,
      (-options.height * scale) / 2,
      options.width * scale,
      options.height * scale,
    );
    ctx.restore();
  }
}

/**
 * The wind-up on the caster: a ring that gathers inward and tightens, with two
 * short arcs sweeping round it.
 *
 * Every ability opens on this, so a viewer always knows which of the two
 * figures the next thing on screen belongs to.
 */
export function casterCharge(
  ctx: Ctx,
  x: number,
  y: number,
  t: number,
  scale: number,
  seed: string,
): void {
  if (t >= 1) return;
  const gather = easeIn(t);
  const radius = scale * (0.78 - 0.34 * gather);
  const alpha = 0.9 * (1 - t * 0.35);

  glowStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 0.82, radius, 0, 0, Math.PI * 2);
    },
    { width: Math.max(2.5, scale * 0.016 * (1 + gather)), alpha: alpha * 0.55 },
  );

  // Two arcs sweeping round the ring, so the gather has motion in it rather
  // than being a circle that quietly changes size.
  for (let i = 0; i < 2; i += 1) {
    const spin = gather * Math.PI * 2.4 + i * Math.PI + hash01(seed, i) * Math.PI;
    glowStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 0.82, radius, 0, spin, spin + 0.85);
      },
      { width: Math.max(3, scale * 0.03), alpha, core: 0.3 },
    );
  }
}
