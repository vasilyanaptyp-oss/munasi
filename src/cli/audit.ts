import { basename, dirname, join } from "node:path";
import { auditVideo, type AuditResult, type Finding } from "../export/audit.js";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { simulateGauntlet } from "../sim/gauntlet.js";
import { coldOpenPlan, defaultPlan, sourceFrames } from "../render/framePlan.js";
import { findGauntletColdOpen } from "../sim/coldOpen.js";
import { VICTORY_CARD_FRAMES } from "../render/framePlan.js";
import { isMain } from "../util/main.js";
import { readManifest, type ManifestEntry } from "./manifest.js";

/**
 * Independent frame-by-frame audit of shipped videos:
 *
 *   pnpm audit out/samples/*.mp4
 *
 * Two halves that are kept apart on purpose.
 *
 * The first reads the mp4 and nothing else: where the fighters are, when they
 * touch, when a damage number appears, when somebody flashes white. It knows
 * nothing about the simulation, which is the only way it can disagree with it.
 *
 * The second rebuilds the match from its manifest row — seed plus matchup, the
 * same path `pnpm smoke` reproduces bytes with — and lines the two up. Three
 * things fall out that no existing gate can see:
 *
 * - the simulation dealt damage and **no number reached the screen**;
 * - a number is on screen with **no event behind it**;
 * - two photographs plainly collided and neither side recorded anything.
 *
 * The registration complaint has come back three times in this project, and
 * each time it was chased with a script that read `result.events` — which can
 * only ever confirm the simulation agrees with itself.
 */

/** Frames of slack when lining a video number up with a simulation event. */
const ALIGN = 8;

/** Event types that put a number on the screen. */
const DAMAGE_EVENTS = new Set<string>(["hit", "crit", "aoe", "minion_hit"]);

interface Cross {
  /** Simulation hits with no number on screen anywhere near them. */
  unseen: { frame: number; actorId: string; targetId: string; value: number }[];
  /** Numbers on screen with no simulation event behind them. */
  unexplained: number[];
  simHits: number;
  seenHits: number;
}

function findEntry(file: string): ManifestEntry | undefined {
  const manifest = readManifest(dirname(file));
  return manifest.entries.find((e) => basename(e.file) === basename(file));
}

/** Simulation hit frames, in output-frame numbers. */
export function simulationHits(entry: ManifestEntry): {
  frame: number;
  actorId: string;
  targetId: string;
  value: number;
}[] {
  const roster = loadFighters();
  const g = entry.gauntlet;
  if (!g) return [];
  const config = buildGauntlet(
    getFighter(g.challengerId, roster),
    g.teamIds.map((id) => getFighter(id, roster)),
  );
  const result = simulateGauntlet(config, entry.seed, GAUNTLET_RULES);
  const window = entry.coldOpen ? findGauntletColdOpen(result) : null;
  const plan = window
    ? coldOpenPlan(result, window, VICTORY_CARD_FRAMES)
    : defaultPlan(result, VICTORY_CARD_FRAMES);
  const sources = sourceFrames(plan);

  // A simulation frame can be shown more than once — the cold open replays a
  // stretch — so an event maps to every output frame that shows it.
  const outputOf = new Map<number, number[]>();
  for (const [output, source] of sources.entries()) {
    const list = outputOf.get(source);
    if (list) list.push(output);
    else outputOf.set(source, [output]);
  }

  const hits: { frame: number; actorId: string; targetId: string; value: number }[] = [];
  for (const event of result.events) {
    // **A crit is a damage number too.** Filtering on `"hit"` alone reported 94
    // numbers "with no event behind them" across the batch — every one of them
    // a crit, and the fault entirely in the filter. `aoe` draws a number as
    // well; anything else in `EventType` does not.
    if (!DAMAGE_EVENTS.has(event.type) || event.value <= 0) continue;
    for (const output of outputOf.get(event.frame) ?? []) {
      hits.push({ frame: output, actorId: event.actorId, targetId: event.targetId, value: event.value });
    }
  }
  return hits.sort((a, b) => a.frame - b.frame);
}

export function crossCheck(
  audit: AuditResult,
  sim: { frame: number; actorId: string; targetId: string; value: number }[],
): Cross {
  const seen = audit.hits.map((h) => h.frame);
  const used = new Set<number>();
  const unseen: Cross["unseen"] = [];
  for (const hit of sim) {
    // Several fighters can be hit on one frame — a collision damages both — and
    // the two numbers appear side by side, so a video number may answer for
    // more than one event. Matched greedily by nearest unused number, then by
    // any number in the window.
    const near = seen.filter((f) => Math.abs(f - hit.frame) <= ALIGN);
    const fresh = near.find((f) => !used.has(f));
    if (fresh !== undefined) used.add(fresh);
    else if (near.length === 0) unseen.push(hit);
  }
  const unexplained = seen.filter((f) => !sim.some((h) => Math.abs(h.frame - f) <= ALIGN));
  return { unseen, unexplained, simHits: sim.length, seenHits: seen.length };
}

const LABEL: Record<Finding["kind"], string> = {
  no_registration: "сближение без числа (смотреть глазом)",
  number_without_contact: "число ни при ком",
  number_outside_arena: "число за стеной",
  figure_outside_arena: "боец за стеной",
  clipping: "фигуры друг в друге",
  figure_lost: "боец не найден",
};

export function report(audit: AuditResult, cross: Cross | null): string {
  const lines: string[] = [];
  const secs = audit.frames / audit.fps;
  lines.push(`${basename(audit.file)}  ${audit.frames} кадров (${secs.toFixed(1)}с)`);
  lines.push(
    `  видно: ${audit.hits.length} чисел, ${audit.contacts.length} контактов, ` +
      `${audit.flashes.length} вспышек; обе фигуры читаются на ${audit.readable} кадрах`,
  );
  if (cross) {
    lines.push(
      `  симуляция: ${cross.simHits} ударов; на экране ${cross.seenHits} чисел; ` +
        `не долетело ${cross.unseen.length}, без события ${cross.unexplained.length}`,
    );
    for (const h of cross.unseen.slice(0, 8)) {
      lines.push(
        `    НЕ ВИДНО  кадр ${h.frame} (${(h.frame / audit.fps).toFixed(2)}с)  ` +
          `${h.actorId} -> ${h.targetId} на ${h.value}`,
      );
    }
    if (cross.unseen.length > 8) lines.push(`    ... ещё ${cross.unseen.length - 8}`);
    for (const f of cross.unexplained.slice(0, 8)) {
      lines.push(`    БЕЗ ПРИЧИНЫ  кадр ${f} (${(f / audit.fps).toFixed(2)}с)`);
    }
    if (cross.unexplained.length > 8) lines.push(`    ... ещё ${cross.unexplained.length - 8}`);
  }

  if (audit.findings.some((f) => f.kind === "no_registration")) {
    lines.push(
      "  (сближение ловится слиянием пятен, и плюс HP между бойцами их склеивает —" +
        " такую находку проверяй кадром, а не числом)",
    );
  }

  const byKind = new Map<Finding["kind"], Finding[]>();
  for (const f of audit.findings) {
    const list = byKind.get(f.kind);
    if (list) list.push(f);
    else byKind.set(f.kind, [f]);
  }
  if (byKind.size === 0) lines.push("  ошибок по кадрам нет");
  for (const [kind, list] of byKind) {
    lines.push(`  ${LABEL[kind]}: ${list.length}`);
    for (const f of list.slice(0, 5)) {
      lines.push(`    кадр ${f.frame} (${f.seconds.toFixed(2)}с)  ${f.detail}`);
    }
    if (list.length > 5) lines.push(`    ... ещё ${list.length - 5}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((a) => a.endsWith(".mp4"));
  if (files.length === 0) {
    console.log("usage: pnpm audit <video.mp4> [more.mp4 ...]");
    return;
  }
  for (const file of files) {
    process.stdout.write(`разбираю ${basename(file)}...\r`);
    const audit = await auditVideo(file);
    process.stdout.write(" ".repeat(60) + "\r");
    const entry = findEntry(file);
    let cross: Cross | null = null;
    if (entry) {
      try {
        cross = crossCheck(audit, simulationHits(entry));
      } catch (error) {
        console.log(`  (симуляцию поднять не удалось: ${(error as Error).message})`);
      }
    }
    console.log(report(audit, cross));
    console.log();
  }
}

if (isMain(import.meta.url)) void main();

export { join };
