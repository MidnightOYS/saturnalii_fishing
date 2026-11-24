import * as T from 'three';
import { waterCamera } from './expedition';
import {
  createWater, poseBoat, waterVariants, waterEffects,
  type ReflectionQuality, type WaterEffects, type WaterPoint, type WaterSettings, type WaterVariant,
} from './water';
import { palettes } from './water-demo-palettes';
import { buildWaterDemoTerrain, loadWaterDemoArt, makeFisher } from './water-demo-scene';
import './water-demo.css';

const host = document.querySelector<HTMLElement>('#water-viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const wrathInput = document.querySelector<HTMLInputElement>('#wrath')!;
const wrathReadout = document.querySelector<HTMLOutputElement>('output[for="wrath"]')!;
const reflectionQuality = document.querySelector<HTMLSelectElement>('#reflection-quality')!;
const materialSettings = document.querySelector<HTMLElement>('#material-settings')!;
const renderInfo = document.querySelector<HTMLOutputElement>('#render-info')!;
const scenarioButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-scenario]')];
const panel = document.querySelector<HTMLDetailsElement>('.panel')!;

type Scenario = 'calm' | 'turn' | 'storm';
type SliderKey = Exclude<keyof WaterSettings, 'reflectionQuality' | 'shallow' | 'deep' | 'crest'>;
const variantIds = ['A', 'B', 'C'] as const;
const variantDescriptions: Record<WaterVariant, string> = {
  A: 'Исходные волны Герстнера',
  B: 'Спектральная зыбь и ветровые гребни',
  C: 'Преломление и видимое мелководье',
};
type FishingPhase = 'idle' | 'flight' | 'float' | 'bite';
const rangeFields: [SliderKey, string, number, number, (readonly WaterVariant[])?][] = [
  ['waveScale', 'Длина волн', .7, 1.8],
  ['waveHeight', 'Высота волн', 0, 1.6],
  ['reflection', 'Отражения', 0, 1.8],
  ['distortion', 'Искажение отражений', 0, 3.5],
  ['foam', 'Пена', 0, 1.8],
  ['wake', 'След лодки', 0, 1.75],
  ['stormStrength', 'Сила шторма', 0, 1.5],
  ['roughness', 'Ширина бликов', .20, .82, ['B', 'C']],
  ['scattering', 'Свет в воде', 0, 2, ['B', 'C']],
  ['clarity', 'Прозрачность', .25, 2.35, ['C']],
];
const effectFields: [keyof WaterEffects, string][] = [
  ['waves', 'Форма волн'], ['capillary', 'Мелкая рябь'], ['depth', 'Цвет по глубине'],
  ['reflection', 'Зеркальные отражения'], ['crestLight', 'Свет в гребнях'],
  ['sunGlint', 'Солнечный блик'], ['lamps', 'Свет у причала'],
  ['shoreFoam', 'Береговая пена'], ['crestFoam', 'Пена на гребнях'],
  ['wake', 'След лодки'], ['ripples', 'Рябь от поплавка'],
];
const colorFields = [['shallow', 'Мелководье'], ['deep', 'Глубина'], ['crest', 'Подсветка гребня']] as const;
const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const turnPath = new T.CatmullRomCurve3([
  new T.Vector3(-.75, 0, .35), new T.Vector3(.18, 0, -2.38), new T.Vector3(2.25, 0, -5.10),
  new T.Vector3(5.54, 0, -7.15), new T.Vector3(8.67, 0, -6.85), new T.Vector3(9.95, 0, -4.39),
  new T.Vector3(8.84, 0, -1.25), new T.Vector3(6.53, 0, .05),
]);
const routeLength = turnPath.getLength();
const turnDuration = routeLength / 3.62;
const hemisphereCalm = new T.Color('#d9e8de'), hemisphereStorm = new T.Color('#a0b6ce');
const skyCalm = new T.Color('#8d9b99'), skyStorm = new T.Color('#425a68');
const sunColor = new T.Color('#ffe1af');
const sunDirection = new T.Vector3(-.41, .67, -.62).normalize();
const glintOrigin = { x: -.3, z: -8.6 };
const keys = new Set<string>();

function showStatus(next: FishingPhase | 'loading' | 'error', message: string) {
  if (status.dataset.phase !== next) status.dataset.phase = next;
  if (status.textContent !== message) status.textContent = message;
}

function bindSettings(water: ReturnType<typeof createWater>, onWrath: (value: number) => void) {
  const { settings, effects } = water;
  const profiles = {
    A: { settings: { ...waterVariants.A }, effects: { ...waterEffects } },
    B: { settings: { ...waterVariants.B }, effects: { ...waterEffects } },
    C: { settings: { ...waterVariants.C }, effects: { ...waterEffects } },
  };
  const variantButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-variant]')];
  const variantDescription = document.querySelector('#variant-description')!;
  const paletteSelect = document.querySelector<HTMLSelectElement>('#palette')!;
  const swatches = document.querySelectorAll<HTMLElement>('.palette-preview i');
  const refresh: (() => void)[] = [];
  const refreshEffects: (() => void)[] = [];
  const effectList = document.querySelector('#effect-list')!;
  for (const [key, label] of effectFields) {
    const container = document.createElement('label');
    container.className = 'effect-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `effect-${key}`;
    container.append(label, input);
    effectList.append(container);
    refreshEffects.push(() => { input.checked = effects[key]; });
    input.addEventListener('input', () => { effects[key] = input.checked; });
  }
  for (const enabled of [true, false]) {
    document.querySelector(enabled ? '#effects-on' : '#effects-off')!.addEventListener('click', () => {
      for (const [key] of effectFields) effects[key] = enabled;
      refreshEffects.forEach(sync => sync());
    });
  }
  const settingsPane = document.querySelector<HTMLElement>('#settings')!;
  const effectsPane = document.querySelector<HTMLElement>('#effects')!;
  const settingsTab = document.querySelector('#show-settings')!;
  const effectsTab = document.querySelector('#show-effects')!;
  function showEffects(show: boolean) {
    settingsPane.hidden = show;
    effectsPane.hidden = !show;
    settingsTab.setAttribute('aria-pressed', String(!show));
    effectsTab.setAttribute('aria-pressed', String(show));
  }
  settingsTab.addEventListener('click', () => showEffects(false));
  effectsTab.addEventListener('click', () => showEffects(true));
  for (const [key, label, min, max, variants] of rangeFields) {
    const container = document.createElement('label');
    container.className = 'range';
    container.append(label);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = key;
    input.min = String(min);
    input.max = String(max);
    input.step = '.01';
    const output = document.createElement('output');
    output.setAttribute('for', key);
    container.append(output, input);
    materialSettings.append(container);
    const sync = () => {
      container.hidden = Boolean(variants && !variants.includes(water.variant));
      input.value = String(settings[key]);
      output.value = settings[key].toFixed(2);
    };
    refresh.push(sync);
    input.addEventListener('input', () => { settings[key] = input.valueAsNumber; sync(); });
  }
  for (const [key, label] of colorFields) {
    const container = document.createElement('label');
    container.className = 'color-row';
    const input = document.createElement('input');
    input.type = 'color';
    input.id = key;
    container.append(label, input);
    materialSettings.append(container);
    refresh.push(() => { input.value = settings[key]; });
    input.addEventListener('input', () => {
      settings[key] = input.value;
      refreshPalette();
    });
  }
  for (const [key, palette] of Object.entries(palettes)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = palette.name;
    paletteSelect.append(option);
  }
  function refreshPalette() {
    const colors = [settings.shallow, settings.deep, settings.crest];
    swatches.forEach((swatch, index) => { swatch.style.backgroundColor = colors[index]; });
    paletteSelect.value = Object.entries(palettes).find(([, palette]) =>
      palette.shallow === settings.shallow && palette.deep === settings.deep && palette.crest === settings.crest)?.[0] ?? '';
  }
  refresh.push(refreshPalette);
  paletteSelect.addEventListener('change', () => {
    const key = paletteSelect.value as keyof typeof palettes;
    if (!key) { refreshPalette(); return; }
    const { shallow, deep, crest } = palettes[key];
    const colors = { shallow, deep, crest };
    for (const profile of Object.values(profiles)) Object.assign(profile.settings, colors);
    Object.assign(settings, colors);
    refresh.forEach(sync => sync());
  });
  refresh.push(() => { reflectionQuality.value = settings.reflectionQuality; });
  reflectionQuality.addEventListener('change', () => {
    settings.reflectionQuality = reflectionQuality.value as ReflectionQuality;
  });
  function syncWrath(value: number) {
    wrathInput.value = String(value);
    wrathReadout.value = `${Math.round(value * 100)}%`;
    onWrath(value);
  }
  wrathInput.addEventListener('input', () => syncWrath(wrathInput.valueAsNumber));
  refresh.push(...refreshEffects);
  document.querySelector('#reset')!.addEventListener('click', () => {
    Object.assign(settings, waterVariants[water.variant]);
    Object.assign(effects, waterEffects);
    refresh.forEach(sync => sync());
  });
  function saveCurrent() {
    profiles[water.variant] = { settings: { ...settings }, effects: { ...effects } };
  }
  function setVariant(next: WaterVariant) {
    if (water.variant === next) return;
    saveCurrent();
    water.setVariant(next);
    Object.assign(settings, profiles[next].settings);
    Object.assign(effects, profiles[next].effects);
    for (const button of variantButtons) button.setAttribute('aria-pressed', String(button.dataset.variant === next));
    variantDescription.textContent = variantDescriptions[next];
    refresh.forEach(sync => sync());
  }
  for (const button of variantButtons) button.addEventListener('click', () => {
    setVariant(button.dataset.variant as WaterVariant);
    button.blur();
  });
  refresh.forEach(sync => sync());
  return { syncWrath, setVariant, snapshot() { saveCurrent(); return profiles; } };
}

function bindExport(makeReport: () => object, getVariant: () => WaterVariant) {
  const dialog = document.querySelector<HTMLDialogElement>('#export-dialog')!;
  const text = document.querySelector<HTMLTextAreaElement>('#export-text')!;
  const copy = document.querySelector<HTMLButtonElement>('#export-copy')!;
  document.querySelector('#export-open')!.addEventListener('click', () => {
    text.value = JSON.stringify(makeReport(), null, 2);
    copy.textContent = 'Скопировать';
    dialog.showModal();
  });
  copy.addEventListener('click', async () => {
    text.focus();
    text.select();
    try {
      await navigator.clipboard.writeText(text.value);
      copy.textContent = 'Скопировано';
    } catch {
      copy.textContent = 'Текст выделен';
    }
  });
  document.querySelector('#export-download')!.addEventListener('click', () => {
    const blob = new Blob([text.value + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gnev-water-${getVariant().toLowerCase()}.json`;
    dialog.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

async function start() {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  host.append(renderer.domElement);

  const scene = new T.Scene();
  const sky = new T.Color();
  scene.background = sky;
  const fog = new T.FogExp2(sky, .013);
  scene.fog = fog;
  const sunlight = new T.DirectionalLight(sunColor, 2.4);
  sunlight.position.copy(sunDirection).multiplyScalar(36);
  const ambient = new T.HemisphereLight(hemisphereCalm, '#696c52', 2.0);
  scene.add(sunlight, ambient);
  const camera = new T.OrthographicCamera(-20, 20, 10.7, -10.7, .05, 150);
  const look = new T.Vector3();
  const art = await loadWaterDemoArt();
  const { shores, lamps } = buildWaterDemoTerrain(scene, art.dock);
  const water = createWater({ bounds: { minX: -33, maxX: 31, minZ: -44, maxZ: 19 }, shores, apron: 10 });
  water.setLamps(lamps);
  scene.add(water.mesh);

  const boat = new T.Group();
  const bobber = new T.Group();
  art.boat.rotation.y = Math.PI;
  boat.add(art.boat);
  makeFisher(boat);
  art.rod.position.set(.44, .73, -.08);
  boat.add(art.rod);
  bobber.add(art.bobber);
  bobber.scale.setScalar(1.34);
  scene.add(boat, bobber);
  const from = art.rod.getObjectByName('line_tip')!;
  const to = art.bobber.getObjectByName('line_attach')!;
  const stations = ['buoy_bow', 'buoy_stern', 'buoy_port', 'buoy_starboard'].map(name => art.boat.getObjectByName(name)!);
  const buoyancy = { bowOffset: Math.abs(stations[0].position.z), sternOffset: Math.abs(stations[1].position.z),
    halfBeam: Math.abs(stations[3].position.x - stations[2].position.x) / 2, waterline: .04 };
  const lineCoords = new T.BufferAttribute(new Float32Array(18), 3).setUsage(T.DynamicDrawUsage);
  const line = new T.Line(new T.BufferGeometry().setAttribute('position', lineCoords),
    new T.LineBasicMaterial({ color: '#e0d3a1', transparent: true, opacity: .79 }));
  line.frustumCulled = false;
  scene.add(line);

  const location = new T.Vector3(-.75, 0, .35), velocity = new T.Vector3();
  const stern = new T.Vector3(), lookTarget = new T.Vector3(), lineStart = new T.Vector3(), lineEnd = new T.Vector3();
  const floatPoint = new T.Vector3(), throwStart = new T.Vector3();
  const sceneStart = location.clone();
  let heading = -.14, targetWrath = 0, wrath = 0, time = 0;
  let routeStart: number | null = null;
  let stormStart: number | null = null;
  let stormEvent = 0;
  let phase: FishingPhase = 'idle', castAt = 0, biteAt = -10;
  let selected: Scenario = 'calm';
  const flightDuration = .49;
  const biteDuration = 1.26;
  const resize = () => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const vertical = Math.max(10.7, 12 / aspect);
    Object.assign(camera, { left: -vertical * aspect, right: vertical * aspect, top: vertical, bottom: -vertical });
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  new ResizeObserver(resize).observe(host);
  resize();
  if (window.matchMedia('(max-width: 640px)').matches) panel.open = false;
  let paused = false;
  const { syncWrath, setVariant, snapshot } = bindSettings(water, value => {
    targetWrath = value;
    if (paused) wrath = value;
  });
  const pause = document.querySelector<HTMLButtonElement>('#pause')!;
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = paused ? 'Продолжить' : 'Стоп-кадр';
    pause.blur();
  });
  bindExport(() => ({
    schema: 'gnev-glubin-water',
    version: 1,
    activeVariant: water.variant,
    scene: { scenario: selected, time, paused, targetWrath, wrath, boat: { x: location.x, z: location.z, heading } },
    variants: snapshot(),
  }), () => water.variant);

  function cast(point?: WaterPoint) {
    if (phase !== 'idle') { phase = 'idle'; return; }
    castAt = time;
    phase = 'flight';
    throwStart.copy(location);
    if (point) floatPoint.set(point.x, 0, point.z);
    else floatPoint.set(location.x - Math.sin(heading) * 2.8 + 1.95, 0, location.z - Math.cos(heading) * 4.2);
  }

  function bite() {
    if (phase !== 'float' && phase !== 'bite') return;
    phase = 'bite';
    biteAt = time;
    water.ripple(floatPoint.x, floatPoint.z, 1.42);
  }

  function changeScenario(next: Scenario) {
    selected = next;
    for (const button of scenarioButtons) button.setAttribute('aria-pressed', String(button.dataset.scenario === selected));
    routeStart = next === 'turn' ? time : null;
    stormStart = next === 'storm' ? time : null;
    stormEvent = 0;
    location.copy(sceneStart);
    velocity.set(0, 0, 0);
    heading = -.14;
    phase = 'idle';
    keys.clear();
    camera.userData.initialized = false;
    water.clearTransient();
    syncWrath(next === 'storm' ? 1 : next === 'turn' ? .22 : 0);
  }

  function handleMove(key: string) {
    if (routeStart !== null) routeStart = null;
    stormStart = null;
    keys.add(key);
  }

  function manualFishing() { stormStart = null; }
  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLElement && event.target.matches('input, select, button, summary')) return;
    const variant = variantIds[Number(event.key) - 1];
    if (variant && !event.repeat) setVariant(variant);
    if (moveKeys.includes(event.code)) { event.preventDefault(); handleMove(event.code); }
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); manualFishing(); cast(); }
    if (event.code === 'KeyR' && !event.repeat) { manualFishing(); bite(); }
  });
  window.addEventListener('keyup', event => { keys.delete(event.code); });
  window.addEventListener('blur', () => keys.clear());
  for (const button of scenarioButtons) button.addEventListener('click', () => {
    if (paused) pause.click();
    changeScenario(button.dataset.scenario as Scenario);
    button.blur();
  });
  for (const touch of document.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    touch.addEventListener('pointerdown', event => {
      touch.setPointerCapture(event.pointerId);
      handleMove(touch.dataset.move!);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      touch.addEventListener(event, () => keys.delete(touch.dataset.move!));
    }
  }
  document.querySelector('#touch-cast')!.addEventListener('click', () => { manualFishing(); cast(); });
  document.querySelector('#touch-bite')!.addEventListener('click', () => { manualFishing(); bite(); });
  const ray = new T.Raycaster();
  const level = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const pointOnWater = new T.Vector3();
  const pointer = new T.Vector2();
  renderer.domElement.addEventListener('pointerup', event => {
    if (event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.x) / rect.width * 2 - 1, 1 - (event.clientY - rect.y) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    if (!ray.ray.intersectPlane(level, pointOnWater)) return;
    const range = Math.hypot(location.x - pointOnWater.x, location.z - pointOnWater.z);
    if (range < 1.7 || range > 10 || !clearWater(pointOnWater.x, pointOnWater.z, .15)) return;
    manualFishing();
    phase = 'idle';
    cast(pointOnWater);
  });

  function clearWater(x: number, z: number, margin: number) {
    if (x < -16 || x > 22 || z < -35 || z > 10) return false;
    if (x > -9 - margin && x < -3.3 + margin && z > -7 - margin && z < 5.55 + margin) return false;
    return shores.every(shore => {
      const dx = x - shore.x, dz = z - shore.z;
      const c = Math.cos(shore.angle ?? 0), s = Math.sin(shore.angle ?? 0);
      return ((dx * c + dz * s) / (shore.radiusX + margin)) ** 2
        + ((dz * c - dx * s) / (shore.radiusZ + margin)) ** 2 > 1;
    });
  }

  function move(dt: number) {
    if (routeStart !== null) {
      const progress = Math.min(1, (time - routeStart) / turnDuration);
      const tangent = turnPath.getTangentAt(progress);
      turnPath.getPointAt(progress, location);
      velocity.copy(tangent).multiplyScalar(3.62);
      if (progress >= 1) { routeStart = null; velocity.set(0, 0, 0); }
    } else {
      const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const north = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const scale = 4.65 / (Math.hypot(side, north) || 1) / Math.hypot(waterCamera.x, waterCamera.z);
      const ease = 1 - Math.exp(-dt * 8);
      velocity.x = T.MathUtils.lerp(velocity.x, (side * waterCamera.z - north * waterCamera.x) * scale, ease);
      velocity.z = T.MathUtils.lerp(velocity.z, (-side * waterCamera.x - north * waterCamera.z) * scale, ease);
      for (const axis of ['x', 'z'] as const) {
        const x = location.x + (axis === 'x' ? velocity.x * dt : 0);
        const z = location.z + (axis === 'z' ? velocity.z * dt : 0);
        if (clearWater(x, z, 1.13)) location[axis] += velocity[axis] * dt;
        else velocity[axis] = 0;
      }
    }
    if (velocity.lengthSq() > .045) {
      const delta = Math.atan2(-velocity.x, -velocity.z) - heading;
      heading += Math.atan2(Math.sin(delta), Math.cos(delta)) * (1 - Math.exp(-dt * 10));
    }
  }

  function fishing() {
    if (stormStart !== null) {
      const elapsed = time - stormStart;
      if (stormEvent === 0 && elapsed > 1.28) { cast(); stormEvent = 1; }
      else if (stormEvent === 1 && elapsed > 3.15) { bite(); stormEvent = 2; }
      else if (stormEvent === 2 && time - biteAt > 4.0) bite();
    }
    if (phase === 'flight' && time - castAt >= flightDuration) {
      phase = 'float';
      water.ripple(floatPoint.x, floatPoint.z, 1.11);
    }
    if (phase === 'bite' && time - biteAt >= biteDuration) phase = 'float';
    bobber.visible = line.visible = art.rod.visible = phase !== 'idle';
    if (phase === 'idle') {
      showStatus(phase, '');
      return;
    }
    const flying = phase === 'flight';
    const amount = flying ? Math.min(1, (time - castAt) / flightDuration) : 1;
    const diveAge = time - biteAt;
    const dipping = phase === 'bite'
      ? Math.exp(-(((diveAge - .235) / .136) ** 2)) * .40 + Math.exp(-(((diveAge - .53) / .13) ** 2)) * .13
      : 0;
    const x = T.MathUtils.lerp(throwStart.x, floatPoint.x, amount);
    const z = T.MathUtils.lerp(throwStart.z, floatPoint.z, amount);
    const surface = water.heightAt(x, z);
    bobber.position.set(x, surface + (flying ? (1 - amount) * .90 + Math.sin(Math.PI * amount) * 1.15 : .08 - dipping), z);
    bobber.rotation.set(
      T.MathUtils.clamp((water.heightAt(x, z - .17) - water.heightAt(x, z + .17)) / .34, -.45, .45),
      0,
      T.MathUtils.clamp((water.heightAt(x + .17, z) - water.heightAt(x - .17, z)) / .34, -.45, .45) + dipping * .9,
    );
    art.rod.rotation.x = flying ? -.37 * Math.sin(Math.PI * amount) : dipping * .35;
    from.getWorldPosition(lineStart);
    to.getWorldPosition(lineEnd);
    for (let i = 0; i < lineCoords.count; i += 1) {
      const t = i / (lineCoords.count - 1);
      lineCoords.setXYZ(i,
        T.MathUtils.lerp(lineStart.x, lineEnd.x, t),
        T.MathUtils.lerp(lineStart.y, lineEnd.y, t) - Math.sin(t * Math.PI) * (phase === 'bite' ? .095 : .23),
        T.MathUtils.lerp(lineStart.z, lineEnd.z, t),
      );
    }
    lineCoords.needsUpdate = true;
    showStatus(phase, flying ? 'Заброс' : phase === 'bite' ? 'Поклёвка' : 'Оснастка в воде');
  }

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    resize();
  });
  let previous = performance.now();
  let clockStart = previous, frames = 0;
  changeScenario('calm');
  renderer.setAnimationLoop((now: number) => {
    const dt = paused ? 0 : T.MathUtils.clamp((now - previous) / 1000, 0, .055);
    previous = now;
    time += dt;
    wrath = T.MathUtils.damp(wrath, targetWrath, 1.95, dt);
    const weather = T.MathUtils.smoothstep(wrath, 0, 1);
    sky.copy(skyCalm).lerp(skyStorm, weather);
    fog.color.copy(sky);
    fog.density = T.MathUtils.lerp(.012, .020, weather);
    sunlight.intensity = T.MathUtils.lerp(2.35, .86, weather);
    ambient.color.copy(hemisphereCalm).lerp(hemisphereStorm, weather);
    ambient.intensity = T.MathUtils.lerp(1.92, 1.25, weather);
    water.update(time, wrath, { sky, fog: fog.density, sunDirection, sunColor, sunPower: 1.33, glintOrigin });
    move(dt);
    poseBoat(boat, water.heightAt, location.x, location.z, heading, buoyancy);
    stations[1].getWorldPosition(stern);
    water.emitWake(stern, velocity);
    fishing();

    lookTarget.set(location.x, 0, location.z - 1.25);
    if (camera.userData.initialized) look.lerp(lookTarget, 1 - Math.exp(-dt * 7));
    else { look.copy(lookTarget); camera.userData.initialized = true; }
    camera.position.set(look.x + waterCamera.x, waterCamera.y, look.z + waterCamera.z);
    camera.lookAt(look);
    water.renderPasses(renderer, scene, camera);
    renderer.render(scene, camera);

    frames += 1;
    if (now - clockStart >= 600) {
      const fps = Math.round(frames * 1000 / (now - clockStart));
      const size = water.reflectionSize();
      renderInfo.value = `${fps} кадр/с${!water.effects.reflection || water.settings.reflectionQuality === 'off' || water.settings.reflection <= 0 ? '' : ` · ${size.width}×${size.height}`}`;
      frames = 0;
      clockStart = now;
    }
  });
}

start().catch(error => {
  console.error(error);
  showStatus('error', 'Не удалось открыть сцену. Проверьте поддержку WebGL и файлы моделей.');
});
