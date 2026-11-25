import * as T from 'three';
import { createWater, waterEffects, type Shore, type WaterBounds, type WaterLighting, type WaterPoint } from '../water';
import { makeCoastAtlas, WakeField } from '../water/fields';
import { fitLocationSurface, type LocationSurface } from '../water/location-surface';
import { createWatercolorBed } from '../watercolor-bed';
import { createWatercolorPost } from '../watercolor-post';
import { createPaintedWater } from '../watercolor-water';
import { createBreakers, type BreakerSite } from './breaker';
import { defaultCollectionSettings, type LabSettings, type Mode } from './collection-settings';
import { createLayerScenery } from './layerscenery';
import { createLabMirror } from './mirror';
import { createRefraction } from './refraction';
import { createLabUniforms, waterHeight } from './shared';
import { createSlopeLight } from './slope-light';

export type CollectionCamera = T.OrthographicCamera | T.PerspectiveCamera;
type Bed = ReturnType<typeof createWatercolorBed>;
export type ExpeditionWaterStyle = {
  deep: T.Color;
  shallow: T.Color;
  mixing: number;
  foam: number;
  foamGain: number;
  glints: number;
  caustics: number;
  lamps: number;
};
export type CollectionFrame = WaterLighting & {
  camera: CollectionCamera;
  hull?: WaterPoint & { heading: number };
  surge?: number;
  threat?: WaterPoint & { strength: number; heading: number };
  expedition?: ExpeditionWaterStyle;
};
export type WaterCollectionOptions = {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  bounds: WaterBounds;
  shores?: readonly Shore[];
  lamps?: readonly { position: T.Vector3; strength: number }[];
  bed?: Bed;
  mode?: Mode;
  settings?: Partial<LabSettings>;
  comparisonScenery?: boolean;
  postprocess?: boolean;
  breakerSites?: readonly [BreakerSite, BreakerSite];
  locationSurface?: LocationSurface;
};

const classicVariants = { harbor: 'A', spectral: 'B', lagoon: 'C' } as const;
const opticalStyles = { refraction: 0, meadow: 1, wreck: 2, night: 3 } as const;
const defaultSun = new T.Color('#ffe4ae');
const defaultSky = new T.Color('#aac4c1');
const watercolorStormSky = new T.Color('#233446');
const harborSettings = () => defaultCollectionSettings('harbor');

function isClassic(mode: Mode): mode is keyof typeof classicVariants {
  return Object.hasOwn(classicVariants, mode);
}

function isOptical(mode: Mode): mode is keyof typeof opticalStyles {
  return Object.hasOwn(opticalStyles, mode);
}

function automaticBreakerSites({ minX, maxX, minZ, maxZ }: WaterBounds): readonly [BreakerSite, BreakerSite] {
  const width = maxX - minX, depth = maxZ - minZ;
  return [
    { x: minX + width * .56, z: minZ + depth * .31, span: Math.min(5.15, width * .16), angle: .6 },
    { x: minX + width * .33, z: minZ + depth * .23, span: Math.min(3.80, width * .12), angle: .81 },
  ];
}

export function createWaterCollection({
  renderer, scene, bounds, shores = [], lamps, bed: externalBed, mode = 'refraction',
  settings: initialSettings, comparisonScenery = false, postprocess = true, breakerSites, locationSurface,
}: WaterCollectionOptions) {
  const bed = externalBed ?? (locationSurface ? undefined : createWatercolorBed(shores, bounds, { stableFoliage: true }));
  if (bed && !externalBed) scene.add(bed.group);
  const normalBedVisibility = bed?.group.visible ?? false;
  const normalFoliageVisibility = bed?.foliage.visible ?? false;
  const normalFloorVisibility = bed?.floor.visible ?? false;
  const paintedShores = shores.map(shore => ({ ...shore, shelf: shore.shelf && shore.shelf * 1.9 }));
  const paintedBed = locationSurface ? undefined : createWatercolorBed(paintedShores, bounds, { stableFoliage: true });
  const painted = createPaintedWater(bounds, paintedShores, paintedBed?.group, locationSurface);
  const post = postprocess ? createWatercolorPost() : undefined;
  const classic = createWater({ bounds, shores, apron: locationSurface ? 0 : undefined, locationSurface });
  if (lamps) {
    classic.setLamps(lamps);
    painted.water.setLamps(lamps);
  }
  scene.add(classic.mesh, painted.water.mesh);

  const uniforms = createLabUniforms();
  uniforms.uGameWater.value = Number(!!locationSurface);
  if (locationSurface && lamps) {
    for (const [index, lamp] of lamps.slice(0, 4).entries()) {
      uniforms.uSceneLamps.value[index].set(lamp.position.x, lamp.position.y, lamp.position.z, lamp.strength);
    }
  }
  const { minX, minZ, maxX, maxZ } = bounds;
  const width = maxX - minX, depth = maxZ - minZ;
  const rect = new T.Vector4(minX, minZ, width, depth);
  uniforms.uWorldRect.value = rect;
  const coast = locationSurface?.map ?? makeCoastAtlas(bounds, shores);
  const wake = new WakeField(rect);
  uniforms.uShoreMap.value = coast;
  uniforms.uWake.value = wake.target.texture;

  const apron = locationSurface ? 0 : 30;
  const geometry = new T.PlaneGeometry(width + apron * 2, depth + apron * 2,
    Math.min(260, Math.ceil((width + apron * 2) / .55)),
    Math.min(230, Math.ceil((depth + apron * 2) / .55)));
  geometry.rotateX(-Math.PI / 2);
  const uLayerStyle = { value: 0 }, uLayerAmount = { value: 1 };
  const sea = new T.Mesh<T.BufferGeometry,T.Material>(geometry);
  const placeholder = sea.material;
  const optics = createRefraction(renderer, scene, sea, { ...uniforms, uLayerStyle, uLayerAmount }, locationSurface);
  const slopes = createSlopeLight(uniforms);
  const breakers = createBreakers(uniforms,
    breakerSites ?? (comparisonScenery ? undefined : automaticBreakerSites(bounds)), locationSurface);
  fitLocationSurface(optics.material, locationSurface);
  fitLocationSurface(slopes.material, locationSurface, true);
  fitLocationSurface(breakers.material, locationSurface, true);
  if (locationSurface) sea.renderOrder = -1;
  scene.add(sea, breakers.group);
  sea.name = 'Water collection';
  sea.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  sea.frustumCulled = false;
  const sceneLayers = comparisonScenery && bed ? createLayerScenery(scene, bed) : undefined;
  const mirror = createLabMirror(renderer, scene, uniforms, 'camera');
  const worldSun = new T.Vector3();
  const baseSun = uniforms.uSun.value.clone();
  const paintSky = new T.Color(), paintSun = new T.Color();
  const crest = new T.Color();
  const surfacePalette = { deep: uniforms.uDeep.value, shallow: uniforms.uShallow.value, crest };
  let time = 0;
  let chosenMode = mode;
  let currentMode: Mode | undefined;
  let settings = { ...defaultCollectionSettings(mode), ...initialSettings };
  let cameraSupportsLab = true;
  let active = settings;

  function activate() {
    const next = cameraSupportsLab || isClassic(chosenMode) || chosenMode === 'watercolor' ? chosenMode : 'harbor';
    if (next !== currentMode) {
      currentMode = next;
      const classicActive = isClassic(next);
      classic.mesh.visible = classicActive;
      if (classicActive) classic.setVariant(classicVariants[next]);
      painted.water.mesh.visible = next === 'watercolor';
      sea.visible = !classicActive && next !== 'watercolor';
      breakers.group.visible = next === 'breaker';
      sea.material = next === 'breaker' ? breakers.material : next === 'slope' ? slopes.material : optics.material;
      sceneLayers?.setMode(isOptical(next) ? next : 'refraction');
      if (bed) {
        bed.group.visible = normalBedVisibility && isOptical(next);
        bed.foliage.visible = normalFoliageVisibility && (!sceneLayers || next === 'refraction');
        bed.floor.visible = sceneLayers && isOptical(next) && next !== 'refraction' ? false : normalFloorVisibility;
      }
    }
    active = currentMode === chosenMode ? settings : {
      ...harborSettings(), waves: settings.waves, light: settings.light, shallow: settings.shallow, deep: settings.deep,
      ...(locationSurface && { reflection: .68, detail: settings.detail * .87, foam: .86, waveScale: .93, scattering: .76 }),
    };
  }

  function select(next: Mode, overrides?: Partial<LabSettings>) {
    if (locationSurface && chosenMode !== next) clearTransient();
    chosenMode = next;
    settings = { ...defaultCollectionSettings(next), ...overrides };
    activate();
  }

  function update(now: number, wrath: number, frame: CollectionFrame) {
    time = now;
    const normalizedWrath = T.MathUtils.clamp(wrath, 0, 1);
    const paintedMode = chosenMode === 'watercolor';
    const supportsLab = frame.camera instanceof T.OrthographicCamera;
    if (cameraSupportsLab !== supportsLab) {
      cameraSupportsLab = supportsLab;
      activate();
    }
    const mode = currentMode!;
    const hull = frame.hull;
    const canShowHull = !!hull;
    const heading = hull?.heading ?? 0;
    const x = hull?.x ?? 1000, z = hull?.z ?? 1000;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    uniforms.uHull.value.set(x, z, fx, fz);
    uniforms.uTime.value = time;
    uniforms.uWrath.value = normalizedWrath;
    uniforms.uWaves.value = active.waves;
    uniforms.uWind.value = active.wind;
    uniforms.uLight.value = active.light;
    const style = frame.expedition;
    const causticGain = style?.caustics ?? 1;
    uniforms.uFeature.value = active.feature * (isOptical(mode) ? causticGain : 1);
    uniforms.uDetail.value = active.detail;
    uniforms.uDeep.value.set(active.deep);
    uniforms.uShallow.value.set(active.shallow);
    const sceneSun = frame.sunPower ?? 1;
    if (style) {
      uniforms.uDeep.value.lerp(style.deep, style.mixing);
      uniforms.uShallow.value.lerp(style.shallow, style.mixing);
      crest.set(active.crest ?? active.shallow).lerp(style.shallow, style.mixing * .72);
      uniforms.uSceneSky.value.copy(frame.sky ?? defaultSky);
      uniforms.uSceneFog.value = (frame.fog ?? .006) * .52;
      uniforms.uSceneSun.value = style.glints * Math.min(sceneSun / 1.4, 1.55);
      uniforms.uSceneFoam.value = style.foam * style.foamGain;
      uniforms.uSceneLampGain.value = style.lamps;
    }
    if (paintedMode && !frame.sunDirection) {
      worldSun.set(-.57, (active.elevation ?? .82) * 1.6, -.81).normalize();
    } else {
      worldSun.copy(frame.sunDirection ?? baseSun).normalize();
    }
    uniforms.uSun.value.copy(worldSun);
    uniforms.uSunColor.value.copy(frame.sunColor ?? defaultSun);
    uLayerStyle.value = isOptical(mode) ? opticalStyles[mode] : 0;
    uLayerAmount.value = active.layer;
    if (isOptical(mode)) {
      bed?.update(time, normalizedWrath);
      sceneLayers?.update(time, normalizedWrath, active.layer);
    }
    // Keep the procedural breaker phase synchronous with the common wave clock while hidden.
    breakers.update(time);
    if (!isClassic(mode) && mode !== 'watercolor') return;

    const water = mode === 'watercolor' ? painted.water : classic;
    const target = water.settings;
    target.waveScale = active.waveScale ?? target.waveScale;
    target.waveHeight = active.waves;
    target.shallow = active.shallow;
    target.deep = active.deep;
    target.crest = active.crest ?? active.shallow;
    target.reflection = active.reflection ?? target.reflection;
    target.distortion = active.detail;
    const foam = active.foam ?? 1;
    target.foam = foam * (style ? T.MathUtils.lerp(.60, 1, style.foam) * style.foamGain : 1);
    target.wake = active.wake ?? (mode === 'watercolor' ? foam * 1.23 : 1);
    target.clarity = active.clarity ?? 1;
    target.roughness = active.roughness ?? .38;
    target.scattering = active.scattering ?? 1;
    target.stormStrength = active.stormStrength ?? 1;
    target.reflectionQuality = mode === 'watercolor' ? 'off' : (active.reflectionQuality ?? 'balanced');
    Object.assign(water.effects, waterEffects, active.effects);
    let fog = (frame.fog ?? .006) * (style && supportsLab ? .52 : 1);
    let sky = frame.sky ?? defaultSky;
    let sunColor = frame.sunColor ?? defaultSun;
    if (mode === 'watercolor') {
      const storm = T.MathUtils.smoothstep(normalizedWrath, 0, 1);
      if (frame.fog === undefined) fog = .004 + storm * .008;
      sky = frame.sky ?? paintSky.set(active.sky ?? '#59757a').lerp(watercolorStormSky, storm);
      sunColor = frame.sunColor ?? paintSun.set(active.sun ?? '#faf0cd');
      painted.ink.set(active.ink ?? '#22293c');
      painted.hull.set(x, z, -fx, -fz);
      painted.surge.value = frame.surge ?? -1;
      const threat = frame.threat;
      painted.threat.set(threat?.x ?? 0, threat?.z ?? 0, threat?.strength ?? 0, threat?.heading ?? 0);
      paintedBed?.update(time, normalizedWrath);
    }
    water.update(time, normalizedWrath, {
      sky, fog, sunDirection: worldSun, sunColor,
      sunPower: style ? sceneSun * style.glints * active.light : (frame.sunPower ?? active.light),
      ...(style && { surfacePalette }),
      causticGain, lampGain: style?.lamps,
      glintOrigin: frame.glintOrigin ?? (canShowHull && mode !== 'watercolor' ? { x: x - 3, z: z - 6 } : { x: -3, z: -6 }),
    });
  }

  function renderPasses(camera: CollectionCamera) {
    const mode = currentMode!;
    if (isClassic(mode)) {
      classic.renderPasses(renderer, scene, camera);
    } else if (mode === 'watercolor') {
      painted.prepare(renderer, scene, camera, { bottom: active.bottom !== false,
        clarity: active.clarity ?? 2.4, glints: active.glints ?? 1.15, caustics: active.caustics ?? .78 });
    } else if (camera instanceof T.OrthographicCamera) {
      camera.getWorldDirection(uniforms.uEye.value).negate();
      uniforms.uWakeOn.value = Number(wake.render(renderer, time));
      const visible = sea.visible;
      const crestsVisible = breakers.group.visible;
      try {
        sea.visible = false;
        breakers.group.visible = false;
        mirror.render(camera);
      } finally {
        sea.visible = visible;
        breakers.group.visible = crestsVisible;
      }
      if (isOptical(mode)) optics.render(camera);
    }
  }

  function renderScene(camera: CollectionCamera, captureDepth = false) {
    if (post && currentMode === 'watercolor') {
      return post.render(renderer, scene, camera, { enabled: active.painted !== false, time, wrath: uniforms.uWrath.value,
        brush: active.brush ?? .70, grain: active.grain ?? .45, relief: active.relief ?? .34 }, captureDepth);
    }
    renderer.render(scene, camera);
  }

  function clearRipples() {
    classic.clearRipples();
    painted.water.clearRipples();
    uniforms.uCast.value.set(1000, 1000, -100, 0);
  }

  function clearTransient() {
    classic.clearTransient();
    painted.water.clearTransient();
    wake.clear();
    uniforms.uCast.value.set(1000, 1000, -100, 0);
  }

  activate();
  return {
    get mode() { return chosenMode; },
    get effectiveMode() { return currentMode!; },
    select, update, renderPasses, renderScene,
    heightAt(x: number, z: number) {
      if (currentMode === 'watercolor') return painted.water.heightAt(x,z);
      if (isClassic(currentMode!)) return classic.heightAt(x,z);
      return waterHeight(x,z,time,active.waves,uniforms.uWrath.value,active.wind)
        + (currentMode === 'breaker' ? breakers.displacementAt(x,z) : 0);
    },
    emitWake(stern: WaterPoint, velocity: WaterPoint) {
      classic.emitWake(stern, velocity, time);
      painted.water.emitWake(stern, velocity, time);
      wake.emit(time, stern, velocity);
    },
    ripple(x: number, z: number, strength = 1) {
      classic.ripple(x, z, strength, time);
      painted.water.ripple(x, z, strength, time);
      uniforms.uCast.value.set(x, z, time, strength);
    },
    clearRipples, clearTransient,
    dispose() {
      sceneLayers?.dispose();
      if (externalBed && bed) {
        bed.group.visible = normalBedVisibility;
        bed.foliage.visible = normalFoliageVisibility;
        bed.floor.visible = normalFloorVisibility;
      } else bed?.dispose();
      paintedBed?.dispose();
      painted.dispose();
      classic.dispose();
      post?.dispose();
      optics.dispose();
      slopes.dispose();
      breakers.dispose();
      mirror.dispose();
      wake.dispose();
      if (!locationSurface) coast.dispose();
      sea.removeFromParent();
      geometry.dispose();
      placeholder.dispose();
    },
  };
}
