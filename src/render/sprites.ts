import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Procedural fighter art. Everything is drawn from code, so the repo ships no
 * third-party images — no real people, no borrowed franchises — and a sprite
 * looks identical on every machine.
 *
 * Shapes are authored in unit space (-1..1 on both axes) and scaled to the
 * requested pixel size, which is why the same code draws a 300px fighter and a
 * 96px minion.
 */

export type Archetype =
  | "knight"
  | "mage"
  | "beast"
  | "golem"
  | "rogue"
  | "wisp"
  | "warden"
  | "reaper";

export interface Palette {
  primary: string;
  secondary: string;
  trim: string;
  skin: string;
  eye: string;
}

export interface SpriteDef {
  archetype: Archetype;
  palette: Palette;
}

const ARCHETYPES: Archetype[] = [
  "knight",
  "mage",
  "beast",
  "golem",
  "rogue",
  "wisp",
  "warden",
  "reaper",
];

/** Sprites registered by content. Anything unknown falls back to a hash. */
const REGISTRY = new Map<string, SpriteDef>();

export function registerSprite(spriteId: string, def: SpriteDef): void {
  REGISTRY.set(spriteId, def);
}

/** FNV-1a. Deterministic across runs and platforms, unlike string hashing by hand. */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function paletteFromHue(hue: number): Palette {
  return {
    primary: `hsl(${hue}, 62%, 54%)`,
    secondary: `hsl(${(hue + 24) % 360}, 48%, 33%)`,
    trim: `hsl(${(hue + 175) % 360}, 82%, 62%)`,
    skin: "#e8c9a0",
    eye: "#ffffff",
  };
}

const isArchetype = (value: string): value is Archetype =>
  (ARCHETYPES as string[]).includes(value);

/**
 * Resolves a fighter's `spriteId` to art. Three forms, in priority order:
 *   `registerSprite()`d id — whatever was registered
 *   `"mage:280"`           — that archetype, hue 280
 *   anything else          — archetype and hue derived from the id's hash
 */
export function spriteFor(spriteId: string): SpriteDef {
  const registered = REGISTRY.get(spriteId);
  if (registered) return registered;

  const [namePart, huePart] = spriteId.split(":");
  const h = hashString(spriteId);
  if (namePart !== undefined && isArchetype(namePart)) {
    const hue = huePart !== undefined && huePart !== "" ? Number(huePart) : h % 360;
    return {
      archetype: namePart,
      palette: paletteFromHue(Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : h % 360),
    };
  }
  return {
    archetype: ARCHETYPES[h % ARCHETYPES.length]!,
    palette: paletteFromHue(h % 360),
  };
}

/**
 * What each archetype summons. Minions wear their owner's palette so the
 * viewer reads them as belonging to the fighter beside them.
 */
const MINION_ARCHETYPE: Record<Archetype, Archetype> = {
  knight: "rogue",
  mage: "wisp",
  beast: "beast",
  golem: "golem",
  rogue: "rogue",
  wisp: "wisp",
  warden: "knight",
  reaper: "wisp",
};

export function minionSpriteFor(ownerSpriteId: string): SpriteDef {
  const owner = spriteFor(ownerSpriteId);
  return { archetype: MINION_ARCHETYPE[owner.archetype], palette: owner.palette };
}

type Ctx = SKRSContext2D;

function poly(ctx: Ctx, points: readonly (readonly [number, number])[], fill: string): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
}

function eyes(ctx: Ctx, y: number, spread: number, r: number, color: string): void {
  circle(ctx, -spread, y, r, color);
  circle(ctx, spread, y, r, color);
}

/**
 * `facing` is +1 when the enemy is below this fighter and -1 when above; it
 * points weapons and claws at the opponent.
 */
function drawArchetype(ctx: Ctx, def: SpriteDef, facing: number): void {
  const { palette: p, archetype } = def;
  const f = facing;

  switch (archetype) {
    case "knight": {
      poly(ctx, [[-0.30, 0.85], [-0.42, -0.10], [0.42, -0.10], [0.30, 0.85]], p.primary);
      box(ctx, 0, 0.32, 0.66, 0.18, p.secondary);
      poly(ctx, [[-0.62, -0.06], [-0.28, -0.22], [-0.28, 0.14]], p.secondary);
      poly(ctx, [[0.62, -0.06], [0.28, -0.22], [0.28, 0.14]], p.secondary);
      circle(ctx, 0, -0.44, 0.30, p.skin);
      poly(ctx, [[-0.32, -0.52], [0.32, -0.52], [0.30, -0.30], [-0.30, -0.30]], p.primary);
      box(ctx, 0, -0.38, 0.52, 0.10, "#0b0f18");
      eyes(ctx, -0.38, 0.12, 0.045, p.eye);
      // Sword: blade toward the enemy, hilt at the shoulder.
      box(ctx, 0.56, 0.05 + f * 0.10, 0.10, 0.16, p.trim);
      poly(
        ctx,
        [
          [0.50, 0.05 + f * 0.16],
          [0.62, 0.05 + f * 0.16],
          [0.62, 0.05 + f * 0.78],
          [0.56, 0.05 + f * 0.94],
          [0.50, 0.05 + f * 0.78],
        ],
        "#dfe7f5",
      );
      break;
    }
    case "mage": {
      poly(ctx, [[-0.40, 0.88], [-0.22, -0.34], [0.22, -0.34], [0.40, 0.88]], p.primary);
      poly(ctx, [[-0.34, -0.20], [0.34, -0.20], [0.00, -0.86]], p.secondary);
      circle(ctx, 0, -0.34, 0.22, "#101522");
      eyes(ctx, -0.34, 0.10, 0.05, p.trim);
      box(ctx, -0.52, 0.10, 0.06, 1.20, p.secondary);
      circle(ctx, -0.52, -0.52, 0.16, p.trim);
      circle(ctx, -0.52, -0.52, 0.08, "#ffffff");
      break;
    }
    case "beast": {
      poly(ctx, [[-0.46, 0.86], [-0.52, -0.06], [0.52, -0.06], [0.46, 0.86]], p.primary);
      circle(ctx, 0, -0.34, 0.34, p.primary);
      poly(ctx, [[-0.34, -0.52], [-0.10, -0.44], [-0.30, -0.90]], p.secondary);
      poly(ctx, [[0.34, -0.52], [0.10, -0.44], [0.30, -0.90]], p.secondary);
      eyes(ctx, -0.36, 0.14, 0.06, "#ff5b5b");
      poly(ctx, [[-0.14, -0.18], [0.14, -0.18], [0.00, -0.02]], "#ffffff");
      // Claws reach past the body toward the opponent, clear of the face.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          const x = side * (0.42 + i * 0.10);
          poly(
            ctx,
            [
              [x - 0.04, 0.10 + f * 0.30],
              [x + 0.04, 0.10 + f * 0.30],
              [x, 0.10 + f * 0.62],
            ],
            "#f2f5ff",
          );
        }
      }
      break;
    }
    case "golem": {
      box(ctx, 0, 0.36, 0.92, 0.86, p.primary);
      box(ctx, 0, -0.32, 0.66, 0.52, p.secondary);
      box(ctx, -0.62, 0.16, 0.28, 0.62, p.primary);
      box(ctx, 0.62, 0.16, 0.28, 0.62, p.primary);
      eyes(ctx, -0.32, 0.16, 0.07, p.trim);
      box(ctx, -0.20, 0.30, 0.20, 0.20, p.trim);
      box(ctx, 0.24, 0.52, 0.16, 0.16, p.secondary);
      break;
    }
    case "rogue": {
      poly(ctx, [[-0.44, 0.88], [-0.20, -0.28], [0.20, -0.28], [0.44, 0.88]], p.secondary);
      poly(ctx, [[-0.26, 0.86], [-0.14, -0.24], [0.14, -0.24], [0.26, 0.86]], p.primary);
      circle(ctx, 0, -0.42, 0.26, "#141a28");
      poly(ctx, [[-0.30, -0.48], [0.30, -0.48], [0.00, -0.78]], p.secondary);
      eyes(ctx, -0.42, 0.11, 0.045, p.trim);
      for (const side of [-1, 1]) {
        poly(
          ctx,
          [
            [side * 0.42, 0.02],
            [side * 0.52, 0.02],
            [side * 0.47, 0.02 + f * 0.52],
          ],
          "#e6edfa",
        );
      }
      break;
    }
    case "wisp": {
      circle(ctx, 0, 0.10, 0.46, p.secondary);
      circle(ctx, 0, 0.10, 0.32, p.primary);
      circle(ctx, 0, 0.10, 0.16, "#ffffff");
      ctx.strokeStyle = p.trim;
      ctx.lineWidth = 0.05;
      for (const r of [0.62, 0.78]) {
        ctx.beginPath();
        ctx.ellipse(0, 0.10, r, r * 0.34, 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 3; i += 1) {
        circle(ctx, (i - 1) * 0.26, 0.10 + f * 0.72, 0.07, p.trim);
      }
      break;
    }
    case "warden": {
      poly(ctx, [[-0.34, 0.86], [-0.40, -0.16], [0.40, -0.16], [0.34, 0.86]], p.primary);
      circle(ctx, 0, -0.44, 0.28, p.skin);
      poly(ctx, [[-0.30, -0.50], [0.30, -0.50], [0.26, -0.28], [-0.26, -0.28]], p.secondary);
      eyes(ctx, -0.40, 0.11, 0.045, p.eye);
      // Tower shield on one side, halberd on the other.
      poly(
        ctx,
        [[0.34, -0.30], [0.78, -0.18], [0.78, 0.52], [0.34, 0.66]],
        p.secondary,
      );
      poly(ctx, [[0.44, -0.10], [0.68, -0.02], [0.68, 0.40], [0.44, 0.48]], p.trim);
      box(ctx, -0.56, 0.10, 0.06, 1.30, "#7b5a3a");
      poly(
        ctx,
        [
          [-0.62, 0.10 + f * 0.58],
          [-0.50, 0.10 + f * 0.58],
          [-0.56, 0.10 + f * 0.92],
        ],
        "#dfe7f5",
      );
      break;
    }
    case "reaper": {
      poly(ctx, [[-0.48, 0.90], [-0.24, -0.40], [0.24, -0.40], [0.48, 0.90]], p.secondary);
      poly(ctx, [[-0.30, -0.26], [0.30, -0.26], [0.00, -0.88]], p.primary);
      circle(ctx, 0, -0.40, 0.20, "#05070d");
      eyes(ctx, -0.42, 0.09, 0.05, "#8affd8");
      box(ctx, 0.52, 0.06, 0.05, 1.40, "#3a2f28");
      poly(
        ctx,
        [
          [0.52, 0.06 + f * 0.70],
          [0.20, 0.06 + f * 0.94],
          [0.36, 0.06 + f * 0.64],
          [0.52, 0.06 + f * 0.52],
        ],
        "#dfe7f5",
      );
      break;
    }
  }
}

/** Scratch layers, keyed by pixel size and reused across frames. */
const scratch = new Map<number, Canvas>();

function scratchCanvas(size: number): Canvas {
  let canvas = scratch.get(size);
  if (!canvas) {
    canvas = createCanvas(size, size);
    scratch.set(size, canvas);
  }
  return canvas;
}

export interface DrawSpriteOptions {
  /** Pixel width/height of the sprite box. */
  size: number;
  /** +1 when the opponent is below, -1 when above. */
  facing: 1 | -1;
  /** 0..1 white overlay for the damage flash. */
  flash?: number;
  /** 0..1 extra glow, used while an attack buff is active. */
  glow?: number;
}

/**
 * Draws a sprite centred on the current origin. The sprite is composed on its
 * own layer so the damage flash can be masked to the silhouette instead of
 * washing out the whole frame.
 */
export function drawSprite(ctx: Ctx, def: SpriteDef, opts: DrawSpriteOptions): void {
  const { size, facing } = opts;
  const flash = opts.flash ?? 0;
  const glow = opts.glow ?? 0;
  // 1.5x box so weapons and horns reaching past the body are not clipped.
  const boxSize = Math.round(size * 1.5);
  const layer = scratchCanvas(boxSize);
  const lc = layer.getContext("2d");

  lc.clearRect(0, 0, boxSize, boxSize);
  lc.save();
  lc.translate(boxSize / 2, boxSize / 2);
  lc.scale(size / 2, size / 2);
  lc.lineJoin = "round";
  drawArchetype(lc, def, facing);
  lc.restore();

  if (flash > 0) {
    lc.save();
    lc.globalCompositeOperation = "source-atop";
    lc.fillStyle = `rgba(255,255,255,${Math.min(1, flash).toFixed(3)})`;
    lc.fillRect(0, 0, boxSize, boxSize);
    lc.restore();
  }

  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = def.palette.trim;
    ctx.shadowBlur = 40 * glow;
  }
  ctx.drawImage(layer, -boxSize / 2, -boxSize / 2);
  ctx.restore();
}
