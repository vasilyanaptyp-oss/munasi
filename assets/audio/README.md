# Audio

The project ships no sound files. On the first export `ensureAudioAssets()`
synthesises everything it needs into this directory:

| File | Used for |
| --- | --- |
| `music-bed.wav` | looped background track |
| `sfx-hit.wav` | normal attacks |
| `sfx-crit.wav` | crits |
| `sfx-death.wav` | a fighter dying |
| `sfx-spawn.wav` | a minion being summoned |
| `sfx-victory.wav` | the winner sting |

To use your own audio, drop a **16-bit PCM mono/stereo WAV at 44100 Hz** in
place of any of these names — an existing file is never overwritten. The
generated `.wav` files are gitignored; the synthesiser regenerates them.
