import * as T from 'three';
import type { LocationLayout } from './location-navigation';
import { defaultVisualTuning, type VisualTuning } from './visual-tuning';

const mapSize = 192;

export function createLocationWaterMap(layout: LocationLayout) {
  const { minX, maxX, minZ, maxZ } = layout.water_bounds;
  const width = maxX - minX;
  const height = maxZ - minZ;
  const pixels = new Uint8Array(mapSize * mapSize * 4);
  const edges = layout.water_polygon_xz.map(([x, z], index, polygon) => {
    const next = (index + 1) % polygon.length;
    const [endX, endZ] = polygon[next];
    const dx = endX - x;
    const dz = endZ - z;
    const shelf = layout.shallow_shelf[index];
    const nextShelf = layout.shallow_shelf[next];
    const shelfWidth = (sample: typeof shelf) => Math.hypot(
      sample.break_xz[0] - sample.shore_xz[0], sample.break_xz[1] - sample.shore_xz[1]
    );
    return { x, z, dx, dz, endZ, lengthSquared: dx * dx + dz * dz,
      width: shelfWidth(shelf), nextWidth: shelfWidth(nextShelf),
      depth: shelf.break_depth_m, nextDepth: nextShelf.break_depth_m };
  }).filter(edge => edge.lengthSquared > 0);
  const floorDepth = Math.abs(layout.deep_bottom_y_m);
  for (let row = 0; row < mapSize; row += 1) {
    const z = minZ + (row + .5) * height / mapSize;
    for (let col = 0; col < mapSize; col += 1) {
      const x = minX + (col + .5) * width / mapSize;
      let inside = false;
      let distanceSquared = Infinity;
      let widthAtShore = 1;
      let depthAtBreak = floorDepth;
      for (const edge of edges) {
        const fromX = x - edge.x;
        const fromZ = z - edge.z;
        if ((edge.z > z) !== (edge.endZ > z) && x < edge.x + edge.dx * fromZ / edge.dz) inside = !inside;
        const along = T.MathUtils.clamp((fromX * edge.dx + fromZ * edge.dz) / edge.lengthSquared, 0, 1);
        const offsetX = fromX - along * edge.dx;
        const offsetZ = fromZ - along * edge.dz;
        const candidate = offsetX * offsetX + offsetZ * offsetZ;
        if (candidate >= distanceSquared) continue;
        distanceSquared = candidate;
        widthAtShore = T.MathUtils.lerp(edge.width, edge.nextWidth, along);
        depthAtBreak = T.MathUtils.lerp(edge.depth, edge.nextDepth, along);
      }
      const distance = Math.sqrt(distanceSquared);
      const shelfProgress = T.MathUtils.clamp(distance / Math.max(.1, widthAtShore), 0, 1);
      const beyondShelf = T.MathUtils.clamp((distance - widthAtShore) / 2.8, 0, 1);
      const depth = T.MathUtils.lerp(depthAtBreak * shelfProgress, floorDepth, beyondShelf);
      const index = (row * mapSize + col) * 4;
      // The renderer reads shoreline distance, shelf depth, and a signed clip mask.
      const signedDistance = inside ? distance : -distance;
      pixels[index] = 255 * T.MathUtils.clamp((signedDistance + 1) / 7, 0, 1);
      pixels[index + 1] = inside ? 255 * T.MathUtils.clamp(depth / floorDepth, 0, 1) : 0;
      pixels[index + 2] = 255 * T.MathUtils.clamp(.5 + signedDistance / 2, 0, 1);
      pixels[index + 3] = 255;
    }
  }
  const map = new T.DataTexture(pixels, mapSize, mapSize);
  map.minFilter = map.magFilter = T.LinearFilter;
  map.needsUpdate = true;

  return { map, bounds: new T.Vector4(minX, minZ, width, height) };
}

function basinReflection(radius: number, color: string) {
  const geometry = new T.CircleGeometry(radius, 40).rotateX(-Math.PI / 2);
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new T.Color(color) } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime, uOpacity;
      uniform vec3 uColor;
      void main() {
        vec2 local = vUv * 2.0 - 1.0;
        float radius = length(local);
        float fade = 1.0 - smoothstep(0.24, 1.0, radius);
        float ripples = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(radius * 31.0 - uTime * 2.1), 5.0);
        gl_FragColor = vec4(uColor, fade * ripples * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const effect = new T.Mesh(geometry, material);
  effect.renderOrder = 1;
  effect.userData.waterSurfaceEffect = true;
  return effect;
}

function landmarkWater(radius: number, harbor: boolean) {
  const geometry = new T.PlaneGeometry(radius * 2, radius * 2, 10, 10).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as T.BufferAttribute;
  positions.setUsage(T.DynamicDrawUsage);
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    defines: harbor ? { HARBOR: 1 } : {},
    uniforms: {
      uTime: { value: 0 }, uStage: { value: 0 }, uGain: { value: 1 },
      uLight: { value: new T.Color(harbor ? '#9eceda' : '#c5b2ff') },
      uDark: { value: new T.Color('#120e28') },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime, uStage, uGain;
      uniform vec3 uLight, uDark;
      varying vec2 vUv;
      void main() {
        vec2 local = vUv * 2.0 - 1.0;
        float omen = smoothstep(0.0, 1.0, uStage);
        float rage = smoothstep(1.0, 2.0, uStage);
        #ifdef HARBOR
          // Drift along the face and leave breaks between crests so its silhouette stays visible.
          vec2 alongFace = vec2(dot(local, vec2(.82, .57)), dot(local, vec2(-.57, .82)));
          float edge = length(alongFace * vec2(1.16, 1.0));
          float wave = sin(alongFace.x * 20.0 + alongFace.y * 5.0 + sin(alongFace.y * 5.0) * 1.2 - uTime * 3.1);
          float broken = smoothstep(-.37, .60, sin(alongFace.y * 13.0 + alongFace.x * 4.0 + uTime * 1.5));
          float crests = smoothstep(.90, .99, wave) * (.24 + .76 * broken) * smoothstep(.38, .62, edge)
            * (1.0 - smoothstep(.66, 1.0, edge));
          gl_FragColor = vec4(uLight, crests * (.025 + .09 * omen + .13 * rage));
        #else
          float distanceToCenter = length(local);
          float outer = length(local - vec2(.03, -.02));
          float inner = length(local - vec2(-.18, .12));
          float crescent = (1.0 - smoothstep(.44, .47, outer)) * smoothstep(.43, .48, inner);
          float reflection = .78 + .22 * sin(local.y * 37.0 + sin(local.x * 18.0) - uTime * 1.43);
          float disk = 1.0 - smoothstep(.44, .47, distanceToCenter);
          float rim = 1.0 - smoothstep(.009, .04, abs(distanceToCenter - .455));
          float ripplePhase = distanceToCenter * (27.0 + rage * 9.0) - uTime * (1.85 + rage * 2.5);
          float ripple = smoothstep(.78, .98, sin(ripplePhase)) * smoothstep(.44, .58, distanceToCenter)
            * (1.0 - smoothstep(.68, 1.0, distanceToCenter));
          float light = crescent * reflection * (.53 + .37 * omen) * (1.0 - rage)
            + rage * rim * .68 + ripple * (.035 + .17 * omen + .09 * rage);
          float shade = disk * rage * .89;
          float alpha = light + shade * (1.0 - light);
          vec3 color = (uLight * light + uDark * shade * (1.0 - light)) / max(alpha, .001);
          gl_FragColor = vec4(color, alpha);
        #endif
        gl_FragColor.a = min(.98, gl_FragColor.a * uGain);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.userData.waterSurfaceEffect = true;
  return {
    mesh,
    update(time: number, stage: number, surface: (x: number, z: number) => number, gain: number) {
      mesh.visible = gain > 0;
      if (!mesh.visible) return;
      material.uniforms.uTime.value = time;
      material.uniforms.uStage.value = stage;
      material.uniforms.uGain.value = gain;
      for (let index = 0; index < positions.count; index += 1) {
        const y = surface(mesh.position.x + positions.getX(index), mesh.position.z + positions.getZ(index));
        positions.setY(index, y + .055);
      }
      positions.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function bronzeFace(root: T.Group, eye: T.Vector3) {
  const face = root.getObjectByName('Landmark_Bronze_Face_Bronze');
  if (!(face instanceof T.Mesh) || !(face.material instanceof T.MeshStandardMaterial)) return;
  const material = face.material.clone();
  const stage = { value: 0 };
  const gain = { value: 1 };
  // The three coordinates come from the socket anchor. The dark mask also follows the relief depth.
  material.onBeforeCompile = shader => {
    shader.uniforms.uBronzeEye = { value: eye };
    shader.uniforms.uLandmarkStage = stage;
    shader.uniforms.uLandmarkGain = gain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandmarkWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLandmarkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLandmarkWorld;
        uniform vec3 uBronzeEye;
        uniform float uLandmarkStage, uLandmarkGain;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 eyeDelta = vLandmarkWorld - uBronzeEye;
        vec2 relief = vec2(dot(eyeDelta.xz, vec2(.67, .74)), dot(eyeDelta.xz, vec2(-.74, .67)));
        float coating = min(1.0, uLandmarkGain);
        float socket = (1.0 - smoothstep(.05, .31, eyeDelta.y))
          * (1.0 - smoothstep(.45, 1.0, length(relief * vec2(.81, 1.82))));
        vec2 rimDistance = (relief + vec2(.07, .74)) / vec2(1.37, .27);
        float brow = exp(-dot(rimDistance, rimDistance)) * smoothstep(.34, .85, eyeDelta.y);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(.80, .99, .91), coating);
        diffuseColor.rgb *= 1.0 - socket * (.69 + uLandmarkStage * .09) * coating;
        diffuseColor.rgb *= 1.0 + brow * .27 * uLandmarkGain;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float finishedRoughness = mix(max(roughnessFactor, .66), .38 + uLandmarkStage * .04, brow);
        roughnessFactor = mix(roughnessFactor, finishedRoughness, coating);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(.014, .045, .041) * brow * (1.0 + uLandmarkStage * .42) * uLandmarkGain;`);
  };
  face.material = material;
  return { stage, gain };
}

function driftingPoints(from: T.Vector3, to: T.Vector3, type: 'spray' | 'smoke' | 'mist') {
  const mist = type === 'mist';
  const smoke = type !== 'spray';
  const count = mist ? 12 : smoke ? 15 : 24;
  const positions = new T.BufferAttribute(new Float32Array(count * 3), 3);
  const ages = new T.BufferAttribute(new Float32Array(count), 1);
  positions.setUsage(T.DynamicDrawUsage);
  ages.setUsage(T.DynamicDrawUsage);
  const geometry = new T.BufferGeometry().setAttribute('position', positions).setAttribute('aAge', ages);
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uColor: { value: new T.Color(mist ? '#9b9ebd' : smoke ? '#b8aca0' : '#b9ded9') },
      uSize: { value: mist ? 24 : smoke ? 5 : 2.4 },
      uSoftness: { value: smoke ? 1 : .28 }, uVisibility: { value: mist ? 0 : 1 },
    },
    vertexShader: `
      attribute float aAge;
      uniform float uSize, uSoftness;
      varying float vAge;
      void main() {
        vAge = aAge;
        gl_PointSize = uSize + uSize * uSoftness * aAge * 2.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uSoftness, uVisibility;
      varying float vAge;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float edge = 1.0 - smoothstep(0.22, 1.0, radius);
        float fade = smoothstep(0.0, 0.16, vAge) * (1.0 - vAge);
        gl_FragColor = vec4(uColor, edge * fade * (1.0 - uSoftness * 0.83) * uVisibility);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  points.userData.waterSurfaceEffect = true;
  return {
    points,
    update(time: number, stage: number, gain: number) {
      points.visible = gain > 0 && (!mist || stage > .04);
      if (!points.visible) return;
      material.uniforms.uVisibility.value = gain * (mist ? T.MathUtils.smoothstep(stage, .04, 1.6) * .76 : 1);
      for (let i = 0; i < count; i += 1) {
        const age = (time * (mist ? .13 : smoke ? .34 : 1.05) + i / count) % 1;
        const spread = mist ? 1.1 + age * 1.4 : smoke ? age * (.43 + stage * .16) : .12 * age;
        const sway = Math.sin(i * 2.39 + time * (mist ? .19 : smoke ? .87 : 4)) * spread;
        positions.setXYZ(i, T.MathUtils.lerp(from.x, to.x, age) + sway + (smoke ? age * stage * .34 : 0),
          T.MathUtils.lerp(from.y, to.y, age * (smoke ? 1 : age)),
          T.MathUtils.lerp(from.z, to.z, age) + Math.cos(i * 2.39 + time) * spread);
        ages.setX(i, age);
      }
      positions.needsUpdate = ages.needsUpdate = true;
    }
  };
}

export function createLocationEffects(layout: LocationLayout, root: T.Group) {
  const group = new T.Group();
  group.name = 'location-effects';
  const { anchors_xyz: anchors, fx_zones_m: zones } = layout;
  const lamps: { light: T.PointLight; power: number; strength: number }[] = [];
  for (const [name, position] of Object.entries(anchors)) {
    if (!name.startsWith('lamp_') || !position) continue;
    const kiln = name === 'lamp_kiln';
    const dock = name.startsWith('lamp_dock');
    const power = kiln ? 39 : dock ? 26 : 17;
    const lamp = new T.PointLight(kiln ? '#ff9b43' : '#ffba75', power, kiln ? 9 : 6.5, 2);
    lamp.position.set(...position);
    lamp.position.y += .12;
    group.add(lamp);
    lamps.push({ light: lamp, power, strength: kiln ? 1.25 : dock ? 1 : .68 });
  }
  const eye = anchors.fx_bronze_eye ? new T.Vector3(...anchors.fx_bronze_eye) : undefined;
  const bronze = eye && bronzeFace(root, eye);
  const rim = eye && new T.SpotLight('#a6d6d7', 15, 8, .42, .75, 2);
  if (eye && rim) {
    rim.position.copy(eye).add(new T.Vector3(.2, 2.5, -2.4));
    rim.target.position.copy(eye).add(new T.Vector3(.35, .74, -.60));
    group.add(rim, rim.target);
  }
  const landmarks = ['fx_moon_cistern', 'fx_bronze_eye'].flatMap(name => {
    const point = anchors[name];
    const radius = zones[name];
    if (!point || !radius) return [];
    const harbor = name === 'fx_bronze_eye';
    const landmark = landmarkWater(radius * (harbor ? 1.65 : 1), harbor);
    landmark.mesh.position.set(point[0], 0, point[2]);
    group.add(landmark.mesh);
    return [landmark];
  });
  const reflections = Object.entries(zones).flatMap(([name, radius]) => {
    const point = anchors[name];
    if (!point || name === 'fx_moon_cistern' || name === 'fx_bronze_eye') return [];
    const visual = basinReflection(radius, name === 'fx_second_moon' ? '#c1d8e1' : '#a6d4cd');
    visual.position.set(...point);
    group.add(visual);
    return [{ point, visual }];
  });
  const emitters = ['fx_spout_moon', 'fx_spillway_bronze', 'fx_kiln_smoke'].flatMap(name => {
    const anchor = anchors[name];
    if (!anchor) return [];
    const from = new T.Vector3(...anchor);
    const smoke = name === 'fx_kiln_smoke';
    const target = anchors[name + '_target'];
    if (!smoke && !target) return [];
    const to = target ? new T.Vector3(...target) : from.clone().add(new T.Vector3(.45, 3.1, .25));
    const emitter = driftingPoints(from, to, smoke ? 'smoke' : 'spray');
    group.add(emitter.points);
    return [emitter];
  });
  const shrine = anchors.lamp_shrine;
  if (eye && shrine) {
    const low = new T.Vector3(...shrine).add(new T.Vector3(-2.2, .3, -2.6));
    const high = low.clone().add(new T.Vector3(4.5, 1.6, -1.3));
    const mist = driftingPoints(low, high, 'mist');
    group.add(mist.points);
    emitters.push(mist);
  }
  return {
    group,
    lamps: lamps.map(({ light, strength }) => ({ position: light.position, strength })),
    update(time: number, stage: number, surface: (x: number, z: number) => number,
      tuning: VisualTuning = defaultVisualTuning) {
      for (const [index, { light, power }] of lamps.entries()) {
        light.intensity = (power + 2.7 * stage + Math.sin(time * 5.6 + index * 1.7) * 2) * tuning.lamps;
      }
      if (rim) rim.intensity = (15 + stage * 6) * tuning.landmarks;
      if (bronze) {
        bronze.stage.value = stage;
        bronze.gain.value = tuning.landmarks;
      }
      for (const landmark of landmarks) landmark.update(time, stage, surface, tuning.landmarks);
      for (const { point, visual } of reflections) {
        const y = point[1] === 0 ? surface(point[0], point[2]) : point[1];
        visual.position.y = y + .035;
        visual.material.uniforms.uTime.value = time;
        visual.material.uniforms.uOpacity.value = (.22 - stage * .055) * tuning.landmarks;
      }
      for (const emitter of emitters) emitter.update(time, stage, tuning.landmarks);
    },
    dispose() {
      group.removeFromParent();
      for (const landmark of landmarks) landmark.dispose();
      for (const { visual } of reflections) {
        visual.geometry.dispose();
        visual.material.dispose();
      }
      for (const { points } of emitters) {
        points.geometry.dispose();
        points.material.dispose();
      }
      for (const { light } of lamps) light.dispose();
      rim?.dispose();
    }
  };
}
