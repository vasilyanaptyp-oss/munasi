# Props

Photographs an ability puts on screen — an object flying across the arena, or
held at its owner's side. Photographs only: this format does not draw.

To add one, put a photograph on white in `source/` under the name the ability
expects (`ABILITY_PROPS` in `src/render/signatures.ts`) and run `pnpm cutout`.
Props are cut at a looser white threshold than fighters (200 against 236),
because a product shot usually has a soft grey shadow under the object and it
would show on the arena. They are trimmed to 512 px wide; a prop is drawn at
about 250.

## Where each one comes from

Every file here has a recorded source and licence, and only material licensed
for commercial use is used.

| file | source | licence |
| --- | --- | --- |
| `compass.png` | [Wikimedia Commons, `File:Plastic-compass.jpg`](https://commons.wikimedia.org/wiki/File:Plastic-compass.jpg) | Public domain |
| `glasses.png` | photograph by the author | licensed with the software — see `LICENSE`, section 4 |

The included cast uses neither: `compass` belongs to `magnetic_north` and
`glasses` to `glasses_throw` and `four_eyes`. They are here for fighters you add
with those abilities.
