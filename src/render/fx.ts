import type { SKRSContext2D } from "@napi-rs/canvas";
import { GAUNTLET_COLORS as C } from "./gauntletTheme.js";

/**
 * The kit the signature abilities are built from.
 *
 * **Re-derived from the reference channel's own abilities**, at full resolution,
 * after two attempts that were wrong in the same way. What the reference draws
 * when a character uses its signature:
 *
 * - *Fireworks Guy* — **actual fireworks**. Two hundred small dots strung along
 *   arcing trails, bright green and hot orange, filling half the square, with a
 *   shell visibly climbing before it opens.
 * - *Exploding Guy* — **a fireball**: orange and yellow with dark smoke at its
 *   edges, a third of the arena across.
 * - *Time Traveler Guy* — an alarm clock and a bundle of dynamite in his hands,
 *   and a **red seven-segment countdown on a black panel** under him.
 * - *Guitar Guy* — five **coloured fret pads**, stacks of flat coloured discs
 *   piling up on them, and columns of coloured light shooting out of them.
 *
 * Three things follow, and all three are the opposite of what was here:
 *
 * 1. **An ability is a nameable object, not an abstract flourish.** A viewer
 *    says "fireworks", "an explosion", "a clock". Ours were rings, streaks and
 *    sparks — the same three shapes four times over, and nothing you could name.
 * 2. **Each one has its own colours.** Green, orange, red-on-black, five fret
 *    colours at once. The single-yellow rule is real but it belongs to the
 *    *damage numbers*, which are yellow in every reference frame. It was applied
 *    to the effects too, and that is what made four characters look like one.
 * 3. **Solid shapes and quantity.** Flat fills with hard edges, and where there
 *    are particles there are *hundreds* of them. Halos under thin strokes are a
 *    motion-graphics idiom; this format is a cut-out collage.
 *
 * Everything here is deterministic — the only randomness is `hash01`, seeded off
 * the event — so a frame renders the same pixels forever.
 */

type Ctx = SKRSContext2D;

/** Deterministic 0..1 from a seed string and an index. */
export function hash01(seed: string, index: number): number {
  let h = 0x811c9dc5 ^ Math.imul(index + 1, 0x9e3779b1);
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

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Fills a shape and rings it in the format's own black keyline.
 *
 * Every solid thing in this format carries an edge — the fighters are cut out
 * and traced in white, the HP plus is traced in black. A flat fill with no edge
 * is the one thing that reads as pasted on rather than drawn in.
 */
export function keyedFill(
  ctx: Ctx,
  path: () => void,
  options: { fill: string; alpha?: number; keyline?: number; keylineColour?: string },
): void {
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.lineJoin = "round";
  path();
  ctx.fillStyle = options.fill;
  ctx.fill();
  if (options.keyline !== undefined && options.keyline > 0) {
    ctx.lineWidth = options.keyline;
    ctx.strokeStyle = options.keylineColour ?? C.outline;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A stroke that narrows from `wStart` to `wEnd`, drawn as a quad.
 *
 * A canvas line has one width for its whole length, and a constant-width streak
 * is the thing that most makes a moving object look pasted.
 */
export function taper(
  ctx: Ctx,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  wStart: number,
  wEnd: number,
  options: { alpha?: number; colour: string; keyline?: number },
): void {
  const angle = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  keyedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(ax + nx * (wStart / 2), ay + ny * (wStart / 2));
      ctx.lineTo(bx + nx * (wEnd / 2), by + ny * (wEnd / 2));
      ctx.lineTo(bx - nx * (wEnd / 2), by - ny * (wEnd / 2));
      ctx.lineTo(ax - nx * (wStart / 2), ay - ny * (wStart / 2));
      ctx.closePath();
    },
    {
      fill: options.colour,
      ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
      ...(options.keyline === undefined ? {} : { keyline: options.keyline }),
    },
  );
}

/**
 * A firework: dozens of trails of small dots, thrown outward and falling.
 *
 * This is the reference's densest effect and the one that most separates its
 * abilities from ours — it is not three sparks, it is a couple of hundred dots
 * strung along arcs. `t` runs 0..1 over the burst's life; the dots slow, drop
 * and shrink as it goes.
 */
export function firework(
  ctx: Ctx,
  x: number,
  y: number,
  options: {
    t: number;
    reach: number;
    trails: number;
    perTrail: number;
    colours: string[];
    seed: string;
    /** 0 = a full sphere, smaller values aim it into a cone. */
    spread?: number;
    heading?: number;
    dot?: number;
    gravity?: number;
  },
): void {
  const t = clamp01(options.t);
  if (t <= 0 || t >= 1) return;
  const spread = options.spread ?? Math.PI;
  const heading = options.heading ?? 0;
  const dot = options.dot ?? options.reach * 0.022;
  const gravity = options.gravity ?? 0.55;
  const fade = t > 0.55 ? Math.max(0, (1 - t) / 0.45) : 1;

  ctx.save();
  for (let i = 0; i < options.trails; i += 1) {
    const angle = heading + jitter(options.seed, i, spread);
    const speed = 0.55 + hash01(options.seed, i + 200) * 0.65;
    const colour = options.colours[i % options.colours.length]!;
    ctx.fillStyle = colour;
    for (let k = 0; k < options.perTrail; k += 1) {
      // Each dot on a trail is a little further behind the head, so the trail
      // stretches as it flies and bunches as it dies.
      const lag = (k / options.perTrail) * 0.42;
      const p = t - lag;
      if (p <= 0) continue;
      const travel = easeOut(p) * options.reach * speed;
      const px = x + Math.cos(angle) * travel;
      const py = y + Math.sin(angle) * travel + gravity * options.reach * p * p;
      ctx.globalAlpha = fade * (1 - k / (options.perTrail + 1)) * 0.95;
      ctx.beginPath();
      ctx.arc(px, py, dot * (1 - k / (options.perTrail * 1.6)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The comic impact star — the shape the reference itself draws over a fighter
 * on a big hit. A jagged ring of alternating long and short points, filled in
 * bands from the outside in, keylined black.
 */
export function spikeStar(
  ctx: Ctx,
  x: number,
  y: number,
  options: {
    radius: number;
    points: number;
    inner: number;
    rotation: number;
    bands: string[];
    seed: string;
    alpha?: number;
    keyline?: number;
  },
): void {
  const trace = (scale: number): void => {
    ctx.beginPath();
    for (let i = 0; i < options.points * 2; i += 1) {
      // Ragged, not a tidy cog: each long point gets its own length.
      const long = i % 2 === 0;
      const wobble = long ? 0.78 + hash01(options.seed, i) * 0.42 : 1;
      const r = options.radius * scale * (long ? wobble : options.inner);
      const a = options.rotation + (i / (options.points * 2)) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  options.bands.forEach((colour, i) => {
    keyedFill(ctx, () => trace(1 - i * (0.9 / options.bands.length)), {
      fill: colour,
      ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
      ...(i === 0 && options.keyline !== undefined ? { keyline: options.keyline } : {}),
    });
  });
}

/**
 * Hazard tape: a band of diagonal stripes wrapped round an ellipse.
 *
 * Nameable on sight, which is the whole point — "this one has been cordoned
 * off" is a thing a picture can say in one frame, where a thin ring is not.
 */
export function stripedRing(
  ctx: Ctx,
  x: number,
  y: number,
  options: {
    rx: number;
    ry: number;
    band: number;
    stripes: number;
    phase: number;
    colours: [string, string];
    alpha?: number;
    /** Draw only this share of the ring, from the top, for the closing beat. */
    sweep?: number;
  },
): void {
  const sweep = clamp01(options.sweep ?? 1);
  if (sweep <= 0) return;
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.translate(x, y);
  const steps = options.stripes * 2;
  for (let i = 0; i < steps; i += 1) {
    const a0 = -Math.PI / 2 + (i / steps) * Math.PI * 2 * sweep;
    const a1 = -Math.PI / 2 + ((i + 1.02) / steps) * Math.PI * 2 * sweep;
    ctx.fillStyle = options.colours[(i + options.phase) % 2 === 0 ? 0 : 1]!;
    ctx.beginPath();
    ctx.ellipse(0, 0, options.rx + options.band / 2, options.ry + options.band / 2, 0, a0, a1);
    ctx.ellipse(0, 0, options.rx - options.band / 2, options.ry - options.band / 2, 0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
  // One keyline round the whole band rather than round every stripe.
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = Math.max(2, options.band * 0.14);
  for (const r of [1, -1]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, options.rx + (r * options.band) / 2, options.ry + (r * options.band) / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Broken glass: hard-edged triangular shards flying outward, each with a bright
 * facet down one side so they read as glass rather than as confetti.
 */
export function shardBurst(
  ctx: Ctx,
  x: number,
  y: number,
  options: {
    t: number;
    reach: number;
    count: number;
    size: number;
    heading: number;
    spread: number;
    seed: string;
    colours: [string, string];
  },
): void {
  const t = clamp01(options.t);
  if (t <= 0 || t >= 1) return;
  const fade = t > 0.5 ? Math.max(0, (1 - t) / 0.5) : 1;
  for (let i = 0; i < options.count; i += 1) {
    const a = options.heading + jitter(options.seed, i, options.spread);
    const travel = easeOut(t) * options.reach * (0.45 + hash01(options.seed, i + 60) * 0.9);
    const px = x + Math.cos(a) * travel;
    const py = y + Math.sin(a) * travel + options.reach * 0.35 * t * t;
    const size = options.size * (0.55 + hash01(options.seed, i + 120) * 0.9);
    const spin = a + t * (2 + hash01(options.seed, i + 180) * 5);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(spin);
    keyedFill(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.55, size * 0.62);
        ctx.lineTo(-size * 0.35, -size * 0.5);
        ctx.closePath();
      },
      { fill: options.colours[0]!, alpha: fade, keyline: Math.max(1.5, size * 0.1) },
    );
    keyedFill(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(size * 0.8, 0);
        ctx.lineTo(-size * 0.3, size * 0.3);
        ctx.lineTo(-size * 0.2, -size * 0.2);
        ctx.closePath();
      },
      { fill: options.colours[1]!, alpha: fade * 0.9 },
    );
    ctx.restore();
  }
}

/** A four-pointed glint — the "this is glass / this is metal" mark. */
export function glint(
  ctx: Ctx,
  x: number,
  y: number,
  options: { radius: number; alpha: number; colour: string; rotation?: number },
): void {
  const r = options.radius;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(options.rotation ?? 0);
  keyedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.14, -r * 0.14, r, 0);
      ctx.quadraticCurveTo(r * 0.14, r * 0.14, 0, r);
      ctx.quadraticCurveTo(-r * 0.14, r * 0.14, -r, 0);
      ctx.quadraticCurveTo(-r * 0.14, -r * 0.14, 0, -r);
      ctx.closePath();
    },
    { fill: options.colour, alpha: options.alpha },
  );
  ctx.restore();
}

/**
 * A prop in flight, with motion blur: the sprite stamped a few times along where
 * it has just been, dimmest and smallest at the back, over a tapered streak.
 */
export function flyingSprite(
  ctx: Ctx,
  sprite: Parameters<Ctx["drawImage"]>[0],
  options: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    width: number;
    height: number;
    rotation: number;
    alpha: number;
    trail: number;
    colour: string;
    ghosts?: number;
  },
): void {
  const ghosts = options.ghosts ?? 3;
  taper(
    ctx,
    options.x - options.dx * options.trail * 2.4,
    options.y - options.dy * options.trail * 2.4,
    options.x - options.dx * options.width * 0.25,
    options.y - options.dy * options.width * 0.25,
    0,
    options.width * 0.2,
    { alpha: options.alpha * 0.7, colour: options.colour },
  );

  for (let i = ghosts; i >= 0; i -= 1) {
    const back = (i / ghosts) * options.trail * 1.25;
    const fade = i === 0 ? 1 : 0.1 / i;
    const scale = 1 - i * 0.1;
    ctx.save();
    ctx.globalAlpha = options.alpha * fade;
    ctx.translate(options.x - options.dx * back, options.y - options.dy * back);
    ctx.rotate(options.rotation - i * 0.18);
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
