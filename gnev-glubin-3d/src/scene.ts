import * as T from 'three';
import { createBoatVisualLoader, type BoatVisual } from './boat-visual';
import { enemyTiming } from './enemies';
import { createEnemyVisuals } from './enemy-visuals';
import { createExpeditionLighting } from './expedition-light';
import { between, distance, schoolLimit, schoolRadius, waterCamera, type Expedition, type Point } from './expedition';
import { createIthacaSky, loadIthaca, type IthacaAction } from './ithaca';
import { disposeLocation, type LoadedLocation } from './location-assets';
import { createLocationEffects } from './location-environment';
import { createGameWater } from './location-water';
import { defaultVisualTuning, type VisualTuning } from './visual-tuning';
import { createVisualPost } from './visual-effects/post';
import type { CollectionCamera } from './water-lab/collection';
import { defaultCollectionSettings, type LabSettings, type Mode } from './water-lab/collection-settings';

const createBlindEye = createBoatVisualLoader();

const waves = [
  { x: 0.91, z: 0.59, speed: 1.52, weight: 0.54 },
  { x: -0.53, z: 1.08, speed: 1.13, weight: 0.31 },
  { x: 2.04, z: -1.34, speed: 2.21, weight: 0.15 }
];

function heightAt(x: number, z: number, time: number, amplitude: number) {
  return amplitude * waves.reduce((height, wave) =>
    height + wave.weight * Math.sin(x * wave.x + z * wave.z + time * wave.speed), 0);
}

const glslWaves = waves.map(wave =>
  `sin(p.x * (${wave.x}) + p.y * (${wave.z}) + uTime * ${wave.speed}) * ${wave.weight}`
).join(' + ');

const ithacaPalette = {
  sky: new T.Color('#7d7081'), deep: new T.Color('#10383a'), crest: new T.Color('#38655f'),
  glint: new T.Color('#dbac7d'), fog: .008,
};

const palettes = [
  { sky: '#a8b3a0', deep: '#1e4945', crest: '#588879', glint: '#dbc591', amplitude: .11, fog: .022, sun: 2.3 },
  { sky: '#6b8981', deep: '#173737', crest: '#4a7669', glint: '#a8c6ab', amplitude: .24, fog: .029, sun: 1.52 },
  { sky: '#374d53', deep: '#121d28', crest: '#385362', glint: '#a9abc2', amplitude: .5, fog: .04, sun: .84 }
].map(palette => ({
  ...palette, sky: new T.Color(palette.sky), deep: new T.Color(palette.deep),
  crest: new T.Color(palette.crest), glint: new T.Color(palette.glint)
}));

function mesh(group: T.Object3D, geometry: T.BufferGeometry, color: T.ColorRepresentation, x: number, y: number, z: number) {
  const result = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, roughness: .92, flatShading: true }));
  result.position.set(x, y, z);
  group.add(result);
  return result;
}

function box(group: T.Object3D, color: T.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, d: number) {
  return mesh(group, new T.BoxGeometry(w, h, d), color, x, y, z);
}

function cylinder(group: T.Object3D, color: T.ColorRepresentation, x: number, y: number, z: number, r: number, h: number, sides = 8, bottom = r) {
  return mesh(group, new T.CylinderGeometry(r, bottom, h, sides), color, x, y, z);
}

function stone(group: T.Object3D, color: T.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, depth: number) {
  const result = mesh(group, new T.IcosahedronGeometry(1, 0), color, x, y, z);
  result.scale.set(w, h, depth);
  result.rotation.y = x * .69;
  return result;
}

function createBoat() {
  const boat = new T.Group();
  const rim = Array.from({ length: 20 }, (_, i) => {
    const theta = i / 20 * Math.PI * 2;
    const z = Math.cos(theta) * 2.0;
    const x = Math.sin(theta) * (.94 - .14 * Math.abs(Math.cos(theta)));
    return new T.Vector3(x, .38 + .22 * Math.pow(Math.abs(z) / 2, 4), z);
  });
  const bottom = rim.map(point => new T.Vector3(point.x * .62, -.24, point.z * .78));
  const inner = rim.map(point => new T.Vector3(point.x * .89, .04, point.z * .92));
  const positions: number[] = [];
  for (let i = 0; i < rim.length; i += 1) {
    const j = (i + 1) % rim.length;
    for (const [a, b, c] of [
      [rim[i], bottom[i], bottom[j]], [rim[i], bottom[j], rim[j]],
      [inner[i], rim[i], rim[j]], [inner[i], rim[j], inner[j]],
      [new T.Vector3(0, .025, 0), inner[i], inner[j]]
    ]) positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  }
  const hull = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  hull.computeVertexNormals();
  const skin = mesh(boat, hull, '#835d3e', 0, 0, 0);
  skin.material.side = T.DoubleSide;
  const rails = new T.CatmullRomCurve3(rim, true);
  mesh(boat, new T.TubeGeometry(rails, 48, .042, 5), '#c28d57', 0, 0, 0);
  for (const z of [-.96, .11, .99]) {
    box(boat, '#a98254', 0, .26, z, z === .11 ? 1.70 : 1.38, .12, .24);
  }
  return boat;
}

function createHorizon() {
  const horizon = new T.Group();
  for (let i = 0; i < 24; i += 1) {
    const x = (i % 12 - 5.5) * 13;
    const z = -57 - Math.floor(i / 12) * 21 - Math.abs(Math.sin(i * 56)) * 7;
    stone(horizon, i < 12 ? '#5d526c' : '#76617e', x, -.70, z, 13 + i % 4, 3.7 + i % 6, 6.9);
  }
  return horizon;
}

function waterSurface() {
  const geometry = new T.PlaneGeometry(224, 200, 192, 176);
  geometry.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 }, uAmplitude: { value: 0 }, uFog: { value: .02 },
    uSky: { value: new T.Color() }, uDeep: { value: new T.Color() },
    uCrest: { value: new T.Color() }, uGlint: { value: new T.Color() }
  };
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: `
      uniform float uTime, uAmplitude;
      varying vec3 vPoint;
      float wave(vec2 p) { return uAmplitude * (${glslWaves}); }
      void main() {
        vec4 point = modelMatrix * vec4(position, 1.0);
        point.y += wave(point.xz);
        vPoint = point.xyz;
        gl_Position = projectionMatrix * viewMatrix * point;
      }
    `,
    fragmentShader: `
      uniform float uTime, uAmplitude, uFog;
      uniform vec3 uSky, uDeep, uCrest, uGlint;
      varying vec3 vPoint;
      float wave(vec2 p) { return uAmplitude * (${glslWaves}); }
      void main() {
        vec2 p = vPoint.xz;
        float h = wave(p);
        vec3 normal = normalize(vec3(h - wave(p + vec2(0.13, 0.0)), 0.13, h - wave(p + vec2(0.0, 0.13))));
        vec3 eye = normalize(cameraPosition - vPoint);
        vec3 sun = normalize(vec3(-0.48, 0.17, -1.0));
        float fresnel = pow(1.0 - max(dot(eye, normal), 0.0), 3.5);
        float bands = sin(p.y * 4.1 + sin(p.x * 1.53 + uTime) * 1.18 + uTime * 1.05);
        float fine = sin(p.y * 11.4 + sin(p.x * 3.0 - uTime) * 2.1 - uTime * 1.6);
        float streak = smoothstep(0.84, 1.0, bands * 0.70 + fine * 0.3);
        float spec = pow(max(dot(normal, normalize(sun + eye)), 0.0), 19.0);
        vec3 color = mix(uDeep, uCrest, clamp(0.31 + fresnel * 0.6 + h * 0.28 + bands * 0.05, 0.0, 1.0));
        color += uGlint * (spec * 0.54 + streak * (0.035 + fresnel * 0.06));
        float dist = max(0.0, length(cameraPosition - vPoint) - 35.0) * uFog;
        color = mix(color, uSky, 1.0 - exp(-dist * dist));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const water = new T.Mesh(geometry, material);
  water.position.z = -45;
  return { water, uniforms };
}

function ring(color: T.ColorRepresentation, r: number, edge = .86, arc = Math.PI * 2) {
  const geometry = new T.RingGeometry(r * edge, r, 30, 1, 0, arc);
  geometry.rotateX(-Math.PI / 2);
  return new T.Mesh(geometry, new T.MeshBasicMaterial({
    color, transparent: true, opacity: .8, depthWrite: false, side: T.DoubleSide
  }));
}

const expeditionFraming = {
  pond: { vertical: 13.35, lateral: 8.55, forward: .9 },
  temple: { vertical: 12.25, lateral: 5.25, forward: 1.25 }
};

function schoolMarker() {
  const root = new T.Group();
  const boundary = ring('#a4d6ce', schoolRadius, .967);
  const specialBoundary = ring('#ca65ff', schoolRadius, .89);
  const ripples = [
    ring('#b9e9db', schoolRadius, .92, Math.PI * .66),
    ring('#b9e9db', schoolRadius, .94, Math.PI * .42)
  ];
  const fish = Array.from({ length: 3 }, () => {
    const body = stone(root, '#b7ddbd', 0, .15, 0, .26, .08, .105);
    const tail = mesh(body, new T.ConeGeometry(.38, .64, 3), '#a4cdb0', -.86, 0, 0);
    tail.rotation.z = Math.PI / 2;
    return body;
  });
  root.add(boundary, specialBoundary, ...ripples);
  return { root, boundary, specialBoundary, ripples, fish };
}

function biteSpray() {
  const root = new T.Group();
  const material = new T.MeshBasicMaterial({
    color: '#edfff2', transparent: true, opacity: 0, depthWrite: false, toneMapped: false
  });
  const geometry = new T.TetrahedronGeometry(.055);
  const droplets = Array.from({ length: 7 }, (_, index) => {
    const drop = new T.Mesh(geometry, material);
    drop.scale.setScalar(1.25 - index * .08);
    root.add(drop);
    return drop;
  });
  return { root, droplets, material };
}

function flightLift(range: number, bow: boolean) {
  return bow ? Math.min(1.2, .38 + range * .07) : Math.min(2.1, .53 + range * .145);
}

function sampleFlight(out: T.Vector3, start: T.Vector3, end: T.Vector3, lift: number, t: number) {
  out.lerpVectors(start, end, t);
  out.y += 4 * lift * t * (1 - t);
  return out;
}

export function createScene(host: HTMLElement, game: Expedition, markers: Record<IthacaAction, HTMLButtonElement>) {
  const dockUI = markers.shop.closest<HTMLElement>('#dock')!;
  const dockStatus = dockUI.querySelector<HTMLElement>('#dock-status')!;
  const gameRoot = host.closest('#game');
  const hasMobileControls = () => gameRoot?.hasAttribute('data-mobile-controls') ?? false;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(hasMobileControls() ? 1.25 : 2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  host.append(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color();
  const fog = new T.FogExp2('#a8b3a0', .02);
  scene.fog = fog;
  const dockCamera = new T.PerspectiveCamera(44, 1, .05, 150);
  const expeditionCamera = new T.OrthographicCamera(-20, 20, 11, -11, .05, 150);
  const fishingCamera = new T.PerspectiveCamera(64, 1, .07, 150);
  let camera: CollectionCamera = dockCamera;
  const sun = new T.DirectionalLight('#ffe0a8', 2.3);
  sun.position.set(-15, 14, -5);
  const sunDirection = sun.position.clone().normalize();
  const ambient = new T.HemisphereLight('#e0e1c8', '#4f6c64', 1.65);
  scene.add(sun, ambient);
  const lighting = createExpeditionLighting(renderer, scene, fog, sun, ambient, sunDirection);
  const visualPost = createVisualPost(renderer);
  const dockSun = new T.DirectionalLight('#ffc18e', 2.65);
  dockSun.position.set(-39, 28, 17);
  dockSun.target.position.set(2, 7, -12);
  dockSun.castShadow = true;
  dockSun.shadow.autoUpdate = false;
  dockSun.shadow.mapSize.set(1024, 1024);
  Object.assign(dockSun.shadow.camera, { left: -25, right: 25, top: 22, bottom: -22, near: 1, far: 85 });
  dockSun.shadow.bias = -.00035;
  dockSun.shadow.normalBias = .05;
  scene.add(dockSun, dockSun.target);

  const { water, uniforms } = waterSurface();
  const horizon = createHorizon();
  const sky = createIthacaSky();
  let ithaca: Awaited<ReturnType<typeof loadIthaca>> | undefined;
  const mooringPositions = new T.BufferAttribute(new Float32Array(9), 3);
  const mooring = new T.Line(
    new T.BufferGeometry().setAttribute('position', mooringPositions),
    new T.LineBasicMaterial({ color: '#64452f' }),
  );
  mooring.frustumCulled = false;
  const boat = createBoat();
  const fallbackParts = [...boat.children];
  let blindEye: BoatVisual | undefined;
  let boatLoading: Promise<BoatVisual> | undefined;
  function loadBoat() {
    return boatLoading ??= createBlindEye().then(visual => {
      blindEye = visual;
      // Match the GLB's deeper sole to the game's water plane.
      visual.root.position.y = .16;
      boat.add(visual.root);
      for (const part of fallbackParts) part.visible = false;
      return visual;
    }).catch(error => {
      boatLoading = undefined;
      throw error;
    });
  }
  async function prepareSail() {
    const visual = await loadBoat();
    await visual.prepareSail();
  }
  const initialEquipment = game.meta.boat ? prepareSail() : loadBoat();
  void initialEquipment.catch(error => console.warn('Boat model could not be loaded', error));
  const fisher = new T.Group();
  mesh(fisher, new T.CapsuleGeometry(.23, .50, 3, 8), '#8f5f43', 0, .85, .36);
  mesh(fisher, new T.IcosahedronGeometry(.20, 1), '#c8996f', 0, 1.37, .35);
  const hood = mesh(fisher, new T.SphereGeometry(.214, 10, 6, 0, Math.PI * 2, 0, Math.PI * .59), '#ad8d68', 0, 1.41, .37);
  hood.scale.y = .64;
  box(fisher, '#d2ab70', 0, .70, .54, .48, .09, .08);
  const dog = new T.Group();
  const dogBody = mesh(dog, new T.CapsuleGeometry(.15, .30, 3, 7), '#9d7651', -.50, .32, .03);
  dogBody.rotation.x = Math.PI / 2;
  stone(dog, '#ad8356', -.50, .44, -.22, .14, .17, .17);
  for (const x of [-.58, -.42]) {
    const ear = mesh(dog, new T.ConeGeometry(.07, .19, 4), '#7e5e40', x, .56, -.20);
    ear.rotation.z = x < -.50 ? .28 : -.28;
  }
  boat.add(fisher, dog);

  const rodPivot = new T.Group();
  rodPivot.position.set(.59, .82, .30);
  const rodTip = new T.Vector3(.15, .89, -2.03);
  const rod = cylinder(rodPivot, '#a88254', 0, 0, 0, .022, rodTip.length(), 7, .047);
  rod.position.copy(rodTip).multiplyScalar(.5);
  rod.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), rodTip.clone().normalize());
  const grip = cylinder(rodPivot, '#413c2e', .042, .19, -.23, .053, .49, 7);
  grip.quaternion.copy(rod.quaternion);
  const hand = mesh(rodPivot, new T.SphereGeometry(.105, 9, 7), '#aa8060', .01, .12, -.22);
  hand.scale.set(.8, .74, 1.48);
  boat.add(rodPivot);
  const linePositions = new T.BufferAttribute(new Float32Array(9), 3);
  const lineGeometry = new T.BufferGeometry().setAttribute('position', linePositions);
  const line = new T.Line(lineGeometry, new T.LineBasicMaterial({ color: '#f4dfaa', transparent: true, opacity: .86 }));
  line.frustumCulled = false;

  const float = new T.Group();
  const floatBody = mesh(float, new T.SphereGeometry(.13, 12, 8), '#e4d6a7', 0, .10, 0);
  floatBody.scale.y = 1.55;
  cylinder(float, '#b95d49', 0, .23, 0, .077, .15, 10, .097);
  const floatTip = cylinder(float, '#e4d6a7', 0, .36, 0, .026, .16, 8);
  floatTip.material.emissive.set('#ffd8a1');
  const floatRipple = ring('#e4dcba', .40, .94);
  const spots = Array.from({ length: schoolLimit }, schoolMarker);
  const bite = biteSpray();
  const enemies = createEnemyVisuals(scene);
  const warning = ring('#ff8059', .95);
  const weakSpot = new T.Mesh(new T.SphereGeometry(.10, 10, 7), new T.MeshBasicMaterial({ color: '#ffe2a5' }));
  warning.userData.waterSurfaceEffect = weakSpot.userData.waterSurfaceEffect = true;
  scene.add(warning, weakSpot);
  const arcSegments = 28;
  const arcPositions = new T.BufferAttribute(new Float32Array((arcSegments + 1) * 3), 3);
  const aimLine = new T.Line(
    new T.BufferGeometry().setAttribute('position', arcPositions),
    new T.LineBasicMaterial({ color: '#f4d592', transparent: true, opacity: .75, depthTest: false })
  );
  aimLine.frustumCulled = false;
  const crosshair = ring('#f1d599', .34, .78);
  crosshair.material.depthTest = false;
  crosshair.renderOrder = 3;
  const feather = new T.Group();
  const shaft = cylinder(feather, '#e9c584', 0, 0, 0, .036, .79, 6);
  shaft.rotation.x = Math.PI / 2;
  const head = mesh(feather, new T.ConeGeometry(.088, .23, 5), '#f7e3b4', 0, 0, .45);
  head.rotation.x = Math.PI / 2;
  const splash = ring('#e3b77e', .7);
  const spray = ring('#dfded1', .8);
  const weapon = new T.Group();
  const limbs = new T.CatmullRomCurve3([
    new T.Vector3(0, -.54, .16), new T.Vector3(0, -.37, .05), new T.Vector3(0, 0, -.12),
    new T.Vector3(0, .37, .05), new T.Vector3(0, .54, .16)
  ]);
  mesh(weapon, new T.TubeGeometry(limbs, 16, .038, 5), '#b08046', 0, 0, 0);
  const stringPositions = new T.BufferAttribute(new Float32Array(9), 3);
  weapon.add(new T.Line(new T.BufferGeometry().setAttribute('position', stringPositions),
    new T.LineBasicMaterial({ color: '#ead5a8' })));
  scene.add(sky, horizon, water, mooring, boat, float, line, floatRipple,
    ...spots.map(marker => marker.root), bite.root, spray, weapon, feather, aimLine, crosshair, splash);

  const pick = new T.Raycaster();
  const bowAimLevel = .63;
  const aimPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const pointing = new T.Vector3();
  function rayAt(clientX: number, clientY: number) {
    const rect = renderer.domElement.getBoundingClientRect();
    pick.setFromCamera(new T.Vector2(
      (clientX - rect.left) / rect.width * 2 - 1,
      1 - (clientY - rect.top) / rect.height * 2
    ), camera);
  }

  function pointAt(clientX: number, clientY: number, bow = true): Point | null {
    rayAt(clientX, clientY);
    const monster = game.monster;
    if (bow && monster && weakSpot.visible && pick.ray.distanceSqToPoint(weakSpot.position) < .48 ** 2) {
      // Aim at the existing hit area when the cursor is on the animated target.
      return { x: monster.x, z: monster.z };
    }
    aimPlane.constant = bow ? -bowAimLevel : 0;
    return pick.ray.intersectPlane(aimPlane, pointing) ? { x: pointing.x, z: pointing.z } : null;
  }

  renderer.domElement.addEventListener('click', event => {
    if (event.button !== 0 || game.run || game.result || !ithaca) return;
    rayAt(event.clientX, event.clientY);
    const { shop, workshop, polyphemus } = ithaca.targets;
    for (const hit of pick.intersectObjects([ithaca.root, boat], true)) {
      let action: IthacaAction | undefined;
      let visible = true;
      for (let object: T.Object3D | null = hit.object; object; object = object.parent) {
        visible &&= object.visible;
        if (object === shop) action = 'shop';
        if (object === workshop) action = 'workshop';
        if (object === polyphemus) action = 'polyphemus';
        if (object === boat) action = 'map';
      }
      if (!visible) continue;
      if (action) {
        markers[action].focus({ preventScroll: true });
        markers[action].click();
      }
      break;
    }
  });

  let time = 0;
  let visualStage = 0;
  let visualTuning = defaultVisualTuning;
  let waterMode: Mode = 'refraction';
  let waterSettings = defaultCollectionSettings(waterMode, true);
  let previousPhase = '';
  let previousRun: Expedition['run'] = null;
  let hadFishingCast = false;
  let rippledMiss: Expedition['missedCast'] = null;
  let rippledImpact: Expedition['impact'] = null;
  let activeLocation: {
    root: T.Group;
    effects: ReturnType<typeof createLocationEffects>;
    water: ReturnType<typeof createGameWater>;
    cameraOffset: T.Vector3;
    targetOffset: T.Vector3;
    framingAxis: T.Vector3;
    framingShift: T.Vector3;
    framingStart: number;
    vertical: number;
  } | null = null;

  function clearLocation() {
    if (!activeLocation) return;
    enemies.reset();
    lighting.clearLocation();
    activeLocation.water.dispose();
    activeLocation.effects.dispose();
    disposeLocation(activeLocation.root);
    activeLocation = null;
  }

  function setLocation({ root, layout }: LoadedLocation) {
    clearLocation();
    root.traverse(object => {
      if (object.name.endsWith('_Foliage')) object.userData.refractiveFoliage = true;
    });
    const { anchors_xyz: anchors } = layout;
    const cameraAnchor = layout.proposed_three_slot === 'pond' ? 'camera_pond' : 'camera_harbor';
    const position = anchors[cameraAnchor];
    const target = anchors[cameraAnchor + '_target'];
    const spawn = new T.Vector3(...anchors.boat_spawn);
    const targetOffset = target ? new T.Vector3(...target).sub(spawn) : new T.Vector3(0, 0, -1.25);
    const cameraOffset = position ? new T.Vector3(...position).sub(spawn) : new T.Vector3(waterCamera.x, waterCamera.y, waterCamera.z);
    const view = new T.Vector3().subVectors(cameraOffset, targetOffset).setY(0).normalize();
    const framing = expeditionFraming[layout.proposed_three_slot];
    const framingAxis = new T.Vector3(view.z, 0, -view.x);
    const framingShift = framingAxis.clone().multiplyScalar(framing.lateral)
      .addScaledVector(view, -framing.forward);
    const effects = createLocationEffects(layout, root);
    try {
      const locationWater = createGameWater(renderer, scene, layout, effects.lamps);
      try {
        locationWater.select(waterMode, waterSettings);
        lighting.setLocation(layout, root);
      } catch (error) {
        lighting.clearLocation();
        locationWater.dispose();
        throw error;
      }
      activeLocation = {
        root, effects, water: locationWater, cameraOffset, targetOffset,
        framingAxis, framingShift, framingStart: spawn.dot(framingAxis), vertical: framing.vertical
      };
      scene.add(root, effects.group);
      enemies.prepare(layout.proposed_three_slot);
      navigationFollow.copy(spawn);
      resizeExpeditionCamera();
    } catch (error) {
      effects.dispose();
      throw error;
    }
  }

  function selectWater(mode: Mode, settings: LabSettings) {
    activeLocation?.water.select(mode, settings);
    waterMode = mode;
    waterSettings = settings;
  }
  const navigationFollow = new T.Vector3();
  const boatAt = new T.Vector3();
  const fishingLook = new T.Vector3();
  const look = new T.Vector3();
  const proj = new T.Vector3();
  const ropeEnd = new T.Vector3();
  const markersByAction = Object.entries(markers) as [IthacaAction, HTMLButtonElement][];
  const target = new T.Vector3();
  const anchor = new T.Vector3();
  const flightStart = new T.Vector3();
  const flightEnd = new T.Vector3();
  const arcPoint = new T.Vector3();
  const arrowOrigin = new T.Vector3();
  const arrowDirection = new T.Vector3();
  let wasFirstPerson = false;

  function resizeExpeditionCamera() {
    const vertical = Math.max(activeLocation?.vertical ?? 10.7, 12 / dockCamera.aspect);
    const horizontal = vertical * dockCamera.aspect;
    Object.assign(expeditionCamera, { left: -horizontal, right: horizontal, top: vertical, bottom: -vertical });
    expeditionCamera.updateProjectionMatrix();
  }

  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    dockCamera.aspect = width / height;
    if (ithaca) {
      const halfWidth = Math.tan(T.MathUtils.degToRad(ithaca.horizontalFov / 2));
      const halfHeight = halfWidth / ithaca.referenceAspect;
      const portraitPadding = T.MathUtils.lerp(.82, 1, T.MathUtils.smoothstep(dockCamera.aspect, .85, 1.45));
      dockCamera.fov = T.MathUtils.radToDeg(2 * Math.atan(Math.max(
        halfHeight, halfWidth * portraitPadding / dockCamera.aspect,
      )));
    }
    dockCamera.updateProjectionMatrix();
    if (ithaca) {
      dockCamera.updateMatrixWorld();
      for (const [action, marker] of markersByAction) {
        proj.copy(ithaca.labels[action]).project(dockCamera);
        marker.style.setProperty('--ithaca-x', `${(proj.x + 1) * 50}%`);
        marker.style.setProperty('--ithaca-y', `${(1 - proj.y) * 50}%`);
      }
    }
    fishingCamera.aspect = dockCamera.aspect;
    fishingCamera.updateProjectionMatrix();
    resizeExpeditionCamera();
    renderer.setSize(width, height, false);
  }
  new ResizeObserver(resize).observe(host);
  resize();
  void loadIthaca().then(hub => {
    ithaca = hub;
    scene.add(hub.root);
    dockCamera.position.copy(hub.cameraFrom);
    dockCamera.lookAt(hub.cameraTarget);
    sky.position.copy(hub.cameraFrom);
    dockSun.shadow.needsUpdate = true;
    resize();
  }).catch(error => {
    dockStatus.textContent = 'Итака не загрузилась. Обнови страницу, чтобы повторить.';
    console.warn('Ithaca models could not be loaded', error);
  });

  function update(dt: number, boatSpeed = 0) {
    time += dt;
    const run = game.run;
    const atDock = !run;
    const firstPerson = game.firstPerson && !game.aiming;
    if (run !== previousRun) blindEye?.resetSail();
    previousRun = run;
    blindEye?.update(game.meta.boat ? 'sail' : 'rowing', atDock, firstPerson, boatSpeed, dt, time);
    if (atDock) {
      visualStage = 0;
      clearLocation();
    }

    const previewStage = visualTuning.stage;
    const desiredStage = run ? (previewStage === 'auto' ? game.stage - 1 : previewStage) : 0;
    const stageDelta = desiredStage - visualStage;
    visualStage += Math.sign(stageDelta) * Math.min(Math.abs(stageDelta), dt / game.balance.wrath.visualTransition);
    const low = Math.floor(visualStage);
    const blend = visualStage - low;
    const a = palettes[low];
    const b = palettes[Math.min(low + 1, 2)];
    const amplitude = atDock ? .055 : T.MathUtils.lerp(a.amplitude, b.amplitude, blend);
    uniforms.uTime.value = time;
    uniforms.uAmplitude.value = amplitude;
    uniforms.uFog.value = T.MathUtils.lerp(a.fog, b.fog, blend);
    uniforms.uSky.value.copy(a.sky).lerp(b.sky, blend);
    uniforms.uDeep.value.copy(a.deep).lerp(b.deep, blend);
    uniforms.uCrest.value.copy(a.crest).lerp(b.crest, blend);
    uniforms.uGlint.value.copy(a.glint).lerp(b.glint, blend);
    if (atDock) {
      uniforms.uSky.value.copy(ithacaPalette.sky);
      uniforms.uDeep.value.copy(ithacaPalette.deep);
      uniforms.uCrest.value.copy(ithacaPalette.crest);
      uniforms.uGlint.value.copy(ithacaPalette.glint);
      uniforms.uFog.value = ithacaPalette.fog;
    }
    fog.color.copy(uniforms.uSky.value);
    fog.density = uniforms.uFog.value;
    sun.intensity = T.MathUtils.lerp(a.sun, b.sun, blend);

    sun.visible = !atDock;
    dockSun.visible = atDock && Boolean(ithaca);
    ambient.intensity = atDock ? 1.30 : T.MathUtils.lerp(1.65, .68, visualStage / 2);
    if (atDock) {
      ambient.color.set('#ccd4e0');
      ambient.groundColor.set('#6b5960');
      if (dockSun.visible && dockSun.shadow.needsUpdate) renderer.shadowMap.needsUpdate = true;
    }
    lighting.update(visualStage, visualTuning);
    (scene.background as T.Color).copy(fog.color);
    sky.visible = horizon.visible = water.visible = atDock && Boolean(ithaca);
    if (ithaca) ithaca.root.visible = mooring.visible = atDock;
    else mooring.visible = false;
    boat.visible = Boolean(run || ithaca);
    const bx = run ? game.position.x : ithaca?.boatPosition.x ?? 0;
    const bz = run ? game.position.z : ithaca?.boatPosition.z ?? 0;
    const heading = run ? game.heading : ithaca?.boatHeading ?? 0;
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    const monster = run ? game.monster : null;
    const monsterHeading = monster ? Math.atan2(bx - monster.x, bz - monster.z) : 0;
    const locationWater = activeLocation?.water;
    camera = atDock ? dockCamera : firstPerson ? fishingCamera : expeditionCamera;
    if (run && locationWater) {
      const visualWrath = previewStage === 'auto'
        ? T.MathUtils.clamp(run.wrath / 100, 0, 1)
        : .04 + visualStage * .4;
      locationWater.update(time, visualWrath, {
        camera, hull: { x: bx, z: bz, heading },
        sky: fog.color, fog: fog.density, sunDirection, sunColor: sun.color, sunPower: sun.intensity,
        surge: run.phase === 'surge' ? T.MathUtils.clamp(run.age / game.balance.wrath.finalPause, 0, 1) : -1,
        threat: monster ? {
          x: monster.x, z: monster.z, strength: Math.min(1, monster.age / enemyTiming.emerge), heading: monsterHeading
        } : undefined
      }, visualStage, visualTuning);
      locationWater.emitWake({ x: bx + dx * 1.9, z: bz + dz * 1.9 }, game.velocity);
    }
    const surface = locationWater
      ? (x: number, z: number) => locationWater.heightAt(x, z)
      : (x: number, z: number) => heightAt(x, z, time, amplitude);
    boat.position.set(bx, (run ? .12 : ithaca?.boatPosition.y ?? 0) + surface(bx, bz), bz);
    if (blindEye) blindEye.root.position.y = run ? .16 : 0;
    boat.rotation.set(
      Math.atan2(surface(bx - dx * 1.3, bz - dz * 1.3) - surface(bx + dx * 1.3, bz + dz * 1.3), 2.6),
      heading,
      Math.atan2(surface(bx + dz * .65, bz - dx * .65) - surface(bx - dz * .65, bz + dx * .65), 1.3),
      'YXZ'
    );
    enemies.update(monster, run ? game.monsterExit : null, dt, surface, locationWater?.ripple);
    weakSpot.visible = Boolean(monster && game.aiming && monster.age >= enemyTiming.emerge
      && enemies.aimPoint(weakSpot.position));
    warning.visible = Boolean(monster);
    if (monster) {
      warning.position.set(monster.x, surface(monster.x, monster.z) + .09, monster.z);
      warning.material.color.set(monster.windup > 0 ? '#ffd29c' : '#ff8059');
      warning.material.opacity = monster.windup > 0 ? .91 : .42 + Math.sin(time * 7) * .11;
      warning.scale.setScalar(monster.windup > 0 ? 1 + monster.windup * .43 : 1);
    }
    spray.visible = run?.phase === 'surge';
    if (spray.visible && run) {
      spray.position.set(bx, surface(bx, bz) + .3, bz);
      spray.scale.setScalar(2 + run.age * 9);
    }

    fisher.visible = !!run && !firstPerson;
    dog.visible = !!run;
    rodPivot.visible = firstPerson || run?.phase === 'cast';
    rodPivot.rotation.z = (run?.rod ?? 0) * .29;
    rodPivot.rotation.x = run?.phase === 'cast' ? Math.sin(Math.min(1, run.age / game.balance.aim.flight) * Math.PI) * -.48 : 0;
    boat.updateMatrixWorld(true);

    const castRange = game.castPoint ? distance(game.position, game.castPoint) : 0;
    const fighting = run?.phase === 'struggle' || run?.phase === 'reel';
    const lookRange = fighting ? run!.distance : castRange;
    if (run) {
      boatAt.set(bx, 0, bz);
      navigationFollow.lerp(boatAt, 1 - Math.exp(-dt * 8));
    }
    if (atDock) {
      if (ithaca) {
        ithaca.update(time);
        const start = ithaca.mooringPier;
        const end = boat.localToWorld(ropeEnd.copy(ithaca.mooringBoat));
        mooringPositions.setXYZ(0, start.x, start.y, start.z);
        mooringPositions.setXYZ(1, (start.x + end.x) * .5, (start.y + end.y) * .5 - .06, (start.z + end.z) * .5);
        mooringPositions.setXYZ(2, end.x, end.y, end.z);
        mooringPositions.needsUpdate = true;
      }
    } else if (firstPerson) {
      const lookAhead = T.MathUtils.clamp(lookRange, 2.1, 7);
      fishingCamera.position.set(bx + dx * .55, 1.47 + (boat.position.y - .12) * .65, bz + dz * .55);
      if (game.castPoint && castRange > 0) {
        const facingCast = between(game.position, game.castPoint, lookAhead / castRange);
        look.set(facingCast.x, .22, facingCast.z);
      } else {
        look.set(bx - dx * lookAhead, .22, bz - dz * lookAhead);
      }
      if (wasFirstPerson) fishingLook.lerp(look, 1 - Math.exp(-dt * 9));
      else fishingLook.copy(look);
      fishingCamera.lookAt(fishingLook);
    } else {
      if (activeLocation) {
        const { cameraOffset, targetOffset, framingAxis, framingShift, framingStart } = activeLocation;
        const distanceAcross = navigationFollow.dot(framingAxis) - framingStart;
        // Center the casting area in narrow touch layouts, then ease back to the scenic framing.
        const framingScale = hasMobileControls() ? T.MathUtils.smoothstep(dockCamera.aspect, .65, 1.3) : 1;
        const lead = framingScale * (1 - .75 * T.MathUtils.smoothstep(distanceAcross, 4, 22));
        camera.position.copy(navigationFollow).add(cameraOffset).addScaledVector(framingShift, lead);
        look.copy(navigationFollow).add(targetOffset).addScaledVector(framingShift, lead);
      } else {
        look.set(bx, 0, bz - 1.25);
        camera.position.set(look.x + waterCamera.x, waterCamera.y, look.z + waterCamera.z);
      }
      camera.lookAt(look);
    }
    wasFirstPerson = firstPerson;
    camera.updateMatrixWorld();
    activeLocation?.effects.update(time, visualStage, surface, visualTuning);

    const signalGain = visualTuning.signals;
    const castPreview = run && game.drawing && !game.aiming ? game.castPreview : null;
    for (const [i, marker] of spots.entries()) {
      const spot = run ? game.schools[i] : null;
      marker.root.visible = Boolean(spot);
      if (!spot) continue;
      const active = spot === game.fishingSpot;
      const selected = spot === castPreview?.school;
      const special = spot.expiresAt !== undefined;
      const clarity = active ? .13 : firstPerson ? .33 : castPreview && !selected ? .55 : 1;
      const hue = special ? (selected ? '#edbbff' : '#ca65ff') : (selected ? '#d9ffd5' : '#adebd9');
      marker.root.position.set(spot.x, surface(spot.x, spot.z) + .12, spot.z);
      marker.boundary.visible = !special;
      marker.specialBoundary.visible = special;
      const boundary = special ? marker.specialBoundary : marker.boundary;
      boundary.material.color.set(hue);
      boundary.material.opacity = Math.min(1, (special ? .94 : selected ? .72 : .36) * clarity * signalGain);
      for (const [index, ripple] of marker.ripples.entries()) {
        const tick = (time * .65 + index * .47) % 1;
        ripple.scale.setScalar(.61 + tick * .50);
        ripple.rotation.y = time * .32 + spot.id * 1.2 + index * Math.PI;
        ripple.material.color.set(special ? hue : '#b9e9db');
        ripple.material.opacity = Math.min(1, (1 - tick) * .51 * clarity * signalGain);
      }
      for (const [index, fish] of marker.fish.entries()) {
        const angle = time * 1.15 + index * .69 + spot.id;
        const radius = .69 - index * .12;
        fish.visible = !active && !firstPerson && signalGain > 0;
        fish.position.set(Math.cos(angle) * radius, .105, Math.sin(angle) * radius);
        fish.rotation.y = -angle - Math.PI / 2;
      }
    }

    const cast = firstPerson || run?.phase === 'cast' ? run?.cast : null;
    const spot = game.castPoint;
    const missedCast = run ? game.missedCast : null;
    if (hadFishingCast && !(cast && spot)) locationWater?.clearRipples();
    hadFishingCast = Boolean(cast && spot);
    if (spot && run && run.phase !== previousPhase) {
      if (run.phase === 'wait' && signalGain > 0) locationWater?.ripple(spot.x, spot.z, .55 * signalGain);
      if (run.phase === 'hook' && signalGain > 0) locationWater?.ripple(spot.x, spot.z, 1.2 * signalGain);
    }
    previousPhase = run?.phase ?? '';
    if (missedCast && missedCast !== rippledMiss && missedCast.age >= game.balance.aim.flight) {
      if (signalGain > 0) locationWater?.ripple(missedCast.end.x, missedCast.end.z, .7 * signalGain);
      rippledMiss = missedCast;
    }
    if (!missedCast) rippledMiss = null;
    float.visible = line.visible = Boolean(cast && spot);
    floatRipple.visible = false;
    bite.root.visible = false;
    floatTip.material.emissiveIntensity = .52;
    if (cast && spot && run) {
      const flight = run.phase === 'cast';
      const biting = run.phase === 'hook';
      anchor.copy(rodTip);
      rodPivot.localToWorld(anchor);
      if (flight) {
        const t = Math.min(1, run.age / game.balance.aim.flight);
        flightEnd.set(spot.x, surface(spot.x, spot.z), spot.z);
        sampleFlight(target, anchor, flightEnd, flightLift(castRange, false), t);
      } else {
        const t = fighting ? Math.min(1.23, Math.max(Math.min(1, 2.05 / castRange), run.distance / castRange)) : 1;
        const point = between(game.position, spot, t);
        const tug = fighting ? run.fishX * .45 : 0;
        target.set(point.x + tug * dz, 0, point.z - tug * dx);
        const dip = biting ? Math.exp(-run.age * 9) * Math.sin(run.age * 34) * .24 : 0;
        target.y = surface(target.x, target.z) - dip;
      }
      const surfaceHeight = surface(target.x, target.z);
      float.position.copy(target);
      floatRipple.visible = !flight;
      floatRipple.position.set(target.x, surfaceHeight + .11, target.z);
      const tick = biting ? Math.min(1, run.age / .42) : (time * .72) % 1;
      floatRipple.scale.setScalar(1 + tick * (biting ? 1.7 : .7));
      floatRipple.material.opacity = Math.min(1, (1 - tick) * (biting ? .88 : .33) * signalGain);
      if (biting && run.age < .38) {
        const progress = run.age / .38;
        bite.root.visible = signalGain > 0;
        bite.root.position.set(target.x, surfaceHeight + .055, target.z);
        bite.root.rotation.y = Math.atan2(spot.x - bx, spot.z - bz);
        bite.material.opacity = Math.min(1, (1 - progress) * signalGain);
        floatTip.material.emissiveIntensity = .52 + (1 - progress) * .7;
        for (const [index, drop] of bite.droplets.entries()) {
          const spread = (index - 3) / 3;
          const arc = 4 * progress * (1 - progress);
          drop.position.set(spread * progress * .62, arc * (.46 - Math.abs(spread) * .21), progress * (.42 + index * .084));
        }
      }
      linePositions.setXYZ(0, anchor.x, anchor.y, anchor.z);
      linePositions.setXYZ(1, (anchor.x + target.x) / 2, (anchor.y + float.position.y) / 2 - .15, (anchor.z + target.z) / 2);
      linePositions.setXYZ(2, target.x, float.position.y + .31, target.z);
      linePositions.needsUpdate = true;
    } else if (missedCast) {
      const { start, end, age } = missedCast;
      const flightTime = game.balance.aim.flight;
      const waterHeight = surface(end.x, end.z);
      if (age < flightTime) {
        flightStart.set(start.x, surface(start.x, start.z) + 1.55, start.z);
        flightEnd.set(end.x, waterHeight, end.z);
        sampleFlight(float.position, flightStart, flightEnd, flightLift(distance(start, end), false), age / flightTime);
        float.visible = true;
      } else {
        const rippleAge = (age - flightTime) / .4;
        floatRipple.visible = true;
        floatRipple.position.set(end.x, waterHeight + .11, end.z);
        floatRipple.scale.setScalar(.7 + rippleAge * 1.6);
        floatRipple.material.opacity = Math.min(1, (1 - rippleAge) * .85 * signalGain);
      }
    }

    const bowAim = run && game.aiming ? game.shotEnd : null;
    const aim = bowAim ?? castPreview?.point;
    crosshair.visible = aimLine.visible = Boolean(aim);
    weapon.visible = Boolean(run && game.aiming);
    weapon.position.set(bx + .32, boat.position.y + 1.20, bz);
    weapon.rotation.y = bowAim ? Math.atan2(bx - bowAim.x, bz - bowAim.z) : heading;
    if (weapon.visible) {
      stringPositions.setXYZ(0, 0, -.54, .16);
      stringPositions.setXYZ(1, 0, 0, .16 + game.charge * .42);
      stringPositions.setXYZ(2, 0, .54, .16);
      stringPositions.needsUpdate = true;
    }
    if (aim) {
      let color = '#f1d599';
      if (castPreview?.school) color = castPreview.school.expiresAt !== undefined ? '#e2a8ff' : '#bdf6c9';
      else if (castPreview && !castPreview.open) color = '#e38874';
      const landingHeight = surface(aim.x, aim.z);
      const height = landingHeight + .15;
      crosshair.position.set(aim.x, height, aim.z);
      crosshair.material.color.set(color);
      crosshair.material.opacity = .96;
      aimLine.material.color.set(color);
      flightStart.set(bx, boat.position.y + (bowAim ? 1.20 : 1.43), bz);
      flightEnd.set(aim.x, height, aim.z);
      const lift = flightLift(distance(game.position, aim), Boolean(bowAim));
      for (let i = 0; i <= arcSegments; i += 1) {
        sampleFlight(arcPoint, flightStart, flightEnd, lift, i / arcSegments);
        arcPositions.setXYZ(i, arcPoint.x, arcPoint.y, arcPoint.z);
      }
      arcPositions.needsUpdate = true;
    }

    const arrow = run ? game.arrow : null;
    feather.visible = Boolean(arrow);
    if (arrow) {
      const t = arrow.age / arrow.travel;
      const lift = flightLift(distance(arrow.start, arrow.end), true);
      flightStart.set(arrow.start.x, surface(arrow.start.x, arrow.start.z) + 1.32, arrow.start.z);
      flightEnd.set(arrow.end.x, surface(arrow.end.x, arrow.end.z) + .15, arrow.end.z);
      sampleFlight(arrowOrigin, flightStart, flightEnd, lift, t);
      arrowDirection.subVectors(flightEnd, flightStart);
      arrowDirection.y += 4 * lift * (1 - 2 * t);
      feather.position.copy(arrowOrigin);
      feather.lookAt(arrowOrigin.add(arrowDirection));
    }

    const impact = run ? game.impact : null;
    splash.visible = Boolean(impact);
    if (impact) {
      if (impact !== rippledImpact) locationWater?.ripple(impact.x, impact.z, impact.hit ? 1.1 : .6);
      splash.position.set(impact.x, surface(impact.x, impact.z) + .16, impact.z);
      splash.material.color.set(impact.hit ? '#ffe2a5' : '#c4cfc1');
      splash.material.opacity = 1 - impact.age / .55;
      splash.scale.setScalar(.59 + impact.age * 4);
    }
    rippledImpact = impact;

    if (locationWater) {
      // Capture the static shadow map in the main scene, outside clipped optical passes.
      const refreshShadows = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.needsUpdate = false;
      try {
        locationWater.renderPasses(camera);
      } finally {
        renderer.shadowMap.needsUpdate = refreshShadows;
      }
    }
    visualPost.render(camera, {
      tuning: visualTuning, stage: visualStage, time, basin: locationWater?.visualBasin,
      boat: boat.position, headingX: dx, headingZ: dz, wind: waterSettings.wind,
      bobber: float.visible ? float.position : null,
    }, captureDepth => {
      if (!locationWater) {
        renderer.render(scene, camera);
        return;
      }
      let depth: T.DepthTexture | undefined;
      lighting.render(camera, () => { depth = locationWater.renderScene(camera, captureDepth); });
      return depth;
    });
    if (atDock && ithaca && !dockUI.dataset.ithaca) {
      dockStatus.textContent = '';
      dockUI.dataset.ithaca = 'ready';
    }
  }

  update(0);
  return {
    update, pointAt, setLocation, clearLocation, selectWater, prepareSail,
    setVisualTuning(tuning: VisualTuning) {
      visualTuning = { ...tuning };
    },
  };
}
