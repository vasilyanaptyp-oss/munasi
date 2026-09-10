import { createCanvas, loadImage } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegBin } from "../util/tools.js";
import { FLASH_SHARE, readFrame, type FrameRead } from "./frameAudit.js";
import { measureFrame, MAX_FRAMES, MEASURE_WIDTH } from "./measure.js";

/**
 * Frame-by-frame audit of a finished video.
 *
 * Reads every frame off the pixels alone — see `frameAudit.ts` for why that
 * matters — turns them into visible events, and reports the frames where what
 * is on screen does not add up. The simulation is compared against these
 * findings by the caller; nothing in this file consults it.
 */

/**
 * The window around a visible contact in which its number counts as its number.
 *
 * **Asymmetric, and that is the whole point.** The number is drawn on the frame
 * the simulation resolves the blow; the two photographs only *look* merged a
 * few frames later, once they have travelled into each other far enough for the
 * pixels to touch. Looking two frames back and six forward reported 42
 * "contacts with no number" across the batch — and frame 69 of
 * `boxer-vs-glasses-359`, the first of them, has "-41", "-79" and "-78" on it,
 * the last two already fading. The numbers were not missing, they were early.
 */
export const HIT_BEFORE = 12;
export const HIT_AFTER = 6;
/** Overlap share that counts as "these two are touching". */
/** Frames the pair may stay merged before it reads as stuck rather than as a
 * blow — 0.4s, the same window the simulation uses to stop counting a fighter
 * pushed off a wall as a fresh approach. */
export const STUCK_FRAMES = 12;

/**
 * An arena rectangle is only believed when it is at least this much of the
 * frame tall.
 *
 * The detector finds the arena by looking for rows carrying a long black run,
 * and on the closing frames — where the winner freeze dims the picture — it
 * collapses to a 23px band. Judged against that, a number in the middle of the
 * arena reads as "outside the walls". A tool that reports its own degenerate
 * frames as defects in the video stops being read, which this project has
 * already paid for once.
 */
const ARENA_MIN_SHARE = 0.35;

export type FindingKind =
  | "no_registration"
  | "number_without_contact"
  | "number_outside_arena"
  | "figure_outside_arena"
  | "clipping"
  | "figure_lost";

export interface Finding {
  kind: FindingKind;
  frame: number;
  seconds: number;
  detail: string;
}

export interface VisibleHit {
  frame: number;
  x: number;
  y: number;
}

export interface AuditResult {
  file: string;
  frames: number;
  fps: number;
  /** Frames on which a damage number first appeared. */
  hits: VisibleHit[];
  /** Frames on which the two figures started touching. */
  contacts: number[];
  /** Frames on which somebody was drawn as a white silhouette. */
  flashes: number[];
  findings: Finding[];
  /** Frames where two figures were found at all — the rest cannot be judged. */
  readable: number;
}

/** Decodes the video and reads every frame. */
export async function readVideo(file: string, fps = 30): Promise<FrameRead[]> {
  const dir = mkdtempSync(join(tmpdir(), "munasi-audit-"));
  try {
    execFileSync(
      ffmpegBin(),
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
    const names = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    if (names.length === 0) throw new Error(`${file}: ffmpeg produced no frames`);
    const reads: FrameRead[] = [];
    let previous: Uint8ClampedArray | null = null;
    for (const name of names) {
      const image = await loadImage(join(dir, name));
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, image.width, image.height);
      reads.push(
        readFrame(measureFrame(data, image.width, image.height, previous), data, image.width, image.height),
      );
      previous = data;
    }
    return reads;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Distance between two points. */
const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** Gap between two boxes, 0 when they overlap. */
const boxGap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number =>
  Math.hypot(
    Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)),
    Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)),
  );

/** Distance from a point to the nearest edge of a box, 0 when inside it. */
const boxDistance = (x: number, y: number, b: { x: number; y: number; w: number; h: number }): number =>
  Math.hypot(Math.max(0, b.x - x, x - (b.x + b.w)), Math.max(0, b.y - y, y - (b.y + b.h)));

/**
 * Turns read frames into visible events and findings.
 *
 * Split out from `readVideo` so it can be driven by synthetic frames in a test
 * — a detector that has only ever been run on real footage has no known answer
 * to be checked against, and this project has shipped three measuring tools
 * that were quietly wrong about exactly that.
 */
export function auditFrames(reads: FrameRead[], file: string, fps = 30): AuditResult {
  const frameHeight = Math.max(
    1,
    ...reads.map((r) => (r.arena ? r.arena.bottom : 0)),
  );
  /** The arena, when it is worth believing on this frame. */
  const wallsOf = (read: FrameRead): { top: number; bottom: number } | null =>
    read.arena && read.arena.bottom - read.arena.top > frameHeight * ARENA_MIN_SHARE
      ? read.arena
      : null;
  const findings: Finding[] = [];
  const hits: VisibleHit[] = [];
  const contacts: number[] = [];
  const flashes: number[] = [];
  const at = (frame: number): number => frame / fps;
  const add = (kind: FindingKind, frame: number, detail: string): void => {
    findings.push({ kind, frame, seconds: at(frame), detail });
  };

  let touching = false;
  let mergedSince = -1;
  let readable = 0;

  for (const [frame, read] of reads.entries()) {
    const previous = reads[frame - 1];

    // A number counts as *appearing* on the frame where it has no ancestor:
    // damage numbers ride up off the victim for the better part of a second,
    // so counting every frame that has ink counts one hit fifteen times.
    for (const n of read.numbers) {
      const carried = previous?.numbers.some((p) => dist(p.x, p.y, n.x, n.y) < 26) ?? false;
      if (carried) continue;
      hits.push({ frame, x: n.x, y: n.y });

      // Only the horizontal walls are judged. **The arena is wider than the
      // frame and both side walls are never on screen at once**, so the `left`
      // and `right` a pixel detector returns are one visible wall, not the
      // arena's extent — testing against them reported 251 fighters "outside
      // the arena" in a video where nobody ever left it.
      const numberWalls = wallsOf(read);
      if (numberWalls) {
        const { top, bottom } = numberWalls;
        if (n.y < top || n.y > bottom) {
          add("number_outside_arena", frame, `число на y=${n.y.toFixed(0)}, стены ${top}-${bottom}`);
        }
      }
      // A number belongs to the fighter it came off. One floating in open blue
      // is the "hitting the air" complaint, seen from the viewer's side.
      //
      // Measured to the **box**, not to the centre: a fighter is two and a bit
      // times taller than he is wide, so a radius drawn from his middle reaches
      // half the arena sideways and calls anything there his.
      const owner = read.figures.some((f) => boxDistance(n.x, n.y, f) < f.h * 0.6);
      if (!owner && read.figures.length > 0) {
        add("number_without_contact", frame, `число ни при одном бойце (${n.x.toFixed(0)}, ${n.y.toFixed(0)})`);
      }
    }

    if (read.flashes.some((s) => s >= FLASH_SHARE)) flashes.push(frame);

    // **Contact is two photographs becoming one blob, not two boxes
    // overlapping.** The simulation collides on the silhouette contour read out
    // of the PNG's alpha, and a bounding box overlaps long before the outlines
    // touch — measured on a shipped video, box overlap reported 33 contacts
    // against 25 hits and produced seventeen "a contact with no number" that
    // were simply not contacts. A flood fill merges exactly when the pixels are
    // adjacent, which is the same standard the simulation uses, arrived at
    // independently.
    if (read.figures.length === 2) readable += 1;

    // A merge is one blob **bigger than either of the two it replaced**. Two
    // going to one also happens when somebody dies and is taken off the arena,
    // and without the size test the closing seconds of every video read as one
    // long collision — measured: a "figures stuck together for 0.4s" finding at
    // 19.57s of a 20.5s fight, which is the winner standing alone.
    const before = previous?.figures ?? [];
    const only = read.figures[0];
    // **And the two have to have been next to each other the frame before.**
    // A fighter carries a thrown prop across the arena, and the prop merging
    // with its owner is one blob bigger than he is — which read as a collision
    // while the other fighter was standing at the far wall. Frame 227 of
    // `boxer-vs-bodyguard-288` is that picture exactly: a boxer with his glove
    // beside him and a bodyguard a full arena away.
    const gap =
      before.length === 2 ? boxGap(before[0]!, before[1]!) : Number.POSITIVE_INFINITY;
    const reach = before.length === 2 ? Math.max(before[0]!.h, before[1]!.h) * 0.35 : 0;
    const merged =
      read.figures.length === 1 &&
      before.length === 2 &&
      only !== undefined &&
      gap <= reach &&
      only.w * only.h > Math.max(before[0]!.w * before[0]!.h, before[1]!.w * before[1]!.h) * 1.25;
    const stillMerged = read.figures.length === 1 && touching;
    if (merged && !touching) {
      contacts.push(frame);
      touching = true;
      mergedSince = frame;
    } else if (!stillMerged && read.figures.length === 2) {
      touching = false;
      mergedSince = -1;
    }
    if (touching && mergedSince >= 0 && frame - mergedSince === STUCK_FRAMES) {
      add("clipping", frame, `фигуры слиты в одну уже ${STUCK_FRAMES} кадров (${(STUCK_FRAMES / fps).toFixed(2)}с)`);
    }

    if (read.figures.length === 0 && wallsOf(read)) {
      add("figure_lost", frame, "внутри арены не найдено ни одной фигуры");
    }

    const walls = wallsOf(read);
    if (walls) {
      const { top, bottom } = walls;
      for (const f of read.figures) {
        if (f.y + f.h < top || f.y > bottom) {
          add("figure_outside_arena", frame, `боец на y=${f.y}..${f.y + f.h}, стены ${top}-${bottom}`);
        }
      }
    }

    // **The HP plus deliberately produces no findings.** It is found as a solid
    // white blob, and it drains dark grey from the top — so below about half
    // health the detector loses it, and its absence carries no information at
    // all. Judged anyway, it reported 32 "a plus over nobody" across the batch,
    // every one of them a half-empty plus rather than a misplaced one.
  }

  // The registration question itself: two photographs plainly touched and no
  // number came off either of them.
  //
  // **This is a suspicion, not a verdict, and the report says so.** Contact is
  // read as two blobs becoming one, and three separate things merge blobs
  // without being a collision: a fighter and his own thrown prop, a fighter and
  // the frame edge, and — the one that survives every threshold — the HP plus
  // of one fighter standing between the two and bridging them. Frame 373 of
  // `boxer-vs-bodyguard-288` is the third: the plus reading 560 sits against
  // the boxer's trousers with the bodyguard hanging off it.
  //
  // The threshold could be tuned until this reads zero. It is not, because the
  // number that answers "did it register" does not come from here at all — it
  // comes from lining the video's numbers up against the simulation's events,
  // and that one is exact.
  for (const contact of contacts) {
    const landed = hits.some((h) => h.frame >= contact - HIT_BEFORE && h.frame <= contact + HIT_AFTER);
    if (!landed) {
      add(
        "no_registration",
        contact,
        `контакт без числа в окне -${HIT_BEFORE}/+${HIT_AFTER} кадров`,
      );
    }
  }

  findings.sort((x, y) => x.frame - y.frame);
  return { file, frames: reads.length, fps, hits, contacts, flashes, findings, readable };
}

export async function auditVideo(file: string, fps = 30): Promise<AuditResult> {
  return auditFrames(await readVideo(file, fps), file, fps);
}
