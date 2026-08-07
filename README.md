# munasi

Generates short vertical battle videos — two fighters, 1080x1920, 30fps, ready
for TikTok/Shorts.

The pipeline is: simulate a fight, score how dramatic it was, keep the best of
500 seeds, render it to frames, and mux it into an mp4 with sound.

```
pnpm install
pnpm generate --count 20
```

Videos land in `out/`, one row per video in `out/manifest.json`.

## Requirements

- Node 20+ and pnpm
- ffmpeg on `PATH` (`sudo pacman -S ffmpeg`, `sudo apt install ffmpeg`,
  `brew install ffmpeg`)

Nothing else: fighter art is drawn procedurally, and the soundtrack is
synthesised into `assets/audio/` the first time you export.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm generate --count 20` | generate the next 20 matchups |
| `pnpm balance` | winrate matrix for all 66 pairs |
| `pnpm calibrate` | regenerate `fighters.json` from `roster.ts` |
| `pnpm matchups` | list pairs, most even first |
| `pnpm frame [n...]` | render sample frames to `out/preview/` |
| `pnpm test` / `pnpm typecheck` | tests and types |

`generate` skips pairs already in the manifest, so running it again continues
where the last batch left off. `--redo` starts from the top, `--seeds N`
changes how many seeds are searched per matchup, `--workers N` sets render
parallelism, `--keep-frames` leaves the intermediate PNGs behind.

## How it fits together

```
src/sim/       simulation and drama scoring — pure, no rendering, no I/O
src/render/    snapshots -> PNG frames (@napi-rs/canvas), single or multi-process
src/export/    frames + synthesised audio -> mp4 (ffmpeg)
src/content/   the roster, its calibration, and balance tooling
src/cli/       generate, frame preview, progress, manifest
```

**Determinism is the contract.** All randomness flows through a seeded
mulberry32 stream, so a `(matchup, seed)` pair always replays the same fight,
and a frame renders the same bytes no matter what was rendered before it — which
is what lets frames be split across worker processes.

**Drama is selected, not authored.** A random fight is almost always boring, so
`findBestMatch` simulates 500 seeds (~350ms) and keeps the one that scores
highest on closeness, lead changes, comebacks, pacing and how late the outcome
stayed in doubt.

**The roster is balanced by construction.** Fighter `attack` values are solved
for, not hand-written: see `src/content/calibrate.ts`. Every pair currently sits
inside 35-65% (tightest 38-62%) over 500 matches per pair, with a mean match
length of 26.8s.

Project rules and the reasoning behind the combat model live in
[CLAUDE.md](./CLAUDE.md) — read that before changing anything in `src/sim/`.

## Art and audio

Fighters are drawn from code: eight archetypes (knight, mage, beast, golem,
rogue, wisp, warden, reaper) tinted by a hue, addressed as `"mage:265"` in a
fighter's `spriteId`. No third-party images, no real people, no borrowed
franchises. To use your own sound, drop 16-bit 44.1kHz WAVs into
`assets/audio/` under the names listed there; existing files are never
overwritten.
