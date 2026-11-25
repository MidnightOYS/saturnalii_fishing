import * as T from 'three';
import { makeCoastAtlas, makeWaterDetail, WakeField, type Shore, type WaterBounds, type WaterPoint } from './fields';
import { fragmentShader, vertexShader } from './material';
import { WaveField } from './waves';
import { SpectralWaveField, spectralVertex } from './spectrum';
import { LagoonWaveField, lagoonVertex } from './lagoon';
import { spectralFragment, lagoonFragment } from './optics';
import { fitLocationSurface, type LocationSurface } from './location-surface';

export { poseBoat } from './waves';
export type { Shore, WaterBounds, WaterPoint } from './fields';

export type WaterVariant = 'A' | 'B' | 'C';
export type ReflectionQuality = 'off' | 'balanced' | 'full';
export type WaterEffects = {
  waves: boolean;
  capillary: boolean;
  reflection: boolean;
  depth: boolean;
  crestLight: boolean;
  sunGlint: boolean;
  lamps: boolean;
  shoreFoam: boolean;
  crestFoam: boolean;
  wake: boolean;
  ripples: boolean;
};

export const waterEffects: Readonly<WaterEffects> = Object.freeze({
  waves: true, capillary: true, reflection: true, depth: true, crestLight: true, sunGlint: true,
  lamps: true, shoreFoam: true, crestFoam: true, wake: true, ripples: true,
});

export type WaterSettings = {
  waveScale: number;
  waveHeight: number;
  reflection: number;
  distortion: number;
  shallow: string;
  deep: string;
  crest: string;
  roughness: number;
  scattering: number;
  clarity: number;
  foam: number;
  wake: number;
  stormStrength: number;
  reflectionQuality: ReflectionQuality;
};

export const waterPreset: Readonly<WaterSettings> = Object.freeze({
  waveScale: 1,
  waveHeight: 1,
  reflection: 1.18,
  distortion: 1.65,
  shallow: '#6d784b',
  deep: '#153e48',
  crest: '#64ac9b',
  roughness: .38,
  scattering: 1,
  clarity: 1,
  foam: 1.05,
  wake: 1.03,
  stormStrength: 1,
  reflectionQuality: 'balanced',
});

export const waterVariants: Readonly<Record<WaterVariant, Readonly<WaterSettings>>> = Object.freeze({
  A: waterPreset,
  B: Object.freeze({ ...waterPreset, shallow: '#517f72', deep: '#16435d', crest: '#53b9b2',
    waveHeight: 1.08, reflection: 1.28, distortion: 1.86, foam: 1.17, roughness: .36, scattering: 1.12 }),
  C: Object.freeze({ ...waterPreset, shallow: '#a49b5c', deep: '#163d46', crest: '#73c7b0',
    waveHeight: .94, reflection: 1.14, distortion: 1.39, foam: .97, roughness: .28, scattering: 1.18, clarity: 1.33 }),
});

export type WaterLighting = {
  sky?: T.Color;
  fog?: number;
  sunDirection?: T.Vector3;
  sunColor?: T.Color;
  sunPower?: number;
  glintOrigin?: WaterPoint;
  surfacePalette?: { deep: T.Color; shallow: T.Color; crest: T.Color };
  causticGain?: number;
  lampGain?: number;
};

type WaterOptions = {
  bounds: WaterBounds;
  shores?: readonly Shore[];
  settings?: Partial<WaterSettings>;
  variant?: WaterVariant;
  /** A finite geometry apron hides the playable bounds at the viewport edge. */
  apron?: number;
  locationSurface?: LocationSurface;
};
type ShoreLamp = { position: T.Vector3; strength: number };
type SceneCamera = T.OrthographicCamera | T.PerspectiveCamera;

const qualityScale = { off: 0, balanced: .48, full: 1 };
const maxRipples = 6;
const rippleLifetime = 1.42;

export function createWater({ bounds, shores = [], settings: overrides, variant: initialVariant = 'A', apron = 18, locationSurface }: WaterOptions) {
  const settings: WaterSettings = { ...waterVariants[initialVariant], ...overrides };
  const effects: WaterEffects = { ...waterEffects };
  const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
  const worldRect = new T.Vector4(bounds.minX, bounds.minZ, width, depth);
  const waves = new WaveField();
  let variant: WaterVariant = 'A';
  let spectrum: SpectralWaveField | undefined;
  const wake = new WakeField(worldRect);
  let coast = locationSurface?.map ?? makeCoastAtlas(bounds, shores);
  const lagoon = new LagoonWaveField(bounds, coast);
  const detail = makeWaterDetail();
  const rendererSize = new T.Vector2();
  const mirror = new T.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
  const clip = new T.Plane(new T.Vector3(0, 1, 0), .04);
  const reflected = { ortho: new T.OrthographicCamera(), perspective: new T.PerspectiveCamera() };
  const reflectedForward = new T.Vector3(), reflectedUp = new T.Vector3();
  const position = new T.Vector3(), forward = new T.Vector3();
  let lamps: readonly ShoreLamp[] = [];
  let sunPower = 1;
  const ripples: { x: number; z: number; time: number; strength: number }[] = [];
  const uniforms = {
    uWaves: { value: waves.uniforms },
    tSpectrum: { value: null as T.DataTexture | null },
    uSpectrum: { value: null as T.Vector4 | null },
    uLagoon: { value: lagoon.params },
    uRoughness: { value: 0 }, uScattering: { value: 0 }, uClarity: { value: 0 },
    uTime: { value: 0 }, uStorm: { value: 0 }, uFoam: { value: 0 },
    uWake: { value: 0 }, uWakeActive: { value: 0 },
    uReflect: { value: 0 }, uDistortion: { value: 0 }, uFog: { value: .012 },
    uDeep: { value: new T.Color() }, uShallow: { value: new T.Color() },
    uCrestColor: { value: new T.Color('#64ac9b') }, uSky: { value: new T.Color('#849398') },
    uSunDir: { value: new T.Vector3(-.41, .69, -.60).normalize() },
    uSunColor: { value: new T.Color('#ffdfac') }, uSunPower: { value: 1 },
    uCapillaryOn: { value: 1 }, uDepthOn: { value: 1 }, uCrestLightOn: { value: 1 }, uCausticGain: { value: 1 },
    uShoreFoamOn: { value: 1 }, uCrestFoamOn: { value: 1 },
    uOrthoEye: { value: new T.Vector3() }, uGlintOrigin: { value: new T.Vector2(-3, -11) },
    uWorldRect: { value: worldRect },
    uReflectMatrix: { value: new T.Matrix4() },
    uRipples: { value: Array.from({ length: maxRipples }, () => new T.Vector4()) },
    uLamps: { value: Array.from({ length: 4 }, () => new T.Vector4()) },
    tCoast: { value: coast }, tDetail: { value: detail }, tReflection: { value: mirror.texture },
    tWake: { value: wake.target.texture },
  };
  const waterWidth = width + apron * 2, waterDepth = depth + apron * 2;
  const geometry = new T.PlaneGeometry(waterWidth, waterDepth, Math.ceil(waterWidth / .48), Math.ceil(waterDepth / .48));
  geometry.rotateX(-Math.PI / 2);
  const materials = {
    A: new T.ShaderMaterial({ name: 'GnevGlubinWater', uniforms, vertexShader, fragmentShader }),
    B: new T.ShaderMaterial({ name: 'GnevGlubinSpectrum', uniforms, vertexShader: spectralVertex, fragmentShader: spectralFragment }),
    C: new T.ShaderMaterial({ name: 'GnevGlubinLagoon', uniforms, vertexShader: lagoonVertex, fragmentShader: lagoonFragment }),
  };
  for (const material of Object.values(materials)) fitLocationSurface(material, locationSurface, true);
  const mesh = new T.Mesh(geometry, materials.A);
  if (locationSurface) mesh.renderOrder = -1;
  mesh.name = 'Water surface';
  mesh.position.set(bounds.minX + width * .5, 0, bounds.minZ + depth * .5);
  mesh.frustumCulled = false;
  let time = 0;
  let previousShallow = '', previousDeep = '', previousCrest = '';
  const baseShallow = new T.Color(), baseDeep = new T.Color(), baseCrest = new T.Color();

  function setVariant(next: WaterVariant) {
    variant = next;
    if (variant === 'B' && !spectrum) {
      spectrum = new SpectralWaveField();
      uniforms.tSpectrum.value = spectrum.texture;
      uniforms.uSpectrum.value = spectrum.params;
    }
    mesh.material = materials[variant];
  }

  function update(now: number, wrath: number, light: WaterLighting = {}) {
    time = now;
    const storm = T.MathUtils.clamp(wrath * settings.stormStrength, 0, 1);
    const weather = T.MathUtils.smoothstep(storm, 0, 1);
    const scale = T.MathUtils.clamp(settings.waveScale, .7, 1.8);
    const height = effects.waves ? T.MathUtils.clamp(settings.waveHeight, 0, 1.6) : 0;
    if (variant === 'A') waves.update(time, storm, scale, height);
    else if (variant === 'B') spectrum!.update(time, weather, scale, height);
    else lagoon.update(time, weather, scale, height);
    uniforms.uTime.value = time;
    uniforms.uStorm.value = weather;
    uniforms.uFoam.value = settings.foam;
    uniforms.uCapillaryOn.value = Number(effects.capillary);
    uniforms.uDepthOn.value = Number(effects.depth);
    uniforms.uCrestLightOn.value = Number(effects.crestLight);
    uniforms.uShoreFoamOn.value = Number(effects.shoreFoam);
    uniforms.uCrestFoamOn.value = Number(effects.crestFoam);
    uniforms.uWake.value = settings.wake;
    uniforms.uDistortion.value = settings.distortion;
    if (settings.shallow !== previousShallow) baseShallow.set(previousShallow = settings.shallow);
    if (settings.deep !== previousDeep) baseDeep.set(previousDeep = settings.deep);
    if (settings.crest !== previousCrest) baseCrest.set(previousCrest = settings.crest);
    uniforms.uShallow.value.copy(light.surfacePalette?.shallow ?? baseShallow);
    uniforms.uDeep.value.copy(light.surfacePalette?.deep ?? baseDeep);
    uniforms.uCrestColor.value.copy(light.surfacePalette?.crest ?? baseCrest);
    uniforms.uRoughness.value = settings.roughness;
    uniforms.uScattering.value = settings.scattering;
    uniforms.uClarity.value = settings.clarity;
    uniforms.uCausticGain.value = light.causticGain ?? 1;
    if (light.sky) uniforms.uSky.value.copy(light.sky);
    if (light.fog !== undefined) uniforms.uFog.value = light.fog;
    if (light.sunDirection) uniforms.uSunDir.value.copy(light.sunDirection).normalize();
    if (light.sunColor) uniforms.uSunColor.value.copy(light.sunColor);
    if (light.sunPower !== undefined) sunPower = light.sunPower;
    uniforms.uSunPower.value = effects.sunGlint ? sunPower : 0;
    for (const [i, uniform] of uniforms.uLamps.value.entries()) {
      const lamp = lamps[i];
      if (lamp && effects.lamps) uniform.set(lamp.position.x, lamp.position.y, lamp.position.z, lamp.strength * (light.lampGain ?? 1));
      else uniform.w = 0;
    }
    if (light.glintOrigin) uniforms.uGlintOrigin.value.set(light.glintOrigin.x, light.glintOrigin.z);
  }

  function renderReflection(renderer: T.WebGLRenderer, scene: T.Scene, camera: SceneCamera, ratio: number) {
    renderer.getDrawingBufferSize(rendererSize);
    const cap = Math.min(ratio, 2048 / Math.max(rendererSize.x, rendererSize.y));
    const w = Math.max(1, Math.round(rendererSize.x * cap));
    const h = Math.max(1, Math.round(rendererSize.y * cap));
    if (mirror.width !== w || mirror.height !== h) mirror.setSize(w, h);

    const virtual = camera instanceof T.OrthographicCamera ? reflected.ortho : reflected.perspective;
    virtual.position.set(position.x, -position.y, position.z);
    reflectedForward.set(forward.x, -forward.y, forward.z);
    reflectedUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    reflectedUp.y *= -1;
    virtual.up.copy(reflectedUp);
    virtual.lookAt(reflectedForward.add(virtual.position));
    virtual.layers.mask = camera.layers.mask;
    virtual.near = camera.near;
    virtual.far = camera.far;
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    virtual.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    virtual.updateMatrixWorld();
    uniforms.uReflectMatrix.value.multiplyMatrices(virtual.projectionMatrix, virtual.matrixWorldInverse);

    mesh.visible = false;
    renderer.clippingPlanes = [...renderer.clippingPlanes, clip];
    renderer.setRenderTarget(mirror);
    renderer.render(scene, virtual);
  }

  /** Call once after the camera and objects move, immediately before the main scene render. */
  function renderPasses(renderer: T.WebGLRenderer, scene: T.Scene, camera: SceneCamera) {
    camera.updateWorldMatrix(true, false);
    position.setFromMatrixPosition(camera.matrixWorld);
    forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
    uniforms.uOrthoEye.value.copy(forward).negate();
    for (const [i, uniform] of uniforms.uRipples.value.entries()) {
      const event = ripples[i];
      const age = event ? time - event.time : Infinity;
      if (effects.ripples && event && age >= 0 && age < rippleLifetime) uniform.set(event.x, event.z, age, event.strength);
      else uniform.w = 0;
    }

    const ratio = qualityScale[settings.reflectionQuality];
    const reflect = effects.reflection && ratio > 0 && settings.reflection > 0 && position.y > .04 && mesh.visible;
    uniforms.uReflect.value = reflect ? settings.reflection : 0;
    const target = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace(), mipLevel = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoClearColor = renderer.autoClearColor;
    const autoClearDepth = renderer.autoClearDepth;
    const clipping = renderer.clippingPlanes;
    const shadows = renderer.shadowMap.autoUpdate;
    const xr = renderer.xr.enabled;
    const visible = mesh.visible;
    const scissorTest = renderer.getScissorTest();
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = true;
      renderer.autoClearColor = renderer.autoClearDepth = true;
      renderer.setScissorTest(false);
      uniforms.uWakeActive.value = effects.wake && settings.wake > 0 ? Number(wake.render(renderer, time)) : 0;
      if (reflect) renderReflection(renderer, scene, camera, ratio);
    } finally {
      renderer.setRenderTarget(target, cubeFace, mipLevel);
      renderer.setScissorTest(scissorTest);
      renderer.clippingPlanes = clipping;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.autoClear = autoClear;
      renderer.autoClearColor = autoClearColor;
      renderer.autoClearDepth = autoClearDepth;
      renderer.xr.enabled = xr;
      mesh.visible = visible;
    }
  }

  function clearRipples() {
    ripples.length = 0;
    for (const uniform of uniforms.uRipples.value) uniform.w = 0;
  }

  setVariant(initialVariant);
  update(0, 0);
  return {
    mesh, settings, effects, update, renderPasses, setVariant,
    get variant() { return variant; },
    heightAt(x: number, z: number) {
      if (variant === 'B') return spectrum!.heightAt(x, z);
      if (variant === 'C') return lagoon.heightAt(x, z);
      return waves.heightAt(x, z);
    },
    setShore(next: readonly Shore[]) {
      const nextAtlas = makeCoastAtlas(bounds, next);
      if (coast !== locationSurface?.map) coast.dispose();
      coast = uniforms.tCoast.value = nextAtlas;
      lagoon.setCoast(nextAtlas);
    },
    setLamps(next: readonly ShoreLamp[]) { lamps = next; },
    emitWake(stern: WaterPoint, velocity: WaterPoint, now = time) {
      if (effects.wake && settings.wake > 0) wake.emit(now, stern, velocity);
    },
    ripple(x: number, z: number, strength = 1, now = time) {
      if (ripples.length >= maxRipples) ripples.shift();
      ripples.push({ x, z, time: now, strength: T.MathUtils.clamp(strength, 0, 1.5) });
    },
    clearRipples,
    clearTransient() { clearRipples(); wake.clear(); },
    reflectionSize: () => ({ width: mirror.width, height: mirror.height }),
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      Object.values(materials).forEach(material => material.dispose());
      spectrum?.dispose();
      if (coast !== locationSurface?.map) coast.dispose();
      detail.dispose();
      mirror.dispose();
      wake.dispose();
    },
  };
}
