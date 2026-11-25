import * as T from 'three';

export type WaterBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Shore = { x: number; z: number; radiusX: number; radiusZ: number; angle?: number; shelf?: number };
export type WaterPoint = { x: number; z: number };
const atlasResolution = 384;

/** Red is signed distance to the nearest obstruction, green is relative depth. */
export function makeCoastAtlas(bounds: WaterBounds, shores: readonly Shore[]) {
  const pixels = new Uint8Array(atlasResolution * atlasResolution * 4);
  const shapes = shores.map(shore => ({
    ...shore, cos: Math.cos(shore.angle ?? 0), sin: Math.sin(shore.angle ?? 0),
  }));
  for (let j = 0; j < atlasResolution; j += 1) {
    const z = T.MathUtils.lerp(bounds.minZ, bounds.maxZ, (j + .5) / atlasResolution);
    for (let i = 0; i < atlasResolution; i += 1) {
      const x = T.MathUtils.lerp(bounds.minX, bounds.maxX, (i + .5) / atlasResolution);
      let distance = 8, depth = 1;
      for (const shape of shapes) {
        const dx = x - shape.x, dz = z - shape.z;
        const sx = dx * shape.cos + dz * shape.sin;
        const sz = dz * shape.cos - dx * shape.sin;
        const unit = Math.hypot(sx / shape.radiusX, sz / shape.radiusZ);
        const gradient = Math.hypot(sx / shape.radiusX ** 2, sz / shape.radiusZ ** 2);
        const edge = gradient > .0001
          ? unit * (unit - 1) / gradient
          : -Math.min(shape.radiusX, shape.radiusZ);
        distance = Math.min(distance, edge);
        if (shape.shelf) depth = Math.min(depth, T.MathUtils.smoothstep(edge, -.5, shape.shelf));
      }
      const index = (j * atlasResolution + i) * 4;
      pixels[index] = Math.round(255 * T.MathUtils.clamp((distance + 1) / 7, 0, 1));
      pixels[index + 1] = Math.round(depth * 255);
      pixels[index + 3] = 255;
    }
  }
  const texture = new T.DataTexture(pixels, atlasResolution, atlasResolution);
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Seamless noise and thin cellular membranes, sampled in world space. */
export function makeWaterDetail() {
  const size = 256, cells = 14;
  const pixels = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number, salt: number) => {
    x = T.MathUtils.euclideanModulo(x, cells);
    y = T.MathUtils.euclideanModulo(y, cells);
    let bits = Math.imul(x + salt, 374761393) + Math.imul(y + 1, 668265263);
    bits = Math.imul(bits ^ (bits >>> 13), 1274126177);
    return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
  };
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = i * cells / size, y = j * cells / size;
      const ix = Math.floor(x), iy = Math.floor(y);
      let nearest = 9, second = 9;
      for (let v = iy - 1; v <= iy + 1; v += 1) {
        for (let u = ix - 1; u <= ix + 1; u += 1) {
          const d = Math.hypot(x - u - .15 - hash(u, v, 3) * .7, y - v - .15 - hash(u, v, 8) * .7);
          if (d < nearest) { second = nearest; nearest = d; }
          else second = Math.min(second, d);
        }
      }
      const fx = T.MathUtils.smoothstep(x - ix, 0, 1), fy = T.MathUtils.smoothstep(y - iy, 0, 1);
      const noise = T.MathUtils.lerp(
        T.MathUtils.lerp(hash(ix, iy, 2), hash(ix + 1, iy, 2), fx),
        T.MathUtils.lerp(hash(ix, iy + 1, 2), hash(ix + 1, iy + 1, 2), fx), fy,
      );
      const offset = (j * size + i) * 4;
      pixels[offset] = 255 * (1 - T.MathUtils.smoothstep(second - nearest, .018, .31));
      pixels[offset + 1] = 255 * noise;
      pixels[offset + 2] = 255 * Math.min(nearest, 1);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new T.DataTexture(pixels, size, size);
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

type WakePoint = WaterPoint & { sx: number; sz: number; time: number; speed: number };
const lifetime = 5.2;
const maxPoints = 100;
const strips = [-1, 0, 1];

export class WakeField {
  private readonly points: WakePoint[] = [];
  private readonly geometry = new T.BufferGeometry();
  private readonly positions = new T.BufferAttribute(new Float32Array(maxPoints * strips.length * 6), 3);
  private readonly strengths = new T.BufferAttribute(new Float32Array(maxPoints * strips.length * 2), 1);
  private readonly cross = new T.BufferAttribute(new Float32Array(maxPoints * strips.length * 2), 1);
  private readonly indices = new T.BufferAttribute(new Uint16Array((maxPoints - 1) * strips.length * 6), 1);
  private readonly scene = new T.Scene();
  private readonly camera = new T.Camera();
  private readonly material: T.ShaderMaterial;
  private breakTrail = false;
  private readonly data: WakePoint[][] = [this.points];
  private dirty = false;
  readonly target = new T.WebGLRenderTarget(512, 512, { depthBuffer: false, stencilBuffer: false });

  constructor(worldRect: T.Vector4) {
    this.geometry.setAttribute('position', this.positions.setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('strength', this.strengths.setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('across', this.cross.setUsage(T.DynamicDrawUsage));
    this.geometry.setIndex(this.indices.setUsage(T.DynamicDrawUsage));
    this.material = new T.ShaderMaterial({
      uniforms: { worldRect: { value: worldRect } },
      side: T.DoubleSide,
      depthTest: false, depthWrite: false, transparent: true,
      blending: T.AdditiveBlending,
      vertexShader: `
        uniform vec4 worldRect;
        attribute float strength, across;
        varying float vStrength, vAcross;
        void main() {
          vStrength = strength;
          vAcross = across;
          vec2 uv = (position.xz - worldRect.xy) / worldRect.zw;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: `
        varying float vStrength, vAcross;
        void main() {
          float edge = 1.0 - smoothstep(0.0, 1.0, abs(vAcross));
          gl_FragColor = vec4(vec3(1.0), edge * vStrength);
        }`,
    });
    this.scene.background = new T.Color(0);
    const mesh = new T.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  emit(time: number, stern: WaterPoint, travel: WaterPoint) {
    this.prune(time);
    const speed = Math.hypot(travel.x, travel.z);
    if (speed < .55) { this.breakTrail = true; return; }
    let trail = this.data[this.data.length - 1];
    const last = trail[trail.length - 1];
    if (last && time - last.time < .065) return;
    if (this.breakTrail || (last && (time - last.time > .32 || Math.hypot(last.x - stern.x, last.z - stern.z) > 2.5))) {
      if (trail.length) { trail = []; this.data.push(trail); }
      this.breakTrail = false;
    }
    trail.push({ ...stern, sx: travel.z / speed, sz: -travel.x / speed, time, speed });
  }

  clear() {
    this.points.length = 0;
    this.data.length = 1;
    this.breakTrail = false;
  }

  private prune(time: number) {
    for (const trail of this.data) {
      while (trail.length && time - trail[0].time >= lifetime) trail.shift();
    }
    for (let j = this.data.length - 1; j > 0; j -= 1) {
      if (!this.data[j].length && j < this.data.length - 1) this.data.splice(j, 1);
    }
  }

  render(renderer: T.WebGLRenderer, time: number) {
    this.prune(time);
    let vertex = 0, index = 0;
    for (const trail of this.data) {
      if (trail.length < 2 || vertex + trail.length * 6 > this.positions.count) continue;
      const head = trail[trail.length - 1];
      for (const side of strips) {
        for (const [i, point] of trail.entries()) {
          const age = time - point.time;
          const fade = Math.max(0, 1 - age / lifetime) ** 1.7;
          const opening = (1 - Math.exp(-age * 1.1)) * (1.72 + point.speed * .13);
          const width = side ? .17 + age * .17 : .36 + age * .20;
          const center = side * (.36 + opening);
          const start = Math.min(1, .25 + i * .62);
          const end = 1 - T.MathUtils.smoothstep(time - head.time, .22, 1.25) * Math.max(0, i - trail.length + 3) / 2;
          const opacity = fade * start * end * Math.min(1, point.speed / 3.7) * (side ? .97 : .51);
          for (const edge of [-1, 1]) {
            const offset = center + edge * width;
            this.positions.setXYZ(vertex, point.x + point.sx * offset, 0, point.z + point.sz * offset);
            this.strengths.setX(vertex, opacity);
            this.cross.setX(vertex, edge);
            vertex += 1;
          }
          if (i > 0) {
            const a = vertex - 4;
            this.indices.array.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], index);
            index += 6;
          }
        }
      }
    }
    if (index) {
      this.positions.needsUpdate = this.strengths.needsUpdate = this.cross.needsUpdate = this.indices.needsUpdate = true;
    }
    // Clear once after the last segment fades. An empty field needn't cost a pass.
    if (index || this.dirty) {
      this.geometry.setDrawRange(0, index);
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    }
    this.dirty = index > 0;
    return this.dirty;
  }

  dispose() {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
