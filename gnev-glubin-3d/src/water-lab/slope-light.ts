import * as T from 'three';
import { labVertex, labFragmentHeader } from './shared';

// Wavenumber (rad/m), angle relative to wind, slope amplitude, starting phase.
// Band amplitudes describe slopes directly, so minute waves can still reflect light.
const rippleBands = [
  [2.1, -.60, .080, .4], [3.4, .88, .079, 3.7], [5.9, -.13, .087, 2.8],
  [8.5, 1.12, .066, 1.2], [13.3, -.98, .062, 4.6], [18.7, .31, .064, 5.1],
  [29.0, -.67, .056, 2.2], [46.0, 1.15, .049, 1.8], [73.0, .27, .051, 5.8],
  [117.0, -.32, .048, 3.4], [193.0, .79, .041, 4.4], [313.0, -.53, .034, .7],
];

const evaluateBands = rippleBands.map(band =>
  `rippleBand(${band.map(v => v.toFixed(3)).join(', ')}, p, dx, dy, gain, mean, variance);`,
).join('\n  ');

const fragment = `${labFragmentHeader}
const float slopePi = 3.14159265;

// The Gaussian has the same second moment as a one-pixel box. Integrating
// cos(phi) and cos²(phi) gives both the resolved normal and its missing energy.
// variance packs xx, xz and zz in the wind-aligned coordinate system.
void rippleBand(float k, float angle, float strength, float phase, vec2 p,
                vec2 dx, vec2 dy, float gain, inout vec2 mean, inout vec3 variance) {
  angle *= mix(1.48, .30, clamp(uFeature * .5, 0.0, 1.0));
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 crossDir = vec2(-dir.y, dir.x);
  // Individual wave packets bend around different, slowly travelling wind fronts.
  // Using the gradient of the curved phase also rotates the slope covariance.
  vec2 bendK = crossDir * (.33 + .12 * sin(phase));
  vec2 driftK = (.48 * dir + .88 * crossDir) * (.18 + .065 * cos(phase));
  float drift = dot(p, driftK) + phase * 2.24 - uTime * .061;
  float bend = dot(p, bendK) + phase * 3.71 + .76 * sin(drift) + uTime * .084;
  float bendScale = 1.17 + .28 * sin(phase * 3.13);
  vec2 gradient = dir + bendScale * cos(bend) * (bendK + .76 * cos(drift) * driftK);
  vec2 heading = normalize(gradient);
  float omega = sqrt(9.81 * k) * (.64 + .15 * uWind);
  float a = (dot(p, dir) + bendScale * sin(bend)) * k - uTime * omega + phase;
  float group = .62 * sin(drift * 1.36 + .73 * sin(bend)) + .38 * cos(bend * .78 + phase);
  float amplitude = strength * gain * mix(.12, 1.14, smoothstep(-.53, .63, group));
  vec2 footprint = vec2(dot(dx, gradient), dot(dy, gradient)) * k;
  float phaseVariance = dot(footprint, footprint) / 12.0;
  float attenuation = exp(-.5 * phaseVariance);
  float m = attenuation * cos(a);
  float secondMoment = .5 * (1.0 + cos(2.0 * a) * exp(-2.0 * phaseVariance));
  mean += heading * (amplitude * m);
  variance += vec3(heading.x * heading.x, heading.x * heading.y, heading.y * heading.y)
            * (amplitude * amplitude * max(0.0, secondMoment - m * m));
}

float waterFresnel(float cosine) {
  return .0204 + .9796 * pow(1.0 - clamp(cosine, 0.0, 1.0), 5.0);
}

// A directional sky, integrated over the covariance below. Sunlight is handled
// separately by the Beckmann distribution and never multiplied by a world-space mask.
vec3 skyRadiance(vec3 ray) {
  float y = clamp(ray.y, 0.0, 1.0);
  vec3 zenith = mix(vec3(.19, .40, .59), vec3(.065, .108, .18), uWrath);
  vec3 horizon = mix(vec3(.80, .81, .69), vec3(.31, .36, .40), uWrath);
  float azimuth = dot(normalize(ray.xz + vec2(.0001)), normalize(uSun.xz + vec2(.0001)));
  vec3 sky = mix(horizon, zenith, sqrt(y));
  sky += uSunColor * exp(-y * 5.0) * smoothstep(-.15, 1.0, azimuth) * .37;
  return sky;
}

vec3 skyAtSlope(vec2 s, vec2 wind, vec2 across, vec3 V) {
  vec2 g = wind * s.x + across * s.y;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 reflected = reflect(-V, n);
  return skyRadiance(reflected) * waterFresnel(dot(V, n));
}

void main() {
  vec2 wind = normalize(vec2(.93, .37));
  vec2 across = vec2(-wind.y, wind.x);
  vec2 p = vec2(dot(vWorld.xz, wind), dot(vWorld.xz, across));
  vec2 dx = dFdx(p), dy = dFdy(p);
  vec2 geo = -vNormal.xz / max(vNormal.y, .16);
  vec2 mean = vec2(dot(geo, wind), dot(geo, across));
  // Elongated, evolving gusts leave broad sheltered intervals between capillary packets.
  float path = p.y * .46 + 1.28 * sin(p.x * .17 + .43 * sin(p.y * .13) - uTime * .085);
  float gust = smoothstep(-.40, .68, .64 * sin(path + uTime * .21)
                         + .36 * cos(dot(p, vec2(.14, -.21)) + uTime * .11));
  float windGain = .47 + .33 * uWind + .43 * uWrath;
  float gain = windGain * uDetail * mix(.25, 1.19, gust);
  float broadPhase = .77 * p.x + .13 * p.y + 1.54 * sin(p.y * .34 + .63 * sin(p.x * .16) - uTime * .12)
                   - uTime * (.87 + .17 * uWind);
  float broadFront = cos(broadPhase);
  float broadGain = (.075 + .082 * uWind + .12 * uWrath) * mix(.58, 1.12, gust) * uWaves;
  mean += broadGain * broadFront * vec2(1.0, .49 * cos(p.y * .34 - uTime * .12));
  // Small capillaries beyond the last band and finite angular sun size prevent singularities.
  vec2 baseWidth = vec2(.034 + .017 * uWind, .029 + .010 * uWind) * mix(.70, 1.12, gust);
  baseWidth.y *= mix(1.40, .69, uFeature * .5);
  vec3 variance = vec3(baseWidth.x * baseWidth.x, 0.0, baseWidth.y * baseWidth.y);
  ${evaluateBands}

  vec3 V = normalize(uEye), L = normalize(uSun);
  vec3 H = normalize(V + L);
  vec2 target = -H.xz / max(.12, H.y);
  vec2 error = vec2(dot(target, wind), dot(target, across)) - mean;
  float det = max(variance.x * variance.z - variance.y * variance.y, 1e-9);
  float mahalanobis = (variance.z * error.x * error.x - 2.0 * variance.y * error.x * error.y
                     + variance.x * error.y * error.y) / det;
  float density = exp(-.5 * max(0.0, mahalanobis)) / (2.0 * slopePi * sqrt(det));
  float distribution = density / pow(max(H.y, .2), 4.0);
  vec2 slope = wind * mean.x + across * mean.y;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  float facing = max(.001, dot(V, N)), lighting = max(.001, dot(L, N));
  float masking = smoothstep(.0, .18, min(facing, lighting));
  float glint = distribution * waterFresnel(dot(H, V)) * masking / max(4.0 * V.y, .15);

  // Four Gaussian cubature samples integrate skylight and Fresnel against the
  // same subpixel slope distribution. Their covariance exactly matches the input.
  float xx = sqrt(variance.x);
  float zx = variance.y / xx;
  vec2 axisA = 1.4142 * vec2(xx, zx);
  vec2 axisB = 1.4142 * vec2(0.0, sqrt(max(.00001, variance.z - zx * zx)));
  vec3 sky = .25 * (skyAtSlope(mean + axisA, wind, across, V) + skyAtSlope(mean - axisA, wind, across, V)
                  + skyAtSlope(mean + axisB, wind, across, V) + skyAtSlope(mean - axisB, wind, across, V));

  vec2 broadSlope = geo + wind * broadGain * broadFront;
  vec3 broadNormal = normalize(vec3(-broadSlope.x, 1.0, -broadSlope.y));
  float shoulder = smoothstep(.46, .81, dot(broadNormal, L));
  float lift = smoothstep(-.21, .40, vWorld.y + .14 * sin(broadPhase) * uWaves);
  vec3 color = mix(uDeep * .68, uShallow * .62, .03 + .10 * shoulder + .36 * lift * shoulder);
  color += sky * (.50 + .46 * uLight);
  // Shoulder on the intense sun only; retain detail before the scene-wide tone mapping.
  float solar = glint * (.67 - .16 * uWrath) * uLight;
  color += uSunColor * solar / (1.0 + solar * .87);
  gl_FragColor = vec4(labFinish(color), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSlopeLight(uniforms: Record<string, T.IUniform>) {
  const material = new T.ShaderMaterial({
    name: 'Ocean slope variance',
    uniforms, vertexShader: labVertex, fragmentShader: fragment,
    extensions: { derivatives: true },
  });
  return { material, dispose: () => material.dispose() };
}
