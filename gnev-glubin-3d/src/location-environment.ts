import * as T from 'three';
import type { LocationLayout } from './location-navigation';

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
  return effect;
}

function driftingPoints(from: T.Vector3, to: T.Vector3, smoke: boolean) {
  const count = smoke ? 15 : 24;
  const positions = new T.BufferAttribute(new Float32Array(count * 3), 3);
  const ages = new T.BufferAttribute(new Float32Array(count), 1);
  positions.setUsage(T.DynamicDrawUsage);
  ages.setUsage(T.DynamicDrawUsage);
  const geometry = new T.BufferGeometry().setAttribute('position', positions).setAttribute('aAge', ages);
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uColor: { value: new T.Color(smoke ? '#b8aca0' : '#b9ded9') },
      uSize: { value: smoke ? 5 : 2.4 }, uSoftness: { value: smoke ? 1 : .28 }
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
      uniform float uSoftness;
      varying float vAge;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float edge = 1.0 - smoothstep(0.22, 1.0, radius);
        float fade = smoothstep(0.0, 0.16, vAge) * (1.0 - vAge);
        gl_FragColor = vec4(uColor, edge * fade * (1.0 - uSoftness * 0.83));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return {
    points,
    update(time: number, stage: number) {
      for (let i = 0; i < count; i += 1) {
        const age = (time * (smoke ? .34 : 1.05) + i / count) % 1;
        const spread = smoke ? age * (.43 + stage * .16) : .12 * age;
        const sway = Math.sin(i * 2.39 + time * (smoke ? .87 : 4)) * spread;
        positions.setXYZ(i, T.MathUtils.lerp(from.x, to.x, age) + sway + (smoke ? age * stage * .34 : 0),
          T.MathUtils.lerp(from.y, to.y, age * (smoke ? 1 : age)),
          T.MathUtils.lerp(from.z, to.z, age) + Math.cos(i * 2.39 + time) * spread);
        ages.setX(i, age);
      }
      positions.needsUpdate = ages.needsUpdate = true;
    }
  };
}

export function createLocationEffects(layout: LocationLayout) {
  const group = new T.Group();
  group.name = 'location-effects';
  const lamps: T.PointLight[] = [];
  for (const [name, position] of Object.entries(layout.anchors_xyz)) {
    if (!name.startsWith('lamp_') || !position) continue;
    const lamp = new T.PointLight('#ffae67', 21, 6.5, 2);
    lamp.position.set(...position);
    lamp.position.y += .12;
    group.add(lamp);
    lamps.push(lamp);
  }
  const eye = layout.anchors_xyz.fx_bronze_eye;
  if (eye) {
    const light = new T.PointLight('#c7dfc6', 14, 9, 2);
    light.position.set(eye[0] - 1.4, eye[1] + 2.4, eye[2] + .8);
    group.add(light);
  }
  const reflections = Object.entries(layout.fx_zones_m).flatMap(([name, radius]) => {
    const point = layout.anchors_xyz[name];
    if (!point || name === 'fx_bronze_eye') return [];
    const visual = basinReflection(radius, name === 'fx_second_moon' ? '#c1d8e1' : '#a6d4cd');
    visual.position.set(...point);
    group.add(visual);
    return [{ point, visual }];
  });
  const emitters = ['fx_spout_moon', 'fx_spillway_bronze', 'fx_kiln_smoke'].flatMap(name => {
    const anchor = layout.anchors_xyz[name];
    if (!anchor) return [];
    const from = new T.Vector3(...anchor);
    const smoke = name === 'fx_kiln_smoke';
    const target = layout.anchors_xyz[name + '_target'];
    if (!smoke && !target) return [];
    const to = target ? new T.Vector3(...target) : from.clone().add(new T.Vector3(.45, 3.1, .25));
    const emitter = driftingPoints(from, to, smoke);
    group.add(emitter.points);
    return [emitter];
  });
  return {
    group,
    lamps: lamps.map(lamp => ({ position: lamp.position, strength: 1 })),
    update(time: number, stage: number, surface: (x: number, z: number) => number) {
      for (const [index, lamp] of lamps.entries()) {
        lamp.intensity = 19 + 2.5 * stage + Math.sin(time * 5.6 + index * 1.7) * 2;
      }
      for (const { point, visual } of reflections) {
        const y = point[1] === 0 ? surface(point[0], point[2]) : point[1];
        visual.position.y = y + .035;
        visual.material.uniforms.uTime.value = time;
        visual.material.uniforms.uOpacity.value = .22 - stage * .055;
      }
      for (const emitter of emitters) emitter.update(time, stage);
    },
    dispose() {
      group.removeFromParent();
      for (const { visual } of reflections) {
        visual.geometry.dispose();
        visual.material.dispose();
      }
      for (const { points } of emitters) {
        points.geometry.dispose();
        points.material.dispose();
      }
      for (const lamp of lamps) lamp.dispose();
    }
  };
}
