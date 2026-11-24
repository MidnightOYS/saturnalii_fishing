import * as T from 'three';

const size = 128;
const area = size * size;
const mask = size - 1;
const span = 76;
const tau = Math.PI * 2;
const step = 1 / 30;
const spacing = span / size;
const maxChopHeight = 1.17;

const reversed = Uint8Array.from({ length: size }, (_, index) => {
  let result = 0;
  for (let bit = 1; bit < size; bit <<= 1) result = (result << 1) | ((index & bit) ? 1 : 0);
  return result;
});
const cos = Float64Array.from({ length: size / 2 }, (_, i) => Math.cos(i * tau / size));
const sin = Float64Array.from({ length: size / 2 }, (_, i) => Math.sin(i * tau / size));

function inverseLine(real: Float32Array, imaginary: Float32Array, base: number, stride: number) {
  for (let i = 0; i < size; i += 1) {
    const j = reversed[i];
    if (j <= i) continue;
    const a = base + i * stride, b = base + j * stride;
    const re = real[a], im = imaginary[a];
    real[a] = real[b]; imaginary[a] = imaginary[b];
    real[b] = re; imaginary[b] = im;
  }
  for (let length = 2; length <= size; length *= 2) {
    const half = length / 2;
    for (let block = 0; block < size; block += length) {
      for (let i = 0; i < half; i += 1) {
        const a = base + (block + i) * stride, b = a + half * stride, k = i * size / length;
        const re = real[b] * cos[k] - imaginary[b] * sin[k];
        const im = imaginary[b] * cos[k] + real[b] * sin[k];
        real[b] = real[a] - re; imaginary[b] = imaginary[a] - im;
        real[a] += re; imaginary[a] += im;
      }
    }
  }
}

function inverse2D(real: Float32Array, imaginary: Float32Array) {
  for (let i = 0; i < size; i += 1) inverseLine(real, imaginary, i * size, 1);
  for (let i = 0; i < size; i += 1) inverseLine(real, imaginary, i, size);
}

function gridSample(data: Float32Array, x: number, z: number, channel: number, channels = 4) {
  const u = Math.floor(x), v = Math.floor(z);
  const a = ((v & mask) * size + (u & mask)) * channels;
  const b = ((v & mask) * size + ((u + 1) & mask)) * channels;
  const c = (((v + 1) & mask) * size + (u & mask)) * channels;
  const d = (((v + 1) & mask) * size + ((u + 1) & mask)) * channels;
  const tx = x - u, tz = z - v;
  return T.MathUtils.lerp(T.MathUtils.lerp(data[a + channel], data[b + channel], tx),
    T.MathUtils.lerp(data[c + channel], data[d + channel], tx), tz);
}

/**
 * A directed swell lobe plus a broad wind-sea spectrum. The Hermitian frequency
 * field gives real heights, with the two horizontal transforms packed together.
 */
export class SpectralWaveField {
  private readonly hRe = new Float32Array(area);
  private readonly hIm = new Float32Array(area);
  private readonly dRe = new Float32Array(area);
  private readonly dIm = new Float32Array(area);
  private readonly grid = new Float32Array(area * 4);
  private foam = new Float32Array(area);
  private nextFoam = new Float32Array(area);
  private readonly modes: { at: number; opposite: number; kx: number; kz: number; omega: number;
    re: number; im: number; windRe: number; windIm: number }[] = [];
  readonly texture = new T.DataTexture(this.grid, size, size, T.RGBAFormat, T.FloatType);
  readonly params = new T.Vector4(span, size, 1, 1);
  private lastTime = -Infinity;
  private lastWeather = -1;
  private lastScale = -1;

  constructor() {
    this.texture.wrapS = this.texture.wrapT = T.RepeatWrapping;
    this.texture.minFilter = this.texture.magFilter = T.NearestFilter;
    const windX = .87, windZ = .493, swellX = .59, swellZ = .807;
    let state = 0x18d947af;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    const amplitudes: { swell: number; wind: number }[] = [];
    let swellPower = 0, windPower = 0;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        if (i === size / 2 || j === size / 2) continue;
        const fx = i < size / 2 ? i : i - size, fz = j < size / 2 ? j : j - size;
        const k = Math.hypot(fx, fz) * tau / span;
        if (k < .13 || k > 3.6) continue;
        const kx = fx * tau / (span * k), kz = fz * tau / (span * k);
        const swellAlignment = Math.max(0, kx * swellX + kz * swellZ);
        const windAlignment = Math.max(0, kx * windX + kz * windZ);
        const swell = Math.exp(-.5 * (Math.log(k / .405) / .26) ** 2) * swellAlignment ** 16;
        const wind = Math.exp(-((.77 / k) ** 2 + (k / 3.05) ** 2))
          * (.11 + .89 * windAlignment ** 5) / k ** 2.75;
        if (swell + wind < 1e-5) continue;
        const angle = tau * random();
        const radius = Math.min(2.85, Math.sqrt(-2 * Math.log(Math.max(1e-7, random()))));
        const windAngle = tau * random();
        const windRadius = Math.min(2.85, Math.sqrt(-2 * Math.log(Math.max(1e-7, random()))));
        const a = Math.sqrt(swell) * radius, b = Math.sqrt(wind) * windRadius;
        swellPower += a * a / 2;
        windPower += b * b / 2;
        amplitudes.push({ swell: a, wind: b });
        this.modes.push({ at: j * size + i, opposite: ((-j & mask) * size + (-i & mask)),
          kx, kz, omega: Math.sqrt(9.81 * k) * .88,
          re: Math.cos(angle), im: Math.sin(angle), windRe: Math.cos(windAngle), windIm: Math.sin(windAngle) });
      }
    }
    for (let i = 0; i < this.modes.length; i += 1) {
      const mode = this.modes[i];
      const a = amplitudes[i].swell / Math.sqrt(swellPower), b = amplitudes[i].wind / Math.sqrt(windPower);
      mode.re *= a; mode.im *= a;
      mode.windRe *= b; mode.windIm *= b;
    }
  }

  update(time: number, weather: number, scale: number, height: number) {
    this.params.z = scale;
    this.params.w = height;
    if (Math.abs(time - this.lastTime) < step && Math.abs(weather - this.lastWeather) < .025 && scale === this.lastScale) return;
    const elapsed = time - this.lastTime;
    const dt = T.MathUtils.clamp(elapsed, 0, .1);
    if (!Number.isFinite(elapsed) || elapsed > .4 || elapsed < 0) this.foam.fill(0);
    this.lastTime = time; this.lastWeather = weather; this.lastScale = scale;

    this.hRe.fill(0); this.hIm.fill(0);
    this.dRe.fill(0); this.dIm.fill(0);
    const swell = T.MathUtils.lerp(.17, .53, weather);
    const wind = T.MathUtils.lerp(.085, .355, weather);
    const clock = time / Math.sqrt(scale);
    for (const mode of this.modes) {
      const phase = mode.omega * clock;
      const c = Math.cos(phase), s = Math.sin(phase);
      const a = mode.re * swell + mode.windRe * wind, b = mode.im * swell + mode.windIm * wind;
      const re = (a * c + b * s) * .5, im = (b * c - a * s) * .5;
      this.hRe[mode.at] += re; this.hIm[mode.at] += im;
      this.hRe[mode.opposite] += re; this.hIm[mode.opposite] -= im;
      this.dRe[mode.at] += -im * mode.kx - re * mode.kz;
      this.dIm[mode.at] += re * mode.kx - im * mode.kz;
      this.dRe[mode.opposite] += -im * mode.kx + re * mode.kz;
      this.dIm[mode.opposite] += -re * mode.kx - im * mode.kz;
    }
    inverse2D(this.hRe, this.hIm);
    inverse2D(this.dRe, this.dIm);
    const chop = T.MathUtils.lerp(.36, .64, weather);
    // Bound the horizontal Jacobian even at the steepest editable sea state.
    // Each bilinear cell derivative is an interpolation of differences on its edges.
    let maxGradientSquared = 0;
    const edgeSlope = (a: number, b: number) => (
      (this.dRe[a] - this.dRe[b]) ** 2 + (this.dIm[a] - this.dIm[b]) ** 2
    );
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const at = j * size + i;
        const l = j * size + ((i - 1) & mask), r = j * size + ((i + 1) & mask);
        const b = ((j - 1) & mask) * size + i, f = ((j + 1) & mask) * size + i;
        const gradient = Math.max(edgeSlope(at, l), edgeSlope(at, r))
          + Math.max(edgeSlope(at, b), edgeSlope(at, f));
        maxGradientSquared = Math.max(maxGradientSquared, gradient);
      }
    }
    const safeChop = Math.min(chop, .80 * spacing / Math.max(.001, Math.sqrt(maxGradientSquared) * maxChopHeight));
    const decay = Math.exp(-dt / T.MathUtils.lerp(.55, 1.18, weather));
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const at = j * size + i;
        const l = j * size + ((i - 1) & mask), r = j * size + ((i + 1) & mask);
        const b = ((j - 1) & mask) * size + i, f = ((j + 1) & mask) * size + i;
        const derivative = chop / (2 * spacing);
        const xx = 1 + (this.dRe[r] - this.dRe[l]) * derivative;
        const zz = 1 + (this.dIm[f] - this.dIm[b]) * derivative;
        const xz = (this.dRe[f] - this.dRe[b]) * derivative;
        const zx = (this.dIm[r] - this.dIm[l]) * derivative;
        const compression = 1 - (xx * zz - xz * zx);
        const crest = T.MathUtils.smoothstep(this.hRe[at], .02, .58);
        const trigger = T.MathUtils.lerp(.47, .12, weather);
        const caps = T.MathUtils.smoothstep(compression, trigger, trigger + .33) * crest;
        const carried = gridSample(this.foam, i - dt * 1.2, j - dt * .76, 0, 1) * decay;
        this.nextFoam[at] = Math.max(carried, caps * T.MathUtils.lerp(.37, .99, weather));
        const out = at * 4;
        this.grid[out] = this.hRe[at];
        this.grid[out + 1] = this.dRe[at] * safeChop;
        this.grid[out + 2] = this.dIm[at] * safeChop;
        this.grid[out + 3] = this.nextFoam[at];
      }
    }
    [this.foam, this.nextFoam] = [this.nextFoam, this.foam];
    this.texture.needsUpdate = true;
  }

  heightAt(x: number, z: number) {
    const scale = this.params.z, height = this.params.w;
    const factor = size / (span * scale);
    const influence = Math.min(height, maxChopHeight) * scale;
    const worldX = x * factor, worldZ = z * factor;
    let u = worldX, v = worldZ;
    const stretch = influence * factor, epsilon = .035;
    for (let i = 0; i < 8; i += 1) {
      const dx = gridSample(this.grid, u, v, 1);
      const dz = gridSample(this.grid, u, v, 2);
      const ex = u + dx * stretch - worldX;
      const ez = v + dz * stretch - worldZ;
      if (ex * ex + ez * ez < 1e-10) break;
      const xx = 1 + (gridSample(this.grid, u + epsilon, v, 1) - dx) * stretch / epsilon;
      const xz = (gridSample(this.grid, u, v + epsilon, 1) - dx) * stretch / epsilon;
      const zx = (gridSample(this.grid, u + epsilon, v, 2) - dz) * stretch / epsilon;
      const zz = 1 + (gridSample(this.grid, u, v + epsilon, 2) - dz) * stretch / epsilon;
      const determinant = xx * zz - xz * zx;
      if (determinant > .08) {
        u -= T.MathUtils.clamp((zz * ex - xz * ez) / determinant, -.8, .8);
        v -= T.MathUtils.clamp((xx * ez - zx * ex) / determinant, -.8, .8);
      } else {
        u -= ex * .45;
        v -= ez * .45;
      }
    }
    return gridSample(this.grid, u, v, 0) * height * scale;
  }

  dispose() { this.texture.dispose(); }
}

export const spectralVertex = `
uniform sampler2D tSpectrum;
uniform vec4 uSpectrum; // span, size, wavelength scale, height scale
varying vec3 vWorld, vNormal;
varying vec2 vCrest;

vec4 sampleWave(vec2 p) {
  vec2 grid = p * uSpectrum.y / (uSpectrum.x * uSpectrum.z);
  vec2 uv = (floor(grid) + .5) / uSpectrum.y, f = fract(grid);
  vec2 stride = vec2(1.0 / uSpectrum.y, 0.0);
  return mix(mix(texture2D(tSpectrum, uv), texture2D(tSpectrum, uv + stride.xy), f.x),
    mix(texture2D(tSpectrum, uv + stride.yx), texture2D(tSpectrum, uv + stride.xx), f.x), f.y);
}

vec3 displacement(vec4 sampleValue) {
  return vec3(sampleValue.g * min(uSpectrum.w, ${maxChopHeight}), sampleValue.r * uSpectrum.w,
    sampleValue.b * min(uSpectrum.w, ${maxChopHeight})) * uSpectrum.z;
}

void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 p = vWorld.xz;
  vec4 wave = sampleWave(p);
  vec3 offset = displacement(wave);
  float h = uSpectrum.x / uSpectrum.y * uSpectrum.z;
  vec3 tx = vec3(h, 0.0, 0.0) + displacement(sampleWave(p + vec2(h, 0.0))) - offset;
  vec3 tz = vec3(0.0, 0.0, h) + displacement(sampleWave(p + vec2(0.0, h))) - offset;
  vNormal = normalize(cross(tz, tx));
  vCrest = vec2(vWorld.y + offset.y, wave.a * min(uSpectrum.w, 1.0));
  vWorld += offset;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
