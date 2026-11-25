import * as T from 'three';
import type { Shore, WaterBounds } from './water/fields';

type Placement = {
  position: T.Vector3;
  scale: T.Vector3;
  rotation: T.Euler;
  tint: T.Color;
};

const tau = Math.PI * 2;
const sandShallow = new T.Color('#afbd97');
const sandDeep = new T.Color('#516e68');
const grassPalettes = ['#31584d', '#456954', '#626e4d', '#7d8857', '#357269'].map(tint => new T.Color(tint));
const stonePalettes = ['#a4a783', '#bbb58d', '#899789', '#6f8378', '#a29674'].map(tint => new T.Color(tint));

function randomSequence(seed: number) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function hash(x: number, z: number) {
  let bits = Math.imul(x + 231, 374761393) + Math.imul(z - 140, 668265263);
  bits = Math.imul(bits ^ (bits >>> 13), 1274126177);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, z: number) {
  const i = Math.floor(x), j = Math.floor(z);
  const u = T.MathUtils.smoothstep(x - i, 0, 1), v = T.MathUtils.smoothstep(z - j, 0, 1);
  return T.MathUtils.lerp(
    T.MathUtils.lerp(hash(i, j), hash(i + 1, j), u),
    T.MathUtils.lerp(hash(i, j + 1), hash(i + 1, j + 1), u), v,
  );
}

function makeShelfSampler(shores: readonly Shore[]) {
  const shapes = shores.map(shore => ({
    ...shore,
    cos: Math.cos(shore.angle ?? 0),
    sin: Math.sin(shore.angle ?? 0),
    limit: Math.max(shore.radiusX, shore.radiusZ) + (shore.shelf ?? 0) + 1,
  }));
  return (x: number, z: number) => {
    let depth = 1, distance = 8;
    for (const s of shapes) {
      const dx = x - s.x, dz = z - s.z;
      if (Math.abs(dx) > s.limit || Math.abs(dz) > s.limit) continue;
      const sx = dx * s.cos + dz * s.sin, sz = dz * s.cos - dx * s.sin;
      const unit = Math.hypot(sx / s.radiusX, sz / s.radiusZ);
      const gradient = Math.hypot(sx / s.radiusX ** 2, sz / s.radiusZ ** 2);
      const edge = gradient > .0001 ? unit * (unit - 1) / gradient : -Math.min(s.radiusX, s.radiusZ);
      distance = Math.min(distance, edge);
      if (s.shelf) depth = Math.min(depth, T.MathUtils.smoothstep(edge, -.5, s.shelf));
    }
    const relief = noise(x * .40, z * .40) - .5;
    return { depth, distance, level: -.79 - depth * 2.18 + .28 * relief };
  };
}

function addInstanced(
  group: T.Group, name: string, geometry: T.BufferGeometry, material: T.Material, positions: Placement[],
) {
  const mesh = new T.InstancedMesh(geometry, material, positions.length);
  const transform = new T.Object3D();
  mesh.name = name;
  for (const [i, item] of positions.entries()) {
    transform.position.copy(item.position);
    transform.scale.copy(item.scale);
    transform.rotation.copy(item.rotation);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, item.tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function makeGrassGeometry() {
  const positions: number[] = [], color: number[] = [], index: number[] = [];
  const rng = randomSequence(37491);
  for (let i = 0; i < 6; i += 1) {
    const angle = rng() * tau;
    const nx = Math.cos(angle), nz = Math.sin(angle);
    const x = (rng() - .5) * .27, z = (rng() - .5) * .27;
    const height = .25 + rng() * .38, spread = .15 + rng() * .20, width = .035 + rng() * .037;
    const start = positions.length / 3;
    positions.push(
      x + nz * width, 0, z - nx * width, x - nz * width, 0, z + nx * width,
      x + nx * spread * .24 + nz * width * .75, height * .58, z + nz * spread * .24 - nx * width * .75,
      x + nx * spread * .24 - nz * width * .75, height * .58, z + nz * spread * .24 + nx * width * .75,
      x + nx * spread, height, z + nz * spread,
    );
    index.push(start, start + 1, start + 2, start + 2, start + 1, start + 3, start + 2, start + 3, start + 4);
    const shade = .85 + rng() * .22;
    for (const mul of [.38, .38, .76, .76, 1.30]) color.push(shade * mul, shade * mul, shade * mul);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  return geometry;
}

// The top-down color capture needs leaf area even where a blade is almost
// upright. Curved, laid-over ribbons keep the tips readable through the water.
function makeRibbonGrass() {
  const rng = randomSequence(29091);
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const sections = 6;
  for (let i = 0; i < 4; i++) {
    const heading = i * 1.57 + rng() * .75;
    const x = (rng() - .5) * .18, z = (rng() - .5) * .18;
    const length = .46 + rng() * .32;
    const spread = .45 + rng() * .21;
    const halfWidth = .078 + rng() * .026;
    const start = positions.length / 3;
    for (let j = 0; j <= sections; j++) {
      const t = j / sections;
      const angle = heading + .48 * t;
      const arc = spread * t * (.24 + .76 * t);
      const centerX = x + Math.cos(angle) * arc, centerZ = z + Math.sin(angle) * arc;
      const y = length * Math.sin(t * 1.89);
      const width = halfWidth * (.65 + .35 * Math.sin(t * Math.PI)) * (1 - .55 * t ** 4);
      const acrossX = Math.sin(angle) * width, acrossZ = -Math.cos(angle) * width;
      positions.push(centerX - acrossX, y, centerZ - acrossZ, centerX + acrossX, y + .12 * width * t, centerZ + acrossZ);
      const shade = .66 + .44 * t;
      colors.push(shade * .94, shade, shade * .92, shade, shade * 1.04, shade * .96);
      if (j > 0) {
        const k = start + j * 2;
        indices.push(k - 2, k - 1, k, k, k - 1, k + 1);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function makeStoneGeometry() {
  const geometry = new T.IcosahedronGeometry(1, 0);
  const points = geometry.attributes.position, colors: number[] = [];
  const sun = new T.Vector3(-.38, .83, -.40).normalize();
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  for (let i = 0; i < points.count; i += 1) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    const rough = .90 + .09 * Math.sin(x * 14.3 + y * 4.1 + z * 11.5);
    points.setXYZ(i, x * rough + y * .12, y * rough, z * rough);
  }
  for (let i = 0; i < points.count; i += 3) {
    a.fromBufferAttribute(points, i);
    b.fromBufferAttribute(points, i + 1).sub(a);
    c.fromBufferAttribute(points, i + 2).sub(a);
    const light = .64 + Math.max(0, b.cross(c).normalize().dot(sun)) * .48 + hash(i, 2) * .065;
    for (let j = 0; j < 3; j += 1) colors.push(light * 1.04, light, light * .94);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  return geometry;
}

export function createWatercolorBed(shores: readonly Shore[], bounds: WaterBounds, { stableFoliage = false } = {}) {
  const group = new T.Group();
  group.name = 'Submerged Aegean banks';
  const sample = makeShelfSampler(shores);
  const width = bounds.maxX - bounds.minX, length = bounds.maxZ - bounds.minZ;
  const floor = new T.PlaneGeometry(width + 8, length + 8, 96, 96);
  floor.rotateX(-Math.PI / 2);
  floor.translate(bounds.minX + width / 2, 0, bounds.minZ + length / 2);
  const floorPosition = floor.attributes.position, sandColors: number[] = [];
  const tint = new T.Color();
  for (let i = 0; i < floorPosition.count; i += 1) {
    const x = floorPosition.getX(i), z = floorPosition.getZ(i);
    const bed = sample(x, z);
    const sandDrifts = noise(x * .28 + 11, z * .22);
    floorPosition.setY(i, bed.level);
    tint.copy(sandShallow).lerp(sandDeep, bed.depth * .72)
      .multiplyScalar(.87 + sandDrifts * .26);
    tint.toArray(sandColors, i * 3);
  }
  floor.setAttribute('color', new T.Float32BufferAttribute(sandColors, 3));
  const sand = new T.ShaderMaterial({
    vertexColors: true, toneMapped: false,
    vertexShader: `
      varying vec3 vSilt;
      varying vec2 vFloor;
      void main() {
        vSilt = color;
        vFloor = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vSilt;
      varying vec2 vFloor;
      void main() {
        vec2 p = vFloor;
        float drift = sin(p.x * .7 + p.y * .25) * .85 + sin(p.y * 1.6) * .28;
        float ribs = sin(p.x * 2.7 + p.y * 9.0 + drift) * .5 + .5;
        float grit = ${stableFoliage
          ? '.5 + .22 * sin(p.x * 2.6 + p.y * 1.9) * cos(p.y * 4.5 - p.x * 1.2)'
          : 'fract(52.9829189 * fract(dot(floor(p * 112.0), vec2(.06711056, .00583715))))'};
        gl_FragColor = vec4(vSilt * (.91 + ribs * .13 + grit * .06), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sandFloor = new T.Mesh(floor, sand);
  sandFloor.name = 'Silt and ripple beds';
  group.add(sandFloor);

  const grassGeometry = stableFoliage ? makeRibbonGrass() : makeGrassGeometry();
  const currents = { uBedTime: { value: 0 }, uBedWrath: { value: 0 } };
  const grassMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide, vertexColors: true, toneMapped: false });
  grassMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, currents);
    shader.vertexShader = `uniform float uBedTime, uBedWrath;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      stableFoliage ? `#include <begin_vertex>
        vec2 anchor = instanceMatrix[3].xz;
        float current = sin(dot(anchor, vec2(.19,.12)) - uBedTime * .54)
          + .28 * sin(dot(anchor, vec2(-.14,.21)) - uBedTime * .82);
        vec3 delta = vec3(.075,0.,.045) * current * position.y * position.y * (1. + .38*uBedWrath);
        // Convert the shared world current into the rotating/scaling tuft's local frame.
        vec3 bx = instanceMatrix[0].xyz, bz = instanceMatrix[2].xyz;
        transformed.xz += vec2(dot(delta,bx)/dot(bx,bx), dot(delta,bz)/dot(bz,bz));`
      : `#include <begin_vertex>
        vec2 anchor = instanceMatrix[3].xz;
        float speed = 1.42 + uBedWrath * 2.1;
        float sway = sin(dot(anchor, vec2(.49, .28)) - uBedTime * speed)
          + sin(dot(anchor, vec2(-.91, .64)) - uBedTime * (speed + .41)) * .45;
        transformed.xz += vec2(.26, .39) * sway * (position.y * position.y) * (.68 + uBedWrath * .87);`,
    );
  };
  grassMaterial.customProgramCacheKey = () => stableFoliage ? 'seagrass-ribbons' : 'seagrass-blades';
  const grass: Placement[] = [], stones: Placement[] = [], amphoras: Placement[] = [];
  const random = randomSequence(85793);
  const spacing = .31;
  for (let z = bounds.minZ; z < bounds.maxZ; z += spacing) {
    for (let x = bounds.minX; x < bounds.maxX; x += spacing) {
      const px = x + random() * spacing, pz = z + random() * spacing;
      const point = sample(px, pz);
      if (point.distance < .30 || point.depth > .89) continue;
      const patch = noise(px * .62 - 18, pz * .48) * .39 + noise(px * .24, pz * .20 + 5) * .61;
      const probability = T.MathUtils.smoothstep(patch, .33, .68) * (1 - T.MathUtils.smoothstep(point.depth, .59, .90));
      if (random() > probability) continue;
      const size = .54 + random() * .80 + patch * .22;
      const placement = {
        position: new T.Vector3(px, point.level - .06, pz),
        scale: new T.Vector3(size, size, size),
        rotation: new T.Euler(0, random() * tau, 0),
        tint: grassPalettes[Math.floor(random() * grassPalettes.length)].clone().multiplyScalar(.80 + random() * .30),
      };
      if (stableFoliage) {
        // Retain the seed stream for the existing stones and ceramics.
        if (hash(Math.round(px * 31), Math.round(pz * 31)) > .46) continue;
        placement.scale.setY(Math.min(size, (-point.level - .22) / .79));
      }
      grass.push(placement);
    }
  }
  for (let z = bounds.minZ; z < bounds.maxZ; z += .94) {
    for (let x = bounds.minX; x < bounds.maxX; x += .94) {
      const px = x + random() * .9, pz = z + random() * .9;
      const point = sample(px, pz);
      if (point.distance < .43 || point.depth > .91) continue;
      const pile = noise(px * .39 + 38, pz * .36 - 11);
      if (random() > .10 + .54 * T.MathUtils.smoothstep(pile, .54, .81)) continue;
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i += 1) {
        const bx = px + (random() - .5) * .62, bz = pz + (random() - .5) * .62;
        const radius = .12 + (random() ** 2.2) * .57;
        stones.push({
          position: new T.Vector3(bx, sample(bx, bz).level + radius * .12, bz),
          scale: new T.Vector3(radius * (1.2 + random() * .6), radius * (.35 + random() * .45), radius),
          rotation: new T.Euler(random() * .2, random() * tau, random() * .2),
          tint: stonePalettes[Math.floor(random() * stonePalettes.length)],
        });
      }
      if (point.depth < .60 && point.distance > .88 && random() < .032) {
        const size = .57 + .75 * random();
        amphoras.push({
          position: new T.Vector3(px, point.level + .25, pz),
          scale: new T.Vector3(size, size, size),
          rotation: new T.Euler(.30 + random(), random() * tau, .60 + random() * .5),
          tint: new T.Color(random() < .72 ? '#ad775e' : '#b6a17a'),
        });
      }
    }
  }

  const stoneGeometry = makeStoneGeometry();
  const stoneMaterial = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const amphoraGeometry = new T.LatheGeometry([
    new T.Vector2(0, -.38), new T.Vector2(.12, -.36), new T.Vector2(.29, -.22),
    new T.Vector2(.33, .07), new T.Vector2(.29, .23), new T.Vector2(.13, .34),
    new T.Vector2(.115, .43), new T.Vector2(.17, .46), new T.Vector2(.16, .49), new T.Vector2(.085, .47),
  ], 12);
  const clay = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const clayColors: number[] = [];
  const jarVertices = amphoraGeometry.attributes.position;
  for (let i = 0; i < jarVertices.count; i += 1) {
    const y = jarVertices.getY(i), x = jarVertices.getX(i);
    const stripe = y > .22 ? .72 : 1.0;
    const shade = (.81 + .22 * T.MathUtils.smoothstep(x, -.26, .27)) * stripe;
    clayColors.push(shade, shade * .98, shade * .95);
  }
  amphoraGeometry.setAttribute('color', new T.Float32BufferAttribute(clayColors, 3));
  const foliage = addInstanced(group, 'Seagrass banks', grassGeometry, grassMaterial, grass);
  foliage.userData.refractiveFoliage = stableFoliage;
  const batches = [
    foliage,
    addInstanced(group, 'Limestone and algae stones', stoneGeometry, stoneMaterial, stones),
    addInstanced(group, 'Sunken ceramics', amphoraGeometry, clay, amphoras),
  ];
  return {
    group, foliage, floor: sandFloor,
    update(time: number, wrath: number) {
      currents.uBedTime.value = time;
      currents.uBedWrath.value = T.MathUtils.clamp(wrath, 0, 1);
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of batches) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      floor.dispose();
      sand.dispose();
    },
  };
}
