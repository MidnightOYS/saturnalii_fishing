import * as T from 'three';
import type { LocationLayout, LocationSlot } from './location-navigation';
import { defaultVisualTuning, type VisualTuning } from './visual-tuning';

function stageLight(horizon: string, zenith: string, sun: string, fill: string, ground: string,
  density: number, sunPower: number, fillPower: number) {
  return {
    horizon: new T.Color(horizon), zenith: new T.Color(zenith), sun: new T.Color(sun),
    fill: new T.Color(fill), ground: new T.Color(ground), density, sunPower, fillPower,
  };
}

const profiles = {
  pond: {
    direction: new T.Vector3(-.69, .65, .46).normalize(),
    stages: [
      stageLight('#92aeb8', '#44699c', '#ffdeb0', '#becbdf', '#627589', .016, 2.55, 1.12),
      stageLight('#687d9a', '#3f487c', '#d1d9ff', '#aabde2', '#595784', .023, 1.76, .94),
      stageLight('#4b4c6d', '#272547', '#afb7fc', '#aab5e6', '#57517a', .031, 1.10, .78),
    ],
  },
  temple: {
    direction: new T.Vector3(-.82, .55, .54).normalize(),
    stages: [
      stageLight('#8a9fae', '#465d80', '#f9d1a4', '#b6c9d7', '#586c7d', .017, 2.28, 1.02),
      stageLight('#707a91', '#3b466b', '#c5d5ee', '#adc0db', '#4b5678', .026, 1.58, .89),
      stageLight('#4d506a', '#262b4a', '#a2b9e6', '#a3b7d8', '#44496c', .034, 1.06, .76),
    ],
  },
} satisfies Record<LocationSlot, { direction: T.Vector3; stages: ReturnType<typeof stageLight>[] }>;

export function createExpeditionLighting(renderer: T.WebGLRenderer, scene: T.Scene, fog: T.FogExp2,
  sun: T.DirectionalLight, fill: T.HemisphereLight, sunDirection: T.Vector3) {
  const skyUniforms = {
    uHorizon: { value: fog.color }, uZenith: { value: new T.Color() },
    uSun: { value: sun.color }, uSunDirection: { value: sunDirection }, uStorm: { value: 0 },
    uGlow: { value: 1 },
  };
  const sky = new T.Mesh(new T.SphereGeometry(90, 24, 12), new T.ShaderMaterial({
    uniforms: skyUniforms, side: T.BackSide, depthWrite: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform vec3 uHorizon, uZenith, uSun, uSunDirection;
      uniform float uStorm, uGlow;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        float elevation = max(direction.y, 0.0);
        vec3 color = mix(uHorizon, uZenith, smoothstep(-0.04, 0.55, direction.y));
        float haze = pow(max(0.0, dot(direction, uSunDirection)), 4.0) * exp(-elevation * 2.8);
        color += uSun * haze * (0.20 - uStorm * 0.13) * uGlow;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.visible = false;
  sky.frustumCulled = false;
  sky.renderOrder = 100;
  scene.add(sky, sun.target);

  // Only static expedition geometry casts shadows. Its map is redrawn once per location.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = T.BasicShadowMap;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 96 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.00035;
  sun.shadow.normalBias = .05;

  const dockDirection = sun.position.clone().normalize();
  const skyTint = new T.Color();
  let profile: (typeof profiles)[LocationSlot] | null = null;

  return {
    setLocation(layout: LocationLayout, root: T.Group) {
      profile = profiles[layout.proposed_three_slot];
      const { minX, maxX, minZ, maxZ } = layout.water_bounds;
      sun.target.position.set((minX + maxX) * .5, 0, (minZ + maxZ) * .5);
      sunDirection.copy(profile.direction);
      sun.position.copy(sun.target.position).addScaledVector(sunDirection, 52);
      root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        const aboveWater = !object.name.endsWith('_Seabed');
        object.receiveShadow = aboveWater;
        object.castShadow = aboveWater;
      });
      sun.castShadow = true;
      sun.shadow.needsUpdate = renderer.shadowMap.needsUpdate = true;
    },
    clearLocation() {
      profile = null;
      sun.castShadow = false;
      sun.target.position.set(0, 0, 0);
      sun.position.set(-15, 14, -5);
      sunDirection.copy(dockDirection);
      sun.color.set('#ffe0a8');
      fill.color.set('#e0e1c8');
      fill.groundColor.set('#4f6c64');
    },
    update(stage: number, tuning: VisualTuning = defaultVisualTuning) {
      if (!profile) return;
      const index = Math.floor(stage);
      const from = profile.stages[index];
      const to = profile.stages[Math.min(index + 1, 2)];
      const blend = stage - index;
      fog.color.copy(from.horizon).lerp(to.horizon, blend);
      fog.density = T.MathUtils.lerp(from.density, to.density, blend) * tuning.fog;
      skyUniforms.uZenith.value.copy(from.zenith).lerp(to.zenith, blend);
      skyUniforms.uStorm.value = stage * .5;
      skyUniforms.uGlow.value = tuning.skyGlow;
      if (tuning.skyTintMix > 0) {
        skyTint.set(tuning.skyTint);
        fog.color.lerp(skyTint, tuning.skyTintMix);
        skyUniforms.uZenith.value.lerp(skyTint, tuning.skyTintMix * .66);
      }
      sun.color.copy(from.sun).lerp(to.sun, blend);
      sun.intensity = T.MathUtils.lerp(from.sunPower, to.sunPower, blend) * tuning.sun;
      fill.color.copy(from.fill).lerp(to.fill, blend);
      fill.groundColor.copy(from.ground).lerp(to.ground, blend);
      fill.intensity = T.MathUtils.lerp(from.fillPower, to.fillPower, blend) * tuning.fill;
    },
    render(camera: T.Camera, draw: () => void) {
      if (!profile || !(camera instanceof T.PerspectiveCamera)) {
        draw();
        return;
      }
      sky.position.copy(camera.position);
      sky.visible = true;
      try {
        draw();
      } finally {
        sky.visible = false;
      }
    },
  };
}
