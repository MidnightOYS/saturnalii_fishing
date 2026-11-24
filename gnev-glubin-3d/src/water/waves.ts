import { MathUtils, Object3D, Vector3 } from 'three';

const tau = Math.PI * 2;

/** Direction, wavelength (m), calm and storm amplitude (m), choppiness, phase. */
const spectrum = [
  [ .89,  .46, 18.5, .095, .49, .85, .4],
  [-.37,  .93, 11.8, .063, .30, .80, 2.1],
  [ .43,  .90,  7.1, .075, .29, .80, 1.1],
  [ .91, -.42,  5.0, .052, .20, .73, 4.0],
  [-.67,  .74,  3.2, .033, .104, .65, 2.8],
  [ .23,  .97,  2.5, .018, .052, .53, 5.2],
].map(([x, z, length, calm, rough, chop, phase]) => ({
  x: x / Math.hypot(x, z), z: z / Math.hypot(x, z), k: tau / length,
  calm, rough, chop, phase,
}));
const float = (value: number) => Number(value.toFixed(9)).toFixed(9);

/** Shader constants generated from the CPU spectrum so the two cannot diverge. */
export const gerstnerGLSL = `
  #define WAVE_COUNT ${spectrum.length}
  uniform vec3 uWaves[WAVE_COUNT]; // frequency, amplitude, phase
  void gerstner(
    vec2 rest, vec2 direction, float chop, vec3 wave,
    inout vec3 p, inout vec3 tx, inout vec3 tz, inout float envelope
  ) {
    float phase = dot(direction, rest) * wave.x - wave.z;
    float sine = sin(phase), cosine = cos(phase);
    p.xz += direction * (wave.y * chop * cosine);
    p.y += wave.y * sine;
    vec3 slope = vec3(-direction.x * chop * sine, cosine, -direction.y * chop * sine) * (wave.x * wave.y);
    tx += direction.x * slope;
    tz += direction.y * slope;
    envelope += wave.y;
  }
  void displace(inout vec3 p, out vec3 normal, out float compression, out float crest) {
    vec2 rest = p.xz;
    vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
    float envelope = 0.0;
    ${spectrum.map((wave, i) =>
      `gerstner(rest, vec2(${float(wave.x)}, ${float(wave.z)}), ${float(wave.chop)}, uWaves[${i}], p, tx, tz, envelope);`
    ).join('\n    ')}
    vec3 surface = cross(tz, tx);
    normal = normalize(surface);
    compression = 1.0 - surface.y;
    crest = p.y / max(envelope, 0.001);
  }
`;

/** An Eulerian height query for movable gameplay anchors. Time values are seconds. */
export class WaveField {
  readonly uniforms = spectrum.map(() => new Vector3());

  update(time: number, storm: number, waveScale: number, waveHeight: number) {
    const weather = MathUtils.smoothstep(storm, 0, 1);
    const lengthScale = MathUtils.clamp(waveScale, .7, 1.8);
    const heightScale = MathUtils.clamp(waveHeight, 0, 1.6);
    for (const [i, wave] of spectrum.entries()) {
      const k = wave.k / lengthScale;
      const amplitude = MathUtils.lerp(wave.calm, wave.rough, weather) * heightScale * lengthScale;
      const phase = (time * Math.sqrt(5.1 * k) + wave.phase) % tau;
      this.uniforms[i].set(k, amplitude, phase);
    }
  }

  heightAt(x: number, z: number): number {
    let restX = x;
    let restZ = z;
    // Solve the horizontal Gerstner displacement with the same analytic Jacobian as GLSL.
    for (let iteration = 0; iteration < 5; iteration += 1) {
      let offsetX = restX - x, offsetZ = restZ - z;
      let xx = 1, xz = 0, zz = 1, height = 0;
      for (let i = 0; i < spectrum.length; i += 1) {
        const { x: dx, z: dz, chop } = spectrum[i];
        const { x: k, y: a, z: phase } = this.uniforms[i];
        const angle = (restX * dx + restZ * dz) * k - phase;
        const sine = Math.sin(angle);
        const horizontal = a * chop * Math.cos(angle);
        const derivative = -a * chop * k * sine;
        offsetX += dx * horizontal;
        offsetZ += dz * horizontal;
        xx += dx * dx * derivative;
        xz += dx * dz * derivative;
        zz += dz * dz * derivative;
        height += a * sine;
      }
      if (offsetX * offsetX + offsetZ * offsetZ < 1e-10 || iteration === 4) return height;
      const determinant = xx * zz - xz * xz;
      restX -= (zz * offsetX - xz * offsetZ) / determinant;
      restZ -= (xx * offsetZ - xz * offsetX) / determinant;
    }
    return 0;
  }
}

/** Boat art uses local -Z for the bow, as in the expedition scene. */
export function poseBoat(
  boat: Object3D,
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  heading: number,
  { bowOffset = 1.45, sternOffset = 1.45, halfBeam = .69, waterline = .15 } = {},
) {
  const dx = Math.sin(heading), dz = Math.cos(heading);
  const bow = heightAt(x - dx * bowOffset, z - dz * bowOffset);
  const stern = heightAt(x + dx * sternOffset, z + dz * sternOffset);
  const starboard = heightAt(x + dz * halfBeam, z - dx * halfBeam);
  const port = heightAt(x - dz * halfBeam, z + dx * halfBeam);
  boat.position.set(x, .5 * heightAt(x, z) + .125 * (bow + stern + starboard + port) + waterline, z);
  boat.rotation.set(
    Math.atan2(bow - stern, bowOffset + sternOffset),
    heading,
    Math.atan2(starboard - port, 2 * halfBeam),
    'YXZ',
  );
}
