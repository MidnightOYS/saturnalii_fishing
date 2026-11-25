import * as T from 'three';
import type { LocationLayout } from '../location-navigation';
import type { LocationSurface } from '../water/location-surface';
import type { VisualTuning } from '../visual-tuning';
import { microEffects, screenFilters } from './presets';
import { microShader } from './micro-shader';
import { screenFilterShader } from './filter-shader';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0., 1.);
  }
`;

const microFragment = /* glsl */ `
  uniform sampler2D uFrame, uDepth, uCoast;
  uniform mat4 uInverseViewProjection;
  uniform vec4 uBounds;
  uniform vec3 uCameraDirection, uCameraPosition;
  uniform vec2 uBoat, uHeading, uPixel, uWind, uAnchor, uBobber;
  uniform float uTime, uStage, uPerspective, uHasBobber;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), f.x), f.y);
  }

  float cloud(vec2 p) {
    return .57 * noise(p) + .28 * noise(mat2(.8, .6, -.6, .8) * p * 2.12 + 2.)
      + .15 * noise(p * 4.5 - 5.);
  }

  vec3 positionAt(vec2 uv, float depth) {
    vec4 p = uInverseViewProjection * vec4(uv * 2. - 1., depth * 2. - 1., 1.);
    return p.xyz / p.w;
  }

  ${microShader}

  void main() {
    vec3 base = texture2D(uFrame, vUv).rgb;
    vec3 world = positionAt(vUv, texture2D(uDepth, vUv).x);
    vec3 color = applyMicroFx(base, world, 1. - smoothstep(.10, 1., uStage),
      smoothstep(.22, 1., uStage), uTime);
    gl_FragColor = vec4(max(color, vec3(0.)), 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const filterFragment = /* glsl */ `
  uniform sampler2D uFrame;
  uniform vec2 uPixel;
  varying vec2 vUv;
  ${screenFilterShader}

  void main() {
    vec3 color = texture2D(uFrame, vUv).rgb;
    gl_FragColor = vec4(visualFilter(color, vUv), 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Basin = Pick<LocationSurface, 'map' | 'bounds'> & { layout: LocationLayout };
type Frame = {
  time: number;
  stage: number;
  tuning: VisualTuning;
  basin?: Basin;
  boat: T.Vector3;
  headingX: number;
  headingZ: number;
  bobber: T.Vector3 | null;
  wind: number;
};

export function createVisualPost(renderer: T.WebGLRenderer) {
  const screen = new T.Scene();
  const screenCamera = new T.Camera();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const pixel = { value: new T.Vector2(1, 1) };
  const micro = {
    uFrame: { value: null as T.Texture | null }, uDepth: { value: null as T.DepthTexture | null },
    uCoast: { value: null as T.Texture | null }, uBounds: { value: new T.Vector4() },
    uInverseViewProjection: { value: new T.Matrix4() },
    uCameraDirection: { value: new T.Vector3() }, uCameraPosition: { value: new T.Vector3() },
    uPixel: pixel, uTime: { value: 0 }, uStage: { value: 0 }, uPerspective: { value: 0 },
    uMicro: { value: new Float32Array(microEffects.length) }, uBottomDepth: { value: 1 },
    uBoat: { value: new T.Vector2() }, uHeading: { value: new T.Vector2() },
    uAnchor: { value: new T.Vector2() }, uWind: { value: new T.Vector2() },
    uBobber: { value: new T.Vector2() }, uHasBobber: { value: 0 },
    uMicroLamp: { value: new T.Vector3() }, uHasLamp: { value: 0 }
  };
  const filter = {
    uFrame: { value: null as T.Texture | null }, uPixel: pixel,
    uFilter: { value: 0 }, uFilterAmount: { value: 0 }
  };
  const microMaterial = new T.ShaderMaterial({
    name: 'Expedition micro effects', uniforms: micro, vertexShader, fragmentShader: microFragment,
    depthTest: false, depthWrite: false,
  });
  const filterMaterial = new T.ShaderMaterial({
    name: 'Expedition screen filters', uniforms: filter, vertexShader, fragmentShader: filterFragment,
    depthTest: false, depthWrite: false, extensions: { derivatives: true },
  });
  const triangle = new T.Mesh(geometry, microMaterial);
  triangle.frustumCulled = false;
  screen.add(triangle);

  const size = new T.Vector2();
  const canReadDepth = renderer.capabilities.isWebGL2 || renderer.extensions.has('WEBGL_depth_texture');
  const canUseDerivatives = renderer.capabilities.isWebGL2 || renderer.extensions.has('OES_standard_derivatives');
  const hdr = renderer.capabilities.isWebGL2
    ? renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
    : renderer.extensions.has('EXT_color_buffer_half_float') && renderer.extensions.has('OES_texture_half_float_linear');
  let sceneTarget: T.WebGLRenderTarget | undefined;
  let detailTarget: T.WebGLRenderTarget | undefined;

  function makeTarget(depthBuffer: boolean) {
    return new T.WebGLRenderTarget(size.x, size.y, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType, colorSpace: T.LinearSRGBColorSpace,
      depthBuffer, stencilBuffer: false, generateMipmaps: false,
    });
  }

  function drawPass(material: T.ShaderMaterial) {
    triangle.material = material;
    renderer.render(screen, screenCamera);
  }

  function render(camera: T.Camera, frame: Frame, draw: (captureDepth: boolean) => T.DepthTexture | undefined) {
    const { tuning, basin, boat, bobber } = frame;
    const useMicro = Boolean(basin && canReadDepth && microEffects.some(({id}) => tuning.micro[id] > .001));
    const filterIndex = screenFilters.findIndex(({id}) => id === tuning.filter);
    const filterPreset = screenFilters[filterIndex];
    const filterAmount = filterPreset ? tuning.filterStrengths[filterPreset.id] : 0;
    const useFilter = canUseDerivatives && filterAmount > .001;
    if (!useMicro && !useFilter) {
      draw(false);
      return;
    }

    renderer.getDrawingBufferSize(size);
    size.set(Math.max(1, size.x), Math.max(1, size.y));
    pixel.value.set(1 / size.x, 1 / size.y);
    sceneTarget ??= makeTarget(true);
    sceneTarget.setSize(size.x, size.y);
    if (useMicro && !sceneTarget.depthTexture) {
      sceneTarget.dispose();
      sceneTarget.depthTexture = new T.DepthTexture(size.x, size.y, T.UnsignedIntType);
    }
    if (useMicro && useFilter) {
      detailTarget ??= makeTarget(false);
      detailTarget.setSize(size.x, size.y);
    }

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousScissor = renderer.getScissorTest();
    let result = sceneTarget.texture;
    try {
      renderer.setRenderTarget(sceneTarget);
      renderer.setScissorTest(false);
      const depth = draw(useMicro) ?? sceneTarget.depthTexture;
      if (useMicro && basin && depth) {
        const { layout, map, bounds } = basin;
        const { lamp_dock: lamp, boat_spawn: spawn } = layout.anchors_xyz;
        const { minX, maxX, minZ, maxZ } = layout.water_bounds;
        micro.uFrame.value = sceneTarget.texture;
        micro.uDepth.value = depth;
        micro.uCoast.value = map;
        micro.uBounds.value.copy(bounds);
        micro.uInverseViewProjection.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
        camera.getWorldDirection(micro.uCameraDirection.value);
        camera.getWorldPosition(micro.uCameraPosition.value);
        micro.uPerspective.value = Number(camera instanceof T.PerspectiveCamera);
        micro.uTime.value = frame.time;
        micro.uStage.value = frame.stage / 2;
        micro.uBottomDepth.value = Math.max(.5, Math.abs(layout.deep_bottom_y_m));
        micro.uBoat.value.set(boat.x, boat.z);
        micro.uHeading.value.set(frame.headingX, frame.headingZ);
        micro.uAnchor.value.set(spawn[0] * .35 + (minX + maxX) * .325, spawn[2] * .35 + (minZ + maxZ) * .325);
        micro.uWind.value.set(layout.proposed_three_slot === 'pond' ? .89 : -.73, .46).normalize()
          .multiplyScalar(Math.max(.08, frame.wind || .85));
        micro.uHasBobber.value = Number(Boolean(bobber));
        if (bobber) micro.uBobber.value.set(bobber.x, bobber.z);
        micro.uHasLamp.value = Number(Boolean(lamp));
        if (lamp) micro.uMicroLamp.value.fromArray(lamp);
        microEffects.forEach(({id}, index) => { micro.uMicro.value[index] = tuning.micro[id]; });

        renderer.setRenderTarget(useFilter ? detailTarget! : previousTarget, useFilter ? 0 : previousFace,
          useFilter ? 0 : previousMip);
        if (!useFilter) renderer.setScissorTest(previousScissor);
        drawPass(microMaterial);
        if (!useFilter) return;
        result = detailTarget!.texture;
      }
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.setScissorTest(previousScissor);
    }

    filter.uFrame.value = result;
    filter.uFilter.value = filterIndex + 1;
    filter.uFilterAmount.value = filterAmount;
    drawPass(filterMaterial);
  }

  return { render };
}
