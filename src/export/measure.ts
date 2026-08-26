import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * Measures a finished video the way a viewer sees it: from its pixels.
 *
 * **This exists because every geometric gate in the project passed while the
 * picture was wrong.** The arena sat a fifth of a frame lower than the
 * reference's, the wall was a quarter too thin, the caption half again too big,
 * and a card at the end was sliced by the bottom edge — and the gates were all
 * green, because they measured what they were told to measure (nothing
 * overlaps, nothing leaves the frame, the arena does not resize) and not one of
 * them compared the picture with the reference.
 *
 * The only thing that ever found those was pulling frames out of both files and
 * measuring the *same* quantities in each. That was done by hand, in throwaway
 * scripts, six times. This is that, kept.
 *
 * Everything here is read off the pixels and nothing is read off our own
 * simulation, which is the point: a reference video has no events to consult,
 * so any quantity that cannot be recovered from the image cannot be compared.
 */

/** Width frames are normalised to. The reference measurements are all at 576. */
export const MEASURE_WIDTH = 576;

/**
 * Frames pulled per video. Enough to see the camera's whole travel — the
 * reference's arena moves 200-250px over a fight — without decoding minutes of
 * video for a number that settles in a few hundred samples.
 */
const MAX_FRAMES = 900;

const FIELD_BLUE: readonly [number, number, number] = [24, 162, 211];
/** How far a pixel may sit from the field blue and still be the field. */
const BLUE_TOLERANCE = 46;
/** Below this on every channel is the arena's border, or a text stroke. */
const BLACK_LEVEL = 60;
/** Above this on every channel is a keyline, a plus, or a caption. */
const WHITE_LEVEL = 200;

/**
 * A damage number's own colour, in both files: ours is `#ffef4d`, the
 * reference's a paler yellow-green, and one rule has to catch both.
 *
 * **The green channel is what does the work, and the first version of this got
 * it wrong.** It asked for `g > 150`, which Boxer Guy's ochre trousers pass — so
 * yellow was on screen in 850 frames out of 852, the "a number appeared"
 * counter never saw an edge to count, and the tool reported a 24.7-second
 * stretch with no damage in a video the simulation had put 34 blows in. A
 * measuring tool that lies is worse than no tool: it sends you hunting a defect
 * that is not there.
 *
 * `g > 200` is above anything a photograph of a person wears and below both
 * numbers. Checked against the trousers that broke it.
 */
const isYellow = (r: number, g: number, b: number): boolean =>
  g > 200 && r > 150 && b < 120 && (r + g) / 2 - b > 90;

export interface FrameMeasure {
  /** Outer edge of the arena's black border, in normalised pixels. */
  arena: { top: number; bottom: number; left: number; right: number } | null;
  /** Thickness of the border where it is fully on screen. */
  border: number | null;
  blueShare: number;
  blackShare: number;
  whiteShare: number;
  yellowPixels: number;
  /** Pixels that differ from the previous frame, as a share. */
  changed: number;
  /** Centres of the HP plusses, which ride their own fighter. */
  plusses: { x: number; y: number }[];
  /**
   * Height and width of each fighter, in pixels, found under his own plus.
   *
   * "Make the map bigger" and "make the fighters bigger" are the same knob seen
   * from two ends, and this project has three times been wrong about a
   * proportion it eyeballed off a still. So it gets measured in both files by
   * the same code, like everything else.
   */
  figures: { w: number; h: number }[];
}

export interface VideoMeasure {
  file: string;
  frames: number;
  seconds: number;
  /** Median outer height of the arena border, and its spread. */
  arenaHeight: { median: number; min: number; max: number } | null;
  borderThickness: number | null;
  /** Where the arena's top edge sits, as a share of frame height. */
  arenaTop: { median: number; travel: number } | null;
  blueShare: number;
  blackShare: number;
  whiteShare: number;
  /** Distinct appearances of a damage number, per second. */
  numbersPerSecond: number;
  /** Longest stretch with no number on screen, in seconds. */
  worstGap: number;
  /** Median share of pixels that change from one frame to the next. */
  motion: number;
  /**
   * How far a fighter travels per frame, in arena widths, tracked by his own HP
   * plus. This is the number "they move too fast" is about, and the only way to
   * read it off a reference is through the plus.
   */
  speed: { median: number; p90: number } | null;
  /** Median fighter height as a share of the arena's inner height, and of the frame. */
  figureHeight: { ofArena: number; ofFrame: number; aspect: number } | null;
  /** Share of frames that change almost nothing. */
  staticShare: number;
}

/** The value at `q` of the way through, for a robust range. */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Longest run of `true` in a row or column.
 *
 * The arena's border is the only thing in the frame that draws a black line
 * hundreds of pixels long. Looking for *any* black pixel finds the title as
 * well — it is stroked in black — and reports an arena the size of the whole
 * frame, which is exactly what a first attempt at this did.
 */
function longestRun(length: number, solid: (i: number) => boolean): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < length; i += 1) {
    if (solid(i)) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

function measureFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  previous: Uint8ClampedArray | null,
): FrameMeasure {
  const isBlack = (p: number): boolean =>
    data[p]! < BLACK_LEVEL && data[p + 1]! < BLACK_LEVEL && data[p + 2]! < BLACK_LEVEL;

  let blue = 0;
  let black = 0;
  let white = 0;
  let yellow = 0;
  for (let p = 0; p < width * height * 4; p += 4) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    if (
      Math.abs(r - FIELD_BLUE[0]) < BLUE_TOLERANCE &&
      Math.abs(g - FIELD_BLUE[1]) < BLUE_TOLERANCE &&
      Math.abs(b - FIELD_BLUE[2]) < BLUE_TOLERANCE
    ) {
      blue += 1;
    } else if (r < BLACK_LEVEL && g < BLACK_LEVEL && b < BLACK_LEVEL) {
      black += 1;
    } else if (r > WHITE_LEVEL && g > WHITE_LEVEL && b > WHITE_LEVEL) {
      white += 1;
    }
    if (isYellow(r, g, b)) yellow += 1;
  }

  // The arena: rows and columns carrying a long continuous black run.
  const minRun = Math.round(width * 0.35);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    if (longestRun(width, (x) => isBlack((y * width + x) * 4)) < minRun) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x += 1) {
    if (longestRun(height, (y) => isBlack((y * width + x) * 4)) < minRun) continue;
    if (left < 0) left = x;
    right = x;
  }

  // Border thickness, read down the middle of the top edge where nothing else
  // is drawn. Only meaningful when the top edge is on screen.
  let border: number | null = null;
  if (top >= 0) {
    const x = Math.floor(width / 2);
    let run = 0;
    for (let y = top; y < height && isBlack((y * width + x) * 4); y += 1) run += 1;
    border = run > 0 ? run : null;
  }

  let changed = 0;
  if (previous) {
    for (let p = 0; p < width * height * 4; p += 4) {
      const diff =
        Math.abs(data[p]! - previous[p]!) +
        Math.abs(data[p + 1]! - previous[p + 1]!) +
        Math.abs(data[p + 2]! - previous[p + 2]!);
      if (diff > 24) changed += 1;
    }
  }

  // The HP plusses. They are the only large solid-white shapes in the frame and
  // each rides its own fighter, so tracking them is how a fighter's speed is
  // recovered from a video that has no events to consult. Found by flood-filling
  // white and keeping blobs about the size the plus is.
  const plusses: { x: number; y: number }[] = [];
  {
    const isWhite = (p: number): boolean =>
      data[p]! > WHITE_LEVEL && data[p + 1]! > WHITE_LEVEL && data[p + 2]! > WHITE_LEVEL;
    const seen = new Uint8Array(width * height);
    const expected = (76 / 576) * width;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const seed = y * width + x;
        if (seen[seed] || !isWhite(seed * 4)) continue;
        let count = 0;
        let sx = 0;
        let sy = 0;
        let minX = width;
        let maxX = -1;
        const stack = [seed];
        seen[seed] = 1;
        while (stack.length > 0) {
          const q = stack.pop()!;
          const qx = q % width;
          const qy = (q - qx) / width;
          count += 1;
          sx += qx;
          sy += qy;
          if (qx < minX) minX = qx;
          if (qx > maxX) maxX = qx;
          if (count > 40000) break;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = qx + dx;
            const ny = qy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const n = ny * width + nx;
            if (seen[n] || !isWhite(n * 4)) continue;
            seen[n] = 1;
            stack.push(n);
          }
        }
        const span = maxX - minX + 1;
        // A plus, not a caption and not a keyline: about as wide as the
        // reference's 76px and at least half as tall as it is wide.
        if (span > expected * 0.55 && span < expected * 1.7 && count > span * span * 0.35) {
          plusses.push({ x: sx / count, y: sy / count });
        }
      }
    }
  }

  // Each fighter, found by walking down from his own plus.
  //
  // The plus is centred on the figure and sits just above it, so the figure is
  // whatever non-field blob starts under it. Flood-filled rather than
  // row-scanned because a photograph is any colour at all, including the white
  // of a shirt and the black of a suit — the one thing it is never is the
  // field's blue. Blobs that run away (the reference's guitar track is a lit
  // strip of non-blue across half the square) are thrown out by size.
  const figures: { w: number; h: number }[] = [];
  {
    const plusWidth = (76 / 576) * width;
    const isField = (p: number): boolean =>
      Math.abs(data[p]! - FIELD_BLUE[0]) < BLUE_TOLERANCE &&
      Math.abs(data[p + 1]! - FIELD_BLUE[1]) < BLUE_TOLERANCE &&
      Math.abs(data[p + 2]! - FIELD_BLUE[2]) < BLUE_TOLERANCE;
    const capacity = Math.round(width * height * 0.06);
    for (const plus of plusses) {
      const cx = Math.round(plus.x);
      let start = -1;
      for (let y = Math.round(plus.y + plusWidth * 0.55); y < height; y += 1) {
        const p = (y * width + cx) * 4;
        if (!isField(p) && data[p]! + data[p + 1]! + data[p + 2]! > BLACK_LEVEL * 3) {
          start = y;
          break;
        }
        // A gap wider than the plus means the plus has no figure under it.
        if (y > plus.y + plusWidth * 2.2) break;
      }
      if (start < 0) continue;
      const seen = new Uint8Array(width * height);
      const stack = [start * width + cx];
      seen[stack[0]!] = 1;
      let count = 0;
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;
      let ran = false;
      while (stack.length > 0) {
        const q = stack.pop()!;
        const qx = q % width;
        const qy = (q - qx) / width;
        count += 1;
        if (count > capacity) {
          ran = true;
          break;
        }
        if (qx < minX) minX = qx;
        if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy;
        if (qy > maxY) maxY = qy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (seen[n]) continue;
          const np = n * 4;
          if (isField(np)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (ran) continue;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      // A person, not a stray mark and not the wall he is standing against.
      if (h < plusWidth * 0.8 || h > plusWidth * 4 || w < plusWidth * 0.35) continue;
      figures.push({ w, h });
    }
  }

  const pixels = width * height;
  return {
    arena: top >= 0 && left >= 0 ? { top, bottom, left, right } : null,
    border,
    blueShare: blue / pixels,
    blackShare: black / pixels,
    whiteShare: white / pixels,
    yellowPixels: yellow,
    changed: previous ? changed / pixels : 0,
    plusses,
    figures,
  };
}

/** Pulls frames to a scratch directory and measures every one of them. */
export async function measureVideo(file: string, fps = 30): Promise<VideoMeasure> {
  const dir = mkdtempSync(join(tmpdir(), "munasi-measure-"));
  try {
    execFileSync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", file,
        "-vf", `fps=${fps},scale=${MEASURE_WIDTH}:-1`,
        "-frames:v", String(MAX_FRAMES),
        "-pix_fmt", "rgb24",
        join(dir, "f_%05d.png"),
      ],
      { stdio: "ignore" },
    );
    const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    if (files.length === 0) throw new Error(`${file}: ffmpeg produced no frames`);

    const measures: FrameMeasure[] = [];
    let previous: Uint8ClampedArray | null = null;
    for (const name of files) {
      const image = await loadImage(join(dir, name));
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      measures.push(measureFrame(data, image.width, image.height, previous));
      previous = data;
    }

    const height = measures.length > 0 ? Math.round(MEASURE_WIDTH * (1920 / 1080)) : 0;
    const withArena = measures.filter((m) => m.arena !== null);
    const heights = withArena.map((m) => m.arena!.bottom - m.arena!.top);
    const tops = withArena.map((m) => m.arena!.top);
    const borders = measures.map((m) => m.border).filter((b): b is number => b !== null);

    // A number is on screen when there is a run of yellow. Count the moments it
    // appears, not the frames it is up for.
    let showing = false;
    const appearances: number[] = [];
    measures.forEach((m, i) => {
      const now = m.yellowPixels > 40;
      if (now && !showing) appearances.push(i);
      showing = now;
    });
    const marks = [0, ...appearances, measures.length];
    let worst = 0;
    for (let i = 1; i < marks.length; i += 1) {
      worst = Math.max(worst, (marks[i]! - marks[i - 1]!) / fps);
    }

    // The real duration, not the sampled one: the frame cap is there to keep
    // this quick, and reporting the capped length as the video's length made
    // four different files all read 14.0s.
    let seconds = measures.length / fps;
    try {
      const probed = execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
        { encoding: "utf8" },
      ).trim();
      if (Number.isFinite(Number(probed))) seconds = Number(probed);
    } catch {
      // ffprobe missing is not worth failing a measurement over.
    }

    // Fighter speed, from how far each plus moves between frames. Matched
    // nearest-neighbour and thrown away when the count changes or the jump is
    // too big to be travel — a plus leaving the frame must not read as a sprint.
    const arenaWide = median(
      withArena.map((m) => m.arena!.bottom - m.arena!.top),
    ) || MEASURE_WIDTH;
    const steps: number[] = [];
    for (let i = 1; i < measures.length; i += 1) {
      const before = measures[i - 1]!.plusses;
      const now = measures[i]!.plusses;
      if (before.length === 0 || before.length !== now.length) continue;
      for (const a of now) {
        let best = Infinity;
        for (const b of before) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < best) best = d;
        }
        // A quarter of the arena in one frame is a cut, not a fighter.
        if (best < arenaWide * 0.25) steps.push(best / arenaWide);
      }
    }
    const sortedSteps = [...steps].sort((a, b) => a - b);

    // Fighter size, against the arena's *inner* height — the field a fighter
    // actually has to cross — and against the frame, which is the gate's unit.
    const inner = arenaWide - 2 * (borders.length > 0 ? median(borders) : 0);
    const figureHeights = measures.flatMap((m) => m.figures.map((f) => f.h));
    const figureAspects = measures.flatMap((m) => m.figures.map((f) => f.w / f.h));

    const moving = measures.slice(1).map((m) => m.changed);
    return {
      file,
      frames: measures.length,
      seconds,
      arenaHeight:
        heights.length > 0
          ? { median: median(heights), min: Math.min(...heights), max: Math.max(...heights) }
          : null,
      borderThickness: borders.length > 0 ? median(borders) : null,
      arenaTop:
        tops.length > 0
          ? {
              median: median(tops) / (height || 1),
              // **Not max minus min.** The arena's top edge is found as the
              // longest black run in a row, and on a handful of frames — a
              // fighter in a black suit against the wall, a white flash washing
              // the wall out — that lands on the wrong row. One such frame is
              // enough to turn a 0.18 travel into 0.75, which is what it
              // reported for one of four videos whose real travel, read off the
              // layout, was 0.178. The 5th-to-95th spread ignores them.
              travel: (percentile(tops, 0.95) - percentile(tops, 0.05)) / (height || 1),
            }
          : null,
      blueShare: median(measures.map((m) => m.blueShare)),
      blackShare: median(measures.map((m) => m.blackShare)),
      whiteShare: median(measures.map((m) => m.whiteShare)),
      numbersPerSecond: appearances.length / (measures.length / fps),
      worstGap: worst,
      motion: median(moving),
      speed:
        sortedSteps.length > 20
          ? {
              median: median(steps),
              p90: sortedSteps[Math.floor(sortedSteps.length * 0.9)]!,
            }
          : null,
      figureHeight:
        figureHeights.length > 20 && inner > 0
          ? {
              ofArena: median(figureHeights) / inner,
              ofFrame: median(figureHeights) / (height || 1),
              aspect: median(figureAspects),
            }
          : null,
      staticShare: moving.filter((c) => c < 0.005).length / Math.max(1, moving.length),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One row of the comparison table: what it is, and the value per video. */
export interface ComparisonRow {
  label: string;
  values: string[];
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function comparisonRows(measures: VideoMeasure[]): ComparisonRow[] {
  const col = <T>(pick: (m: VideoMeasure) => T): string[] => measures.map((m) => String(pick(m)));
  return [
    { label: "длина", values: col((m) => `${m.seconds.toFixed(1)}с`) },
    { label: "кадров измерено", values: col((m) => `${m.frames}`) },
    {
      label: "рамка арены (px при 576)",
      values: col((m) => (m.arenaHeight ? `${m.arenaHeight.median}` : "—")),
    },
    {
      label: "толщина стены",
      values: col((m) => (m.borderThickness === null ? "—" : `${m.borderThickness}px`)),
    },
    {
      label: "верх арены (доля кадра)",
      values: col((m) => (m.arenaTop ? m.arenaTop.median.toFixed(3) : "—")),
    },
    {
      label: "ход арены по кадру",
      values: col((m) => (m.arenaTop ? m.arenaTop.travel.toFixed(3) : "—")),
    },
    { label: "синего в кадре", values: col((m) => pct(m.blueShare)) },
    { label: "чёрного в кадре", values: col((m) => pct(m.blackShare)) },
    { label: "белого в кадре", values: col((m) => pct(m.whiteShare)) },
    { label: "чисел урона в секунду", values: col((m) => m.numbersPerSecond.toFixed(2)) },
    { label: "худшая пауза без числа", values: col((m) => `${m.worstGap.toFixed(2)}с`) },
    {
      label: "скорость бойца (арен/кадр)",
      values: col((m) => (m.speed ? m.speed.median.toFixed(4) : "—")),
    },
    {
      label: "  она же, быстрые 10%",
      values: col((m) => (m.speed ? m.speed.p90.toFixed(4) : "—")),
    },
    {
      label: "рост бойца (доля арены)",
      values: col((m) => (m.figureHeight ? m.figureHeight.ofArena.toFixed(3) : "—")),
    },
    {
      label: "  он же, доля кадра",
      values: col((m) => (m.figureHeight ? m.figureHeight.ofFrame.toFixed(3) : "—")),
    },
    {
      label: "  ширина/рост бойца",
      values: col((m) => (m.figureHeight ? m.figureHeight.aspect.toFixed(2) : "—")),
    },
    { label: "движение (пикселей за кадр)", values: col((m) => pct(m.motion)) },
    { label: "статичных кадров", values: col((m) => pct(m.staticShare)) },
  ];
}
