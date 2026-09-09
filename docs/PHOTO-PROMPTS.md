# Десять промптов для генерации персонажей

Каждый промпт — под конкретную способность из уже реализованных десяти, чтобы
вид и механика совпадали. Копировать по одному.

## Как пользоваться

1. Скопировать промпт целиком в ChatGPT (или другой генератор изображений).
2. Сохранить результат в `assets/fighters/source/` под именем из заголовка.
3. Когда все десять на месте — `munasi cutout`.
4. Инструмент скажет, если вырезка вышла мусором: **выше 85%** — фон остался,
   генератор подсунул серый или градиент; **ниже 12%** — съело фигуру.
   Отгружаемая четвёрка идёт 36-61%.

## Почему промпты написаны именно так

Три требования не про вкус, а про то, что делает код.

- **Чисто белый фон без тени.** Фон снимается заливкой от края кадра по порогу
  236 из 255. Тень на полу, виньетка и серый градиент этот порог не проходят и
  остаются на арене прямоугольником.
- **По пояс, руки близко к телу.** Замерено: у референса ширина к росту
  0.57-0.61, у нас 0.63-0.84. Расставленные руки дают слишком широкий силуэт,
  полный рост — слишком узкий.
- **Никакого текста и логотипов.** На поиске пропов половина «свободных»
  снимков оказалась рекламой с брендом на каждом кадре; в кадр это тащить
  нельзя.
- **Костюм не бирюзовый и не голубой.** Поле арены — `#18a2d3`, и персонаж в
  близком цвете в нём растворяется. Замерено: у лучадора в бирюзовом трико 9.3%
  фигуры попадает в 60 единиц RGB от цвета поля, у всех остальных девяти —
  0.0%. `pnpm cutout` теперь на это ругается.

Плюс два, которые про формат: **фотография, а не иллюстрация** (весь формат —
коллаж из фотографий, вектор в нём видно сразу) и **узнаваемая профессия с
предметом в руках** — персонаж здесь это гэг, и силуэт должен читаться на
превью.

---

## 1. `magician.jpg` → способность `switcheroo`

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

## 2. `fisherman.jpg` → способность `magnet_pull`

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

## 3. `breakdancer.jpg` → способность `spin_cycle`

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

## 4. `barista.jpg` → способность `overclock`

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

## 5. `sumo.jpg` → способность `dead_weight`

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

## 6. `luchador.jpg` → способность `wall_slam`

> Бирюзовый вариант растворяется в поле арены — цвет заменён на малиновый.

```
A photorealistic studio photograph of a Mexican lucha libre wrestler, waist-up
portrait, facing the camera. He wears a bright turquoise and gold wrestling mask
covering his whole face and a matching sleeveless singlet, muscular arms folded
across his chest so the silhouette stays narrow.

Shot on a pure white seamless studio background, RGB 255 255 255, evenly lit
from both sides, completely flat — absolutely no shadow on the background, no
shadow under the subject, no gradient, no vignette, no reflection.

Vertical portrait orientation, high resolution, sharp focus, one person only.
No text, no watermark, no logos, no brand names anywhere in the image.
Photograph, not an illustration, not 3D, not CGI.
```

## 7. `vacuum-salesman.jpg` → способность `siphon`

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

## 8. `demolition.jpg` → способность `countdown`

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

## 9. `fencer.jpg` → способность `riposte`

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

## 10. `mime.jpg` → способность `slipstream`

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

## Если фон вышел не белым

Генераторы любят подмешивать лёгкий серый градиент или тень под ногами. Лечится
дописыванием в конец промпта:

```
The background must be pure flat white with zero tonal variation, as if the
subject were cut out and placed on a blank white page. No floor, no surface, no
contact shadow, no ambient occlusion, no soft grey falloff at the edges of the
frame.
```

Проверять не глазом, а `munasi cutout`: он печатает долю силуэта и ругается,
когда фон остался на месте.

## Если силуэт вышел слишком широким

Ширина к росту должна лечь в 0.57-0.75. Расставленные руки или широкий разворот
плеч дают 0.85+, и боец читается приземистым. Лечится:

```
Arms held close to the torso, shoulders square to the camera, cropped just below
the waist, subject filling the frame vertically with a narrow overall silhouette.
```
