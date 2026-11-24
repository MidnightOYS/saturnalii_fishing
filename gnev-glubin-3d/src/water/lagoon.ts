import * as T from 'three';
import type { WaterBounds } from './fields';

const bands = [
  { dx: .61, dz: .792, k: .41, speed: 1.68, a: .49, phase: .85 },
  { dx: -.87, dz: .493, k: 1.01, speed: 2.61, a: .23, phase: 1.84 },
  { dx: .93, dz: -.368, k: 1.83, speed: 3.58, a: .107, phase: 3.57 },
];
const smooth = T.MathUtils.smoothstep;

export class LagoonWaveField {
  readonly params = new T.Vector4();
  private coast: T.DataTexture;

  constructor(private readonly bounds: WaterBounds, coast: T.DataTexture) { this.coast = coast; }

  update(time: number, weather: number, scale: number, height: number) {
    this.params.set(time / Math.sqrt(scale), weather, scale, height);
  }

  setCoast(texture: T.DataTexture) { this.coast = texture; }

  private depthAt(x: number, z: number) {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    if (x < minX || x > maxX || z < minZ || z > maxZ) return 1;
    const { data, width, height } = this.coast.image;
    if (!data) return 1;
    const u = (x - minX) / (maxX - minX) * width - .5;
    const v = (z - minZ) / (maxZ - minZ) * height - .5;
    const i = Math.floor(u), j = Math.floor(v);
    const cell = (sx: number, sz: number) => data[(T.MathUtils.clamp(sz, 0, height - 1) * width
      + T.MathUtils.clamp(sx, 0, width - 1)) * 4 + 1] / 255;
    return T.MathUtils.lerp(T.MathUtils.lerp(cell(i, j), cell(i + 1, j), u - i),
      T.MathUtils.lerp(cell(i, j + 1), cell(i + 1, j + 1), u - i), v - j);
  }

  heightAt(x: number, z: number) {
    const { x: time, y: storm, z: scale, w: height } = this.params;
    const depth = this.depthAt(x, z);
    const shelf = 1 - smooth(depth, .03, .91);
    const taper = T.MathUtils.lerp(.22, 1, smooth(depth, .015, .31));
    const shoal = 1 + .57 * shelf;
    const bend = 2.25 * shelf * shelf;
    let y = 0;
    for (const band of bands) {
      const angle = (x * band.dx + z * band.dz + bend) * band.k / scale - band.speed * time + band.phase;
      y += band.a * (Math.sin(angle) - .16 * shelf * Math.cos(2 * angle));
    }
    return y * shoal * taper * height * scale * T.MathUtils.lerp(.27, 1.18, storm);
  }
}

export const lagoonVertex = `
uniform sampler2D tCoast;
uniform vec4 uWorldRect, uLagoon;
varying vec3 vWorld, vNormal;
varying vec2 vCrest;

float shelfDepth(vec2 p) {
  vec2 uv = (p - uWorldRect.xy) / uWorldRect.zw;
  vec2 edge = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return mix(1.0, texture2D(tCoast, uv).g, edge.x * edge.y);
}

float band(vec2 p, vec2 dir, float k, float speed, float amplitude, float phase, float bend, float shelf) {
  float angle = (dot(p, dir) + bend) * k / uLagoon.z - speed * uLagoon.x + phase;
  return amplitude * (sin(angle) - .16 * shelf * cos(2.0 * angle));
}

float lagune(vec2 p) {
  float depth = shelfDepth(p);
  float shelf = 1.0 - smoothstep(.03, .91, depth);
  float taper = mix(.22, 1.0, smoothstep(.015, .31, depth));
  float bend = 2.25 * shelf * shelf;
  float h = ${bands.map(w => `band(p, vec2(${w.dx.toFixed(3)}, ${w.dz.toFixed(3)}), ${w.k.toFixed(3)}, ${w.speed.toFixed(3)}, ${w.a.toFixed(3)}, ${w.phase.toFixed(3)}, bend, shelf)`).join(' + ')};
  return h * (1.0 + .57 * shelf) * taper * uLagoon.w * uLagoon.z * mix(.27, 1.18, uLagoon.y);
}

void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 p = vWorld.xz;
  float h = lagune(p), e = .29;
  float dx = lagune(p + vec2(e, 0.0)) - lagune(p - vec2(e, 0.0));
  float dz = lagune(p + vec2(0.0, e)) - lagune(p - vec2(0.0, e));
  vWorld.y += h;
  vNormal = normalize(vec3(-dx, 2.0 * e, -dz));
  vCrest = vec2(h, shelfDepth(p));
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
