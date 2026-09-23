# Prompts for generating characters

The ten included characters were generated from these prompts, one per ability.
Use them as they are to see how the format wants a photograph to look, or change
the profession and the prop to make your own — the parts about the background,
the crop and the arms are what make a picture cut out cleanly.

## How to use

1. Paste one prompt into an AI image generator.
2. Save the result in `assets/fighters/source/` under the name in the heading.
3. `pnpm cutout`. It warns if the result is unusable: **above 85%** means the
   background stayed (the generator slipped in a grey or a gradient), **below
   12%** means the figure was eaten.

## Why the prompts say what they say

- **Pure white background, no shadow.** The background is removed by a flood
  fill from the edge of the picture over near-white. A floor shadow, a vignette
  or a grey gradient does not pass it and stays on the arena as a rectangle.
- **Waist-up, arms close to the body.** Arms spread wide make the figure too
  wide; full length makes it too thin.
- **No text or logos.** They end up on screen in every video.
- **Nothing turquoise or sky blue.** The arena's field is `#18a2d3`; a costume
  close to it disappears. `pnpm cutout` warns about it.
- **A photograph, not an illustration**, and **a recognisable profession holding
  its prop**: a character is a gag, and the silhouette has to read at thumbnail
  size.

---

## 1. `magician.png` → `switcheroo`

```
A photorealistic studio photograph of a stage magician, waist-up portrait,
facing the camera with a smug confident expression. He wears a black tailcoat,
white shirt, black bow tie and a black top hat, holding a magic wand close to
his chest. Arms kept close to the body so the silhouette stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 2. `fisherman.png` → `magnet_pull`

```
A photorealistic studio photograph of a fisherman, waist-up portrait, facing the
camera with a determined squint. He wears green chest waders over a checked
flannel shirt and a wide-brimmed canvas hat, gripping a fishing rod held
vertically close to his body. Arms kept close so the silhouette stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 3. `rapper.png` → `spin_cycle`

> Written as a breakdancer; the result read as a rapper and ships under that name.

```
A photorealistic studio photograph of a breakdancer, waist-up portrait, facing
the camera mid-motion with an energetic expression, torso twisted as if about to
spin. He wears a bright red tracksuit jacket, a backwards cap and thick gold
chain. One arm crossed over the chest, the other tucked in, so the silhouette
stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 4. `barista.png` → `overclock`

```
A photorealistic studio photograph of a barista, waist-up portrait, facing the
camera wide-eyed and over-caffeinated. He wears a dark denim apron over a white
t-shirt, sleeves rolled up, holding two paper coffee cups close to his chest.
Arms kept close to the body so the silhouette stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 5. `sumo.png` → `dead_weight`

```
A photorealistic studio photograph of a sumo wrestler, waist-up portrait, facing
the camera with a stern immovable expression, arms folded across his chest. Bare
torso, traditional topknot hairstyle, a dark blue mawashi belt visible at the
bottom of the frame. Heavy, broad, planted.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 6. `luchador.png` → `wall_slam`

> A turquoise costume vanishes into the arena's field, so the colour is crimson.

```
A photorealistic studio photograph of a Mexican lucha libre wrestler, waist-up
portrait, facing the camera. He wears a crimson and silver wrestling mask
covering his whole face and a matching sleeveless singlet, muscular arms folded
across his chest so the silhouette stays narrow. Nothing turquoise, cyan or sky
blue anywhere — that is the arena's own colour and the costume would vanish
into it.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 7. `vacuum-salesman.png` → `siphon`

```
A photorealistic studio photograph of a door-to-door vacuum cleaner salesman,
waist-up portrait, facing the camera with an eager forced smile. He wears a
cheap brown suit and a wide patterned tie, holding the nozzle end of a vacuum
hose upright next to his shoulder. Arms kept close to the body so the silhouette
stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 8. `demolition.png` → `countdown`

```
A photorealistic studio photograph of a demolition worker, waist-up portrait,
facing the camera with a deadpan expression. He wears a yellow hard hat, an
orange high-visibility vest over a grey work shirt, and holds a small red
plunger-style detonator box against his chest with both hands.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 9. `fencer.png` → `riposte`

```
A photorealistic studio photograph of a fencer, waist-up portrait, facing the
camera. He wears a white fencing jacket and holds a silver fencing mask under
one arm, the sabre blade held vertically close to his shoulder, chin up with a
composed expression. Arms kept close so the silhouette stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 10. `mime.png` → `slipstream`

```
A photorealistic studio photograph of a street mime, waist-up portrait, facing
the camera with an exaggerated surprised expression. White face paint, black
beret, black and white horizontally striped long-sleeved shirt, red neckerchief,
white gloved hands raised palms-forward close to his chest as if pressing
against invisible glass.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

---

## If the background did not come out white

Generators like to add a light grey gradient or a shadow under the subject. Add
to the end of the prompt:

```
The background must be pure flat white with zero tonal variation, as if the
subject were cut out and placed on a blank white page. No floor, no surface, no
contact shadow, no ambient occlusion, no soft grey falloff at the edges of the
frame.
```

Check with `pnpm cutout`, not by eye.

## If the figure came out too wide

Width against height should land around 0.57-0.75. Spread arms or wide-set
shoulders give 0.85 and more, and the fighter reads as squat. Add:

```
Arms held close to the torso, shoulders square to the camera, cropped just below
the waist, subject filling the frame vertically with a narrow overall silhouette.
```
