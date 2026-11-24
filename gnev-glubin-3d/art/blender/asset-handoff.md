# «Гнев глубин». Передача 3D-ассетов

## Файлы

Пути даны относительно `gnev-glubin-3d/`.

- `art/blender/gnev-glubin-environments.blend` — исходник шести ассетов. В `Gnev | Asset workshop` лежат отдельные коллекции с редактируемыми деталями, UV и привязками. Сцены `Review` содержат постановочные камеры, свет и плоскость воды.
- `art/blender/textures/` — мастер ImageGen, подготовленные Base Color, Roughness, Metallic, Normal, AO и ORM.
- `art/blender/review/` — кадры из Blender, проверка повтора 3 × 3 и кадры из Three.js.
- `art/blender/asset-manifest.json` — габариты, контрольные суммы, материалы и координаты экспортированных точек.
- `public/models/` — шесть самостоятельных GLB со встроенными PNG и UV0. В рабочих сценах вода, свет и камеры Blender используются для просмотра. В GLB окружений экспортированы геометрия и именованные точки.

| Файл | Габариты X × Y × Z, м | Треугольники | Материалы | Точки привязки |
| --- | ---: | ---: | --- | --- |
| `public/models/boat.glb` | 1,52 × 1,28 × 3,61 | 10 534 | `wood`, `teal`, `bronze` | `seat_fisher`, `buoy_bow`, `buoy_stern`, `buoy_port`, `buoy_starboard` |
| `public/models/rod.glb` | 0,33 × 1,85 × 2,22 | 2 360 | `wood`, `bronze` | `line_tip` |
| `public/models/bobber.glb` | 0,27 × 0,56 × 0,27 | 922 | `float` | `line_attach` |
| `public/models/dock_deck.glb` | 5,27 × 0,39 × 2,06 | 1 704 | `wood`, `bronze` | Корень `Dock_Deck` в центре верхнего настила по XY Blender |
| `public/models/dock.glb` | 34,70 × 10,61 × 35,87 | 25 820 | `wood`, `teal`, `bronze`, `float`, `stone` | `camera_dock`, `camera_dock_target`, `interact_shop`, `interact_boat`, `lamp_shop`, `lamp_dock` |
| `public/models/pond.glb` | 59,53 × 9,87 × 57,83 | 16 840 | `wood`, `teal`, `bronze`, `float`, `stone` | `boat_spawn`, `camera_pond`, `camera_pond_target`, `landmark_shrine` |

Анимационные клипы отсутствуют во всех GLB. Качка, движение снасти и положение лески обновляются сценой Three.js.

## Материалы

`wood`, `teal` и `stone` — 1024 × 1024. `bronze` и `float` — 512 × 512. Base Color в sRGB. Normal в tangent space, OpenGL +Y. Roughness, Metallic, Normal и AO — Non-Color. Каналы ORM распределены как R = AO, G = Roughness, B = Metallic. AO передаёт мелкую фактуру материала. Он подготовлен по рельефу поверхности.

Мастер `textures/imagegen-material-source.png` — четыре равных квадранта. Рабочая формулировка для генерации:

> Flat orthographic base-color atlas in four equal squares. Dark olive salt-aged Greek skiff oak with horizontal grain, blue-grey limestone, warm antique bronze with sparse teal oxidation, burnt ochre terracotta. Broad hand-painted marks, even diffuse color, seamless material crops, no object silhouettes, lettering, highlights or cast shadows.

Материалы дерева, камня и бронзы выровнены на границах, проверены на UV в Blender и в повторе 3 × 3. Керамика поплавка использует отдельные полосы атласа для янтарного корпуса, светлой шапки и терракотового стержня.

## Подключение в Three.js

- 1 единица = 1 м. Blender Z-up, GLB Y-up. Нос лодки смотрит вдоль +Z GLB. В текущем игровом риге направление движения — локальное −Z. При подстановке повернуть на `Math.PI` только модель лодки внутри рига.
- Удочка направлена по локальному −Z. Для текущего вида от первого лица проверен наклон модели `model.rotation.x = -0.32` рад внутри `rodPivot`. При этом кончик с кольцами остаётся в кадре. Сам `rodPivot` по-прежнему задаёт движение при забросе и вываживании.
- Origin лодки и поплавка задан по спокойной ватерлинии. Все четыре `buoy_*` лежат на Y = 0. Удочка имеет origin в зоне хвата. Начало и конец лески брать через `getWorldPosition` с `line_tip` и `line_attach`.
- `dock.glb` включает причальный настил и подгруппу `Shop` для выбора объекта лучом. Лодка подставляется отдельно. `dock_deck.glb` — отдельный повторяемый модуль с продольным шагом 2,05 м.
- Пруд выстроен по координатам `bounds` и `obstaclesFor('pond')` текущей вылазки. `boat_spawn` соответствует (1, 0, 0), а камера при старте — смещению расчётной камеры от игрока. Метка святилища доступна для игрового света или эффектов.

## Проверка импорта и кадра

- Все шесть GLB заново импортированы в чистые сцены Blender 5.1. Совпали габариты, число треугольников и координаты привязок. У мешей есть UV, клипов нет. Редактируемый исходник открывается с упакованными текстурами.
- `water-demo.html` загружает `boat`, `rod`, `bobber` и `dock_deck` из `models/*.glb` или из встроенных данных автономной версии. В Chromium с WebGL проверены заброс, поплавок, поклёвка и шторм. [Кадр с шейдером воды](review/three-water-cast.png).
- В отдельной копии основной игры все шесть GLB загрузились через GLTFLoader. Из хаба можно выйти в пруд. Заброс с места старта достиг рыбного места в 7,84 м. При переходе на первое лицо леска совпала с мировыми позициями `line_tip` и `line_attach` с точностью до 0,1 мм. [Кадр заброса](review/three-pond-fps-cast.png).
- `dock.glb` и `pond.glb` готовы как первые проходы окружения. [Причал в игре](review/three-harbor.png) и [пруд в игре](review/three-pond.png). В основной рабочей сцене `src/scene.ts` пока используется процедурная геометрия. Подключение GLB и окончательное кадрирование выполняются в чате разработки.
