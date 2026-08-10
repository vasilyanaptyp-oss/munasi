# munasi

Generates short vertical battle videos — two fighters, 1080x1920, 30fps, ready
for TikTok/Shorts.

The default format is a gauntlet: one worker against three bosses, one at a
time, carrying their health between rounds. The pipeline simulates the run,
scores how dramatic it was, keeps the best of 500 seeds, renders it to frames,
and muxes it into an mp4 with sound. `--duel` runs the original one-on-one
format instead.

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
| `pnpm diagnose` | drama distribution, side-bias check (`--comeback` for the prototype) |
| `pnpm calibrate:gauntlet` | gauntlet balance table (`--solve`, `--variance`) |
| `pnpm test` / `pnpm typecheck` | tests and types |
| `pnpm motion out/samples/*.mp4` | how much a finished video actually moves |
| `pnpm smoke` | one video end to end on the shipped path, then rebuilt from its manifest row |

`generate` skips pairs already in the manifest, so running it again continues
where the last batch left off. `--redo` starts from the top, `--seeds N`
changes how many seeds are searched per matchup, `--workers N` sets render
parallelism, `--keep-frames` leaves the intermediate PNGs behind.

The video opens cold by default: 30 frames of the fight's most arresting moment
from the **last** round, then a cut back to the real beginning. `--no-cold-open`
posts the straight cut instead, so you can put both versions of a matchup up and
compare watch time; the window chosen and the reason go into `manifest.json`.
The window can never contain a killing blow or come from the last 20% of the
fight — spoiling the ending costs more retention than a slow opening.

`--pick=0,33,66,99` selects matchups by index instead of taking the next few in
order, which is how `out/samples/` was cut.

## How it fits together

```
src/sim/       simulation and drama scoring — pure, no rendering, no I/O
src/render/    snapshots -> PNG frames (@napi-rs/canvas), single or multi-process
src/export/    frames + synthesised audio -> mp4 (ffmpeg)
src/content/   the roster, its calibration, and balance tooling
src/cli/       generate, frame preview, motion, smoke, progress, manifest, provenance
```

**Determinism is the contract.** All randomness flows through a seeded
mulberry32 stream, so a `(matchup, seed)` pair always replays the same fight,
and a frame renders the same bytes no matter what was rendered before it — which
is what lets frames be split across worker processes. Checked end to end rather
than assumed: a shipped sample regenerated from its manifest row came back
byte-identical, container and all.

**A manifest row records the constants, not just the seed.** A seed and a
matchup replay a different fight the moment a tuning number moves, and nothing
in the row used to say which numbers were in force. Every row now carries a
`provenance` block: the commit, a hash of `fighters.json`, the seed budget and
the ending the search was asked for, and a snapshot of every constant the bytes
depend on. `dirty: true` means the tree had uncommitted changes and the commit
is a hint rather than a key.

**The gauntlet is selected to a band, not to a maximum.** Scoring a run by how
little the winner had left is monotone, and searching 400 seeds under it drove
every shipped video to a 1 HP finish — median 0.1% of pool, every one of them
under 5%. The score now peaks on a 2-12% margin and falls away outside it;
shipped runs measure a 6.6% median with all twelve inside the band. The batch
also asks every third video to end with the team winning, so a feed is not all
of one shape.

**Drama is selected, not authored.** A random fight is almost always boring, so
`findBestMatch` simulates 500 seeds (~350ms) and keeps the one that scores
highest on closeness, lead changes, comebacks, pacing and how late the outcome
stayed in doubt.

**Nothing stands still — measured on the mp4, not on the layout.** Fighters
carry positions in the simulation and move: close, strike, fall back, slide
sideways. The camera pans after the midpoint between them and zooms to their
spread. `src/export/motion.ts` decodes the delivered file and counts how many
pixels change per frame; `motion.test.ts` fails under 8%, or over 5% of frames
static. The reference channel measures 12.7% and 0%; before
fighters had positions this project managed 3.0-4.9% with 9-27% of frames
frozen, and no geometry rule could see it.

The gate reads the whole file, not a window. The body has to clear those
thresholds; the file as a whole may hold no more still frames than the closing
death hold and winner card account for — 60, and the sixty-first fails the
build. That allowance is what makes a deliberate pause distinguishable from a
regression, and it replaced a six-second window from the middle that could not
see the closing stretch at all: shipped videos measure 6.7-7.7% changed with
22-30% static there, numbers that fail the gate, on files that passed it.

**Nothing stands still in the event stream either.** `src/sim/tempo.ts` measures the longest stretch of a
finished video with no visible event, and `tempo.test.ts` fails the build over
1.2 seconds. Every breach turned out to sit at a round change rather than inside
a round, so the fix was to compress the pause — rounds now open on a short first
cooldown — not to paper over it with effects.

**The roster is balanced by construction.** Fighter `attack` values are solved
for, not hand-written: see `src/content/calibrate.ts`. Every pair currently sits
inside 35-65% (tightest 38-62%) over 500 matches per pair, with a mean match
length of 26.8s.

Project rules and the reasoning behind the combat model live in
[CLAUDE.md](./CLAUDE.md) — read that before changing anything in `src/sim/`.

## Art and audio

Every fighter has its own drawing function in `src/render/fighters/` — its own
silhouette, a signature prop readable at thumbnail size, its own idle tell, its
own wind-up and its own death. The roster is a plumber, a night baker, a
courier and a market loader against a supreme arbiter, a privy councillor, an
eternal inspector and a committee chairman; the joke is in the pairing, and it
lands in the title before the fight starts.

`silhouette.test.ts` keeps them apart by measurement, not by eye: each fighter
is rendered as a solid mask at a common height and every pair must score under
0.70 intersection-over-union. The shipped roster's worst pair is 0.663.

Shape is not enough on a phone, so two more rules back it up. Every fighter is
traced with a 4px dark keyline, which stops a figure dissolving into the flat
blue field or into the figure it overlaps. And the two sides of a round must
differ in mean lightness by at least 60 of 255 — workers are light (174-212),
bosses are dark (73-99), and `layout.test.ts` lists any pair that breaks it.

Every fighter also recoils when hit — knocked back and squashed — applied by the
renderer rather than by each fighter's art, so it lands even on the ones whose
idle is deliberately still.

The arena itself is a constant: a fixed square at a fixed place with a fixed
border. The pair is staged in depth rather than on one floor — the boss stands
on the lower line, drawn 12% larger and in front; the challenger stands higher
up and smaller.

Width, not the floor, is what limits how big they get: a fighter 30% of frame
height is 430-590px wide, and two of those do not fit clear of each other in a
924px arena. Measured over 12,067 frames of the shipped render path, the far
fighter runs 20.2-31.8% of frame height and the near one 23.0-37.3%, averaging
29.5%; the hard floor is 19% and no frame goes under it. The pair's boxes do
cross — in every one of the 36 pairings at some point — because they close and
break apart, and on the approach the silhouettes have to overlap. Depth and the
4px keyline are what keep them readable, not separation.

Nothing is loaded from disk — no third-party images, no real people, no
borrowed franchises. To use your own sound, drop 16-bit 44.1kHz WAVs into
`assets/audio/` under the names listed there; existing files are never
overwritten.
