import * as T from 'three';
import { Pond, fish } from './rules/game.js';
import { poseBoat, type WaterPoint } from './water';
import { buildWaterDemoTerrain, loadWaterDemoArt, makeFisher } from './water-demo-scene';
import { createWatercolorBed } from './watercolor-bed';
import { createPaintedWater } from './watercolor-water';
import { createWatercolorPost } from './watercolor-post';
import { bindWatercolorInspector, get } from './watercolor-inspector';
import './watercolor-demo.css';

const bounds = { minX: -33, maxX: 31, minZ: -44, maxZ: 19 };
const shoreStart = new T.Vector3(1.65, 0, -.75);
const cameraOffset = new T.Vector3(3.8, 27, 6.1);
const steering = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

function say(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

async function start() {
  const host = get('bay');
  const status = get('game-status');
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  host.append(renderer.domElement);

  const scene = new T.Scene();
  const sky = new T.Color();
  scene.background = sky;
  const sunColor = new T.Color();
  const sunDirection = new T.Vector3();
  const sunlight = new T.DirectionalLight();
  const ambient = new T.HemisphereLight('#ecf0d0', '#37665d', 1.74);
  scene.add(sunlight, ambient);
  const camera = new T.OrthographicCamera(-20, 20, 11, -11, .1, 110);
  const cameraLook = new T.Vector3();
  const art = await loadWaterDemoArt();
  const terrain = buildWaterDemoTerrain(scene, art.dock);
  const shores = terrain.shores.map(shore => ({ ...shore, shelf: shore.shelf && shore.shelf * 1.9 }));
  const bed = createWatercolorBed(shores, bounds);
  const paintedWater = createPaintedWater(bounds, shores, bed.group);
  const water = paintedWater.water;
  water.setLamps(terrain.lamps);
  scene.add(water.mesh);
  const post = createWatercolorPost();

  const boat = new T.Group();
  art.boat.rotation.y = Math.PI;
  art.rod.position.set(.44, .73, -.08);
  boat.add(art.boat, art.rod);
  makeFisher(boat);
  const bobber = new T.Group();
  bobber.add(art.bobber);
  bobber.scale.setScalar(1.24);
  const tip = art.rod.getObjectByName('line_tip')!;
  const floatJoint = art.bobber.getObjectByName('line_attach')!;
  const stern = art.boat.getObjectByName('buoy_stern')!;
  const linePoints = new T.BufferAttribute(new Float32Array(21), 3).setUsage(T.DynamicDrawUsage);
  const fishingLine = new T.Line(new T.BufferGeometry().setAttribute('position', linePoints),
    new T.LineBasicMaterial({ color: '#e6d5a3', transparent: true, opacity: .8 }));
  fishingLine.frustumCulled = false;
  scene.add(boat, bobber, fishingLine);

  const inspector = bindWatercolorInspector();
  const { look } = inspector;
  const panel = get<HTMLDetailsElement>('inspector');
  if (window.matchMedia('(max-width: 640px)').matches) panel.open = false;
  const game = new Pond({});
  const location = shoreStart.clone();
  const velocity = new T.Vector3();
  const castFrom = new T.Vector3(), castTo = new T.Vector3();
  const anchor1 = new T.Vector3(), anchor2 = new T.Vector3(), behind = new T.Vector3();
  const aim = new T.Raycaster();
  const seaLevel = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const positionOnSea = new T.Vector3();
  const keys = new Set<string>();
  const hookMeter = get('hook-meter');
  const hookMarker = get('hook-marker');
  const hookWindow = get('hook-window');
  const hookRules = game.balance.bite;
  hookWindow.style.left = `${hookRules.bandStart * 100}%`;
  hookWindow.style.width = `${(hookRules.bandEnd - hookRules.bandStart) * 100}%`;

  const wrathMeter = get<HTMLMeterElement>('wrath-meter');
  const wrathValue = get<HTMLOutputElement>('wrath-value');
  const castButton = get<HTMLButtonElement>('cast');
  const offerButton = get<HTMLButtonElement>('offer');
  const offerCount = offerButton.querySelector('span')!;
  const retreatButton = get<HTMLButtonElement>('retreat');
  const repelButton = get<HTMLButtonElement>('repel');
  const releaseButton = get('release');
  const stageLabel = get('stage');
  const cargoLabel = get('cargo');
  const healthLabel = get('health');
  const fpsLabel = get<HTMLOutputElement>('fps');
  let heading = -.49, time = 0, currentWrath = 0, shownWrath = 0, frameScale = 0;
  let lastFrame = performance.now(), frameWindow = lastFrame, frameCount = 0;

  function resize() {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const halfY = Math.max(9.85, 8 / aspect);
    camera.left = -halfY * aspect; camera.right = halfY * aspect;
    camera.top = halfY; camera.bottom = -halfY;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65) * look.renderScale);
    renderer.setSize(width, height, false);
    frameScale = look.renderScale;
  }

  function beginRun() {
    game.result = null;
    game.meta.offerings = game.balance.economy.offerings;
    game.start('pond');
    location.copy(shoreStart);
    cameraLook.copy(location);
    velocity.set(0, 0, 0);
    heading = -.49;
    currentWrath = 0;
    water.clearTransient();
  }

  function navigable(x: number, z: number, margin: number) {
    if (x < -25 || x > 24 || z < -33 || z > 10) return false;
    if (x > -9 - margin && x < -3.3 + margin && z > -7 - margin && z < 5.55 + margin) return false;
    return shores.every(shore => {
      const dx = x - shore.x, dz = z - shore.z;
      const cos = Math.cos(shore.angle ?? 0), sin = Math.sin(shore.angle ?? 0);
      return ((dx * cos + dz * sin) / (shore.radiusX + margin)) ** 2
        + ((dz * cos - dx * sin) / (shore.radiusZ + margin)) ** 2 > 1;
    });
  }

  function stash() {
    const run = game.run;
    if (!run?.pending) return;
    if (game.stack()) return;
    for (let y = 0; y < run.grid.rows; y += 1) {
      for (let x = 0; x < run.grid.columns; x += 1) {
        if (game.pack(x, y)) return;
      }
    }
    game.tell('В трюме нет места. Можно выпустить рыбу.');
  }

  function cast(point?: WaterPoint) {
    if (!inspector.automatic || inspector.paused) return;
    const phase = game.run?.phase;
    if (phase === 'hook') { game.hook(); return; }
    if (phase === 'pack') { stash(); return; }
    if (phase !== 'ready') return;
    castFrom.copy(location);
    if (point) {
      const distance = Math.hypot(point.x - location.x, point.z - location.z);
      if (distance < 1.3 || distance > 9 || !navigable(point.x, point.z, .12)) return;
      castTo.set(point.x, 0, point.z);
    } else {
      for (const turn of [0, .7, -.7, 1.45, -1.45, Math.PI]) {
        const angle = heading + turn;
        castTo.set(location.x - Math.sin(angle) * 4.5, 0, location.z - Math.cos(angle) * 4.5);
        if (navigable(castTo.x, castTo.z, .2)) break;
      }
      if (!navigable(castTo.x, castTo.z, .2)) return;
    }
    game.cast({ angle: 0, depth: .55 });
    game.tell('Снасть летит к воде.', .7);
  }

  function repel() {
    if (!inspector.automatic || inspector.paused || !game.run?.attack) return;
    const attack = game.run.attack;
    water.ripple(location.x + attack.side * 1.7, location.z - 1, 1.4);
    game.repel();
  }

  function offer() {
    if (!inspector.automatic || inspector.paused) return;
    game.offering();
  }

  renderer.domElement.addEventListener('pointerup', event => {
    if (event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    aim.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2), camera);
    if (aim.ray.intersectPlane(seaLevel, positionOnSea)) cast(positionOnSea);
  });

  const active = (code: string, held: boolean) => {
    if (held) keys.add(code);
    else keys.delete(code);
  };
  document.querySelectorAll<HTMLButtonElement>('[data-steer]').forEach(button => {
    const code = button.dataset.steer!;
    button.addEventListener('pointerdown', event => {
      button.setPointerCapture(event.pointerId);
      active(code, true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, () => active(code, false));
    }
  });
  castButton.addEventListener('click', () => { cast(); castButton.blur(); });
  castButton.addEventListener('pointerdown', event => {
    if (game.run?.phase !== 'reel') return;
    castButton.setPointerCapture(event.pointerId);
    active('Space', true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    castButton.addEventListener(type, () => active('Space', false));
  }
  offerButton.addEventListener('click', () => { offer(); offerButton.blur(); });
  repelButton.addEventListener('click', () => { repel(); repelButton.blur(); });
  releaseButton.addEventListener('click', () => game.release(undefined));
  retreatButton.addEventListener('click', () => {
    if (game.run) game.finish('return');
    else beginRun();
    retreatButton.blur();
  });

  window.addEventListener('keydown', event => {
    if ((event.target as HTMLElement)?.closest('input, select, button, summary')) return;
    const code = event.code;
    if (steering.includes(code) || code === 'Space') { event.preventDefault(); active(code, true); }
    if (event.repeat) return;
    if (code === 'Space') cast();
    if (code === 'KeyO') offer();
    if (code === 'KeyF') repel();
    if (code === 'Escape') game.cancel();
  });
  window.addEventListener('keyup', event => active(event.code, false));
  window.addEventListener('blur', () => keys.clear());
  new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);

  function move(dt: number) {
    const enabled = !inspector.automatic || game.run?.phase === 'ready';
    const horizontal = enabled ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : 0;
    const vertical = enabled ? Number(keys.has('KeyW')) - Number(keys.has('KeyS')) : 0;
    const scale = 4.1 / (Math.hypot(horizontal, vertical) || 1) / Math.hypot(cameraOffset.x, cameraOffset.z);
    velocity.x = T.MathUtils.damp(velocity.x, (horizontal * cameraOffset.z - vertical * cameraOffset.x) * scale, 5.6, dt);
    velocity.z = T.MathUtils.damp(velocity.z, (-horizontal * cameraOffset.x - vertical * cameraOffset.z) * scale, 5.6, dt);
    for (const axis of ['x', 'z'] as const) {
      const x = location.x + (axis === 'x' ? velocity.x * dt : 0);
      const z = location.z + (axis === 'z' ? velocity.z * dt : 0);
      if (enabled && navigable(x, z, .91)) location[axis] += velocity[axis] * dt;
      else velocity[axis] = 0;
    }
    if (velocity.lengthSq() > .05) {
      const delta = Math.atan2(-velocity.x, -velocity.z) - heading;
      heading += Math.atan2(Math.sin(delta), Math.cos(delta)) * (1 - Math.exp(-dt * 8));
    }
  }

  function updateLine() {
    const run = game.run;
    const activeLine = !!run?.cast && run.phase !== 'surge';
    bobber.visible = fishingLine.visible = art.rod.visible = activeLine;
    if (!run || !activeLine) return;
    const flight = run.phase === 'cast' ? Math.min(1, run.age / game.balance.aim.flight) : 1;
    const fighting = run.phase === 'struggle' || run.phase === 'reel';
    const distance = fighting ? T.MathUtils.clamp(run.distance / 12, .37, 1) : flight;
    const bite = run.phase === 'hook' ? Math.sin(run.age * 17) * .11 - .08 : 0;
    const x = T.MathUtils.lerp(castFrom.x, castTo.x, distance) + (fighting ? run.fishX * .41 : 0);
    const z = T.MathUtils.lerp(castFrom.z, castTo.z, distance);
    const height = water.heightAt(x, z) + Math.sin(flight * Math.PI) * 1.14 + bite;
    bobber.position.set(x, height, z);
    art.rod.rotation.z = run.rod * .21;
    tip.getWorldPosition(anchor1);
    floatJoint.getWorldPosition(anchor2);
    for (let i = 0; i < linePoints.count; i += 1) {
      const mix = i / (linePoints.count - 1);
      linePoints.setXYZ(i, T.MathUtils.lerp(anchor1.x, anchor2.x, mix),
        T.MathUtils.lerp(anchor1.y, anchor2.y, mix) - Math.sin(Math.PI * mix) * (fighting ? .065 : .18),
        T.MathUtils.lerp(anchor1.z, anchor2.z, mix));
    }
    linePoints.needsUpdate = true;
  }

  function hud(value: number) {
    const run = game.run, phase = run?.phase;
    const stage = value >= game.balance.wrath.wrath ? 3 : value >= game.balance.wrath.rising ? 2 : 1;
    const labels = ['Штиль', 'Знамение', 'Ярость'];
    const rounded = Math.round(value);
    wrathMeter.value = value;
    wrathMeter.dataset.stage = String(stage);
    wrathValue.value = `${rounded}%`;
    say(stageLabel, labels[stage - 1]);
    say(offerCount as HTMLElement, String(game.meta.offerings));
    say(cargoLabel, `Улов ${run ? game.score : game.result?.score ?? 0} / ${game.balance.economy.quota}`);
    say(healthLabel, `Здоровье ${Math.max(0, run?.health ?? 0)} / ${game.balance.wrath.health}`);
    const ready = inspector.automatic && !inspector.paused;
    castButton.disabled = !ready || !['ready', 'hook', 'pack', 'reel'].includes(phase ?? '');
    offerButton.disabled = !ready || !run || game.meta.offerings <= 0 || phase === 'surge';
    retreatButton.disabled = !inspector.automatic || phase === 'surge';
    repelButton.hidden = !ready || !run?.attack;
    releaseButton.hidden = phase !== 'pack' || !ready;
    hookMeter.hidden = phase !== 'hook';
    hookMarker.style.left = `${game.marker * 100}%`;
    const buttonText = phase === 'hook' ? 'Подсечь' : phase === 'pack' ? 'В трюм' : phase === 'reel' ? 'Подматывать' : 'Забросить';
    if (castButton.dataset.label !== buttonText) {
      castButton.dataset.label = buttonText;
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Space';
      castButton.replaceChildren(buttonText, ' ', kbd);
    }
    say(retreatButton, run ? 'К пристани' : 'Новая вылазка');
    let message = 'Выбери место для заброса.';
    if (!inspector.automatic) message = 'Предпросмотр. Гнев и ход вылазки на паузе.';
    else if (game.result) message = game.result.success ? 'Лодка у пристани. Улов доставлен.' :
      game.result.reason === 'wrath' ? 'Волна накрыла лодку. Улов потерян.' :
      game.result.reason === 'health' ? 'Лодка не выдержала нападения.' : 'Лодка у пристани. Квота не набрана.';
    else if (run?.attack) message = 'Прислужник у лодки. Нажми F, пока он не ударил.';
    else if (phase === 'surge') message = 'Последняя волна поднимается.';
    else if (phase === 'hook') message = 'Подсекай, когда метка войдёт в светлую зону.';
    else if (phase === 'struggle') message = run?.direction === 'right' ? 'Рыба рвётся вправо. Удерживай A.' : 'Рыба рвётся влево. Удерживай D.';
    else if (phase === 'reel') message = 'Удерживай пробел, чтобы подтянуть рыбу.';
    else if (phase === 'pack' && run?.pending) message = run.noticeFor > 0 ? run.notice : fish[run.pending.id].name + ' у борта.';
    else if (run?.noticeFor && run.notice) message = run.notice;
    else if (phase === 'cast' || phase === 'wait') message = 'Снасть в воде. Следи за поплавком.';
    say(status, message);
  }

  beginRun();
  resize();
  const stormSky = new T.Color('#233446');
  renderer.setAnimationLoop((now: number) => {
    const dt = inspector.paused ? 0 : Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    time += dt;
    if (look.renderScale !== frameScale) resize();
    if (inspector.automatic && game.run && dt > 0) {
      game.balance.wrath.pondRate = look.wrathRate;
      for (const [code, action] of [['KeyA', 'left'], ['KeyD', 'right'], ['Space', 'reel']]) {
        if (keys.has(code)) game.inputs.add(action);
        else game.inputs.delete(action);
      }
      game.step(dt);
      if (game.run) currentWrath = game.run.wrath;
      else if (game.result?.reason === 'wrath') currentWrath = 100;
    }
    const targetWrath = inspector.automatic ? currentWrath : inspector.wrath;
    if (inspector.automatic) inspector.showWrath(currentWrath);
    shownWrath = inspector.paused ? targetWrath / 100 : T.MathUtils.damp(shownWrath, targetWrath / 100, 2.7, dt);
    const storm = T.MathUtils.smoothstep(shownWrath, 0, 1);
    const palette = inspector.palette();
    sky.set(palette.sky).lerp(stormSky, storm);
    sunColor.set(palette.sun);
    sunDirection.set(-.57, palette.elevation * 1.6, -.81).normalize();
    sunlight.color.copy(sunColor);
    sunlight.position.copy(sunDirection).multiplyScalar(35);
    sunlight.intensity = T.MathUtils.lerp(2.46, .85, storm);
    ambient.intensity = T.MathUtils.lerp(1.69, .83, storm);
    paintedWater.ink.set(palette.ink);
    water.settings.shallow = palette.shallow;
    water.settings.deep = palette.deep;
    water.settings.crest = palette.shallow;
    water.settings.waveHeight = look.waveHeight;
    water.settings.clarity = look.clarity;
    water.settings.foam = look.foam;
    water.settings.wake = 1.23 * look.foam;
    water.update(time, shownWrath, { sky, fog: .004 + storm * .008, sunColor, sunDirection, sunPower: 1.16,
      glintOrigin: { x: -3, z: -6 } });
    move(dt);
    poseBoat(boat, water.heightAt, location.x, location.z, heading,
      { bowOffset: 1.3, sternOffset: 1.19, halfBeam: .55, waterline: .04 });
    boat.visible = game.result?.reason !== 'wrath' || !inspector.automatic;
    stern.getWorldPosition(behind);
    water.emitWake(behind, velocity);
    for (const event of game.events.splice(0)) {
      if (event.name === 'splash' || event.name === 'bite') water.ripple(castTo.x, castTo.z, event.name === 'bite' ? 1.5 : .84);
      if (event.name === 'surge') water.ripple(location.x, location.z, 1.5);
    }
    updateLine();
    paintedWater.hull.set(boat.visible ? location.x : 1000, location.z, -Math.sin(heading), -Math.cos(heading));
    paintedWater.surge.value = inspector.automatic && game.run?.phase === 'surge'
      ? Math.min(1, game.run.age / game.balance.wrath.finalPause) : -1;
    const attack = game.run?.attack;
    const inspectThreat = !inspector.automatic && (targetWrath >= game.balance.wrath.wrath);
    const menace = attack ? 1 - attack.grace / attack.total : inspectThreat ? .66 + Math.sin(time * 2.1) * .13 : 0;
    paintedWater.threat.set(location.x + (attack?.side ?? 1) * (5.6 - 3.35 * menace),
      location.z - 2.45 + 1.38 * menace, menace, time * .24 + 2.5);
    bed.update(time, shownWrath);

    cameraLook.lerp(location, 1 - Math.exp(-dt * 6.3));
    camera.position.copy(cameraLook).add(cameraOffset);
    camera.lookAt(cameraLook.x, 0, cameraLook.z);
    paintedWater.prepare(renderer, scene, camera, look);
    post.render(renderer, scene, camera, { enabled: look.painted, time, wrath: shownWrath,
      brush: look.brush, grain: look.grain, relief: look.relief });
    hud(targetWrath);

    frameCount += 1;
    if (now - frameWindow >= 650) {
      fpsLabel.value = `${Math.round(frameCount * 1000 / (now - frameWindow))} FPS`;
      frameCount = 0;
      frameWindow = now;
    }
  });
}

start().catch(error => {
  console.error(error);
  get('game-status').textContent = 'Не удалось открыть бухту. Нужен браузер с поддержкой WebGL.';
});
