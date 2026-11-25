export const waterOptics = `
uniform float uTime, uStorm, uFoam, uWake, uWakeActive, uReflect, uDistortion, uFog, uSunPower;
uniform float uCapillaryOn, uDepthOn, uCrestLightOn, uShoreFoamOn, uCrestFoamOn;
uniform float uRoughness, uClarity, uScattering;
uniform float uCausticGain;
uniform vec3 uDeep, uShallow, uCrestColor, uSky, uSunDir, uSunColor, uOrthoEye;
uniform vec2 uGlintOrigin;
uniform vec4 uWorldRect, uRipples[6], uLamps[4];
uniform mat4 uReflectMatrix;
uniform sampler2D tReflection, tCoast, tDetail, tWake;
varying vec3 vWorld, vNormal;
varying vec2 vCrest;

struct WaterSurface {
  vec2 p;
  vec2 uv;
  float inAtlas;
  float depth;
  float edge;
  vec3 eye;
  vec3 n;
  vec3 grain;
  vec3 detail;
  float impact;
};

WaterSurface readSurface(float rippleSize) {
  WaterSurface w;
  w.p = vWorld.xz;
  w.uv = (w.p - uWorldRect.xy) / uWorldRect.zw;
  vec2 inside = step(vec2(0.0), w.uv) * step(w.uv, vec2(1.0));
  w.inAtlas = inside.x * inside.y;
  vec2 coast = mix(vec2(1.0), texture2D(tCoast, w.uv).rg, w.inAtlas);
  w.depth = mix(1.0, coast.g, uDepthOn);
  w.edge = coast.r * 7.0 - 1.0;
  w.eye = isOrthographic ? uOrthoEye : normalize(cameraPosition - vWorld);

  vec2 wind = mat2(.88, -.475, .475, .88) * w.p;
  w.grain = texture2D(tDetail, wind * vec2(.094, .144) + vec2(-.023, .008) * uTime).rgb;
  w.detail = texture2D(tDetail, wind.yx * vec2(.172, .233) + vec2(.014, .027) * uTime).rgb;
  float a = wind.x * 8.1 + wind.y * 1.77 - uTime * 4.4 + w.grain.g * 3.9;
  float b = wind.x * 5.4 - wind.y * 6.6 - uTime * 3.25 + w.detail.g * 3.1;
  float c = wind.x * 2.4 + wind.y * 15.6 - uTime * 5.95;
  vec2 motion = vec2(cos(a) * .066 - cos(b) * .045, cos(a) * .054 + cos(c) * .033);
  vec2 pixel = fwidth(w.p);
  motion *= uCapillaryOn * rippleSize * mix(.65, 1.55, uStorm)
    * (1.0 - smoothstep(.15, .48, max(pixel.x, pixel.y)));
  w.impact = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 ring = uRipples[i];
    if (ring.w <= 0.0) continue;
    vec2 delta = w.p - ring.xy;
    float dist = length(delta);
    float d = dist - ring.z * (1.85 + .39 * ring.w);
    float fade = (1.0 - smoothstep(.2, 1.42, ring.z)) * exp(-3.7 * abs(d)) * ring.w;
    motion += delta / max(dist, .06) * cos(d * 25.0) * fade * .16;
    w.impact = max(w.impact, (exp(-abs(d) * 22.0) + .35 * exp(-abs(d + .27) * 20.0)) * fade);
  }
  w.n = normalize(vNormal + vec3(motion.x, 0.0, motion.y));
  return w;
}

float fresnelWater(float viewAngle) {
  float r = 1.0 - clamp(viewAngle, 0.0, 1.0);
  return .0204 + .9796 * r * r * r * r * r;
}

vec3 sceneMirror(WaterSurface w, vec3 sky, float warp) {
  if (uReflect <= .001) return sky;
  vec2 bend = (w.n.xz * .75 + vNormal.xz * .25) * uDistortion * warp;
  vec4 q = uReflectMatrix * vec4(w.p.x + bend.x, 0.0, w.p.y + bend.y, 1.0);
  vec2 uv = q.xy / q.w * .5 + .5;
  vec2 inset = min(uv, vec2(1.0) - uv);
  float edge = smoothstep(.0, .077, min(inset.x, inset.y));
  vec3 image = texture2D(tReflection, uv).rgb;
  return mix(sky, image, edge * .88);
}

float smith(float nd, float alpha2) {
  return 2.0 * nd / max(nd + sqrt(alpha2 + (1.0 - alpha2) * nd * nd), .002);
}

float sunLobe(WaterSurface w, float width, float length) {
  vec3 reflectDir = reflect(-w.eye, w.n);
  // Readable finite solar disc. Modulating through the moving normal breaks its path into facets.
  float proximity = clamp(dot(reflectDir, uSunDir), 0.0, 1.0);
  vec3 h = normalize(w.eye + uSunDir);
  float ndh = max(dot(w.n, h), 0.0);
  float ndv = max(dot(w.n, w.eye), .001), ndl = max(dot(w.n, uSunDir), .0);
  float alpha = max(.068, uRoughness * uRoughness + uStorm * .048);
  float a2 = alpha * alpha;
  float denominator = 1.0 + ndh * ndh * (a2 - 1.0);
  float spec = a2 / max(3.14159 * denominator * denominator, .0001);
  spec *= smith(ndl, a2) * smith(ndv, a2) * .0204 / max(4.0 * ndv, .08);
  vec2 wind = normalize(uSunDir.xz + .0001);
  vec2 p = w.p - uGlintOrigin;
  float across = dot(p, vec2(wind.y, -wind.x)) / width;
  float along = dot(p, wind) / length;
  return (min(spec, .85) * 1.4 + pow(proximity, 39.0) * .14) *
    exp(-across * across - along * along) * mix(1.0, .35, uStorm);
}

vec3 lampLight(WaterSurface w) {
  vec3 color = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 lamp = uLamps[i];
    if (lamp.w <= 0.0) continue;
    vec3 toLamp = lamp.xyz - vWorld;
    vec3 h = normalize(w.eye + normalize(toLamp));
    vec2 axis = normalize(w.eye.xz + vec2(.0001));
    vec2 offset = (w.p - lamp.xz) - w.eye.xz * .76;
    float down = dot(offset, axis);
    float crosswise = dot(offset, vec2(-axis.y, axis.x));
    float pool = exp(-1.4 * crosswise * crosswise - .39 * down * down);
    color += vec3(.79, .32, .101) * lamp.w * pool * (.12 + .62 * pow(max(0.0, dot(w.n, h)), 22.0));
  }
  return color;
}

float filigree(WaterSurface w) {
  float grain = w.grain.r * .73 + .20 * w.grain.g + .20 * w.detail.r;
  float threshold = max(fwidth(grain), .025);
  return smoothstep(.54 - threshold, .54 + threshold, grain);
}

float boatFoam(WaterSurface w, float lace) {
  if (uWakeActive < .5) return 0.0;
  return texture2D(tWake, w.uv).r * w.inAtlas * uWake * (.43 + .57 * lace);
}

vec3 fogAndImpact(WaterSurface w, vec3 body) {
  body = mix(body, vec3(.78, .86, .72), clamp(w.impact * .8, 0.0, .89));
  float fogDepth = -(viewMatrix * vec4(vWorld, 1.0)).z * uFog;
  return mix(body, uSky, 1.0 - exp(-fogDepth * fogDepth));
}
`;

export const spectralFragment = `${waterOptics}
void main() {
  WaterSurface w = readSurface(1.06);
  float ndv = max(dot(w.n, w.eye), 0.0);
  float f = fresnelWater(ndv);
  float sunward = .67 + .46 * max(dot(w.n, uSunDir), 0.0);
  float hollow = smoothstep(-.8, .17, vCrest.x);
  vec3 deep = uDeep * mix(.76, 1.22, hollow) * mix(1.0, .57, uStorm);
  float bank = exp(-4.0 * w.depth);
  vec3 body = mix(deep, uShallow * mix(1.0, .57, uStorm), bank * .91) * sunward;
  // Thin, high water illuminates from within on the backlit face of the swell.
  float crestHeight = smoothstep(.035, mix(.31, .94, uStorm), vCrest.x);
  float back = .35 + .74 * max(dot(w.eye, normalize(vec3(-uSunDir.x, .15, -uSunDir.z))), 0.0);
  float film = crestHeight * back * (.56 + .44 * (1.0 - ndv));
  body += uCrestColor * film * uScattering * uCrestLightOn * mix(.76, .55, uStorm);
  vec3 ray = reflect(-w.eye, w.n);
  vec3 sky = mix(uSky * vec3(1.13, 1.15, 1.10), uSky * vec3(.72, .95, 1.12), smoothstep(.05, .78, ray.y));
  vec3 mirror = sceneMirror(w, sky, 1.25);
  body = mix(body, mirror, min(.92, uReflect * (.093 + f * .98)));
  body += uSunColor * uSunPower * sunLobe(w, 7.2, 22.0) * (.75 + .49 * w.grain.g);
  body += lampLight(w);
  float lace = filigree(w);
  float wash = smoothstep(.24, .81, w.detail.g * .58 + w.grain.g * .42);
  float contact = w.edge + .20 * sin(uTime * 1.7 + w.p.x * .76 + w.p.y * .39) - .14 * vWorld.y;
  float skirt = smoothstep(-.61, -.18, contact) * (1.0 - smoothstep(.07, .62 + .48 * uStorm, contact));
  float cap = smoothstep(.028, .58, vCrest.y) * (.24 + .61 * lace + .15 * wash);
  float foam = uFoam * (uCrestFoamOn * cap + uShoreFoamOn * skirt * (.25 + .52 * lace)) + boatFoam(w, lace);
  vec3 bubbles = mix(vec3(.67, .81, .78), vec3(.55, .69, .72), uStorm);
  body = mix(body, bubbles, clamp(foam, 0.0, .93));
  gl_FragColor = vec4(max(fogAndImpact(w, body), vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const lagoonFragment = `${waterOptics}
void main() {
  WaterSurface w = readSurface(.73);
  float ndv = max(dot(w.n, w.eye), .0);
  float f = fresnelWater(ndv);
  // Trace a refracted ray to a synthetic seabed shaped by the same shelf as the waves.
  float d = .16 + 9.3 * w.depth * w.depth;
  vec3 transmitted = refract(-w.eye, w.n, 1.0 / 1.333);
  float opticalLength = d / max(.28, -transmitted.y);
  vec2 bottom = w.p + transmitted.xz * min(opticalLength, 7.5);
  vec3 sand = texture2D(tDetail, bottom * vec2(.31, .268)).rgb;
  vec3 large = texture2D(tDetail, bottom.yx * .064).rgb;
  vec2 shimmer = vec2(.079, -.048) * uTime;
  float ca = texture2D(tDetail, bottom * vec2(.19, .15) + shimmer + w.n.xz * .27).r;
  float cb = texture2D(tDetail, bottom.yx * .121 - shimmer * .81).r;
  float caustic = pow(max(ca * .78 + cb * .53 - .17, .0), 3.2);
  float marbling = .54 + .39 * large.g + .14 * sand.g;
  vec3 bed = mix(uShallow * vec3(1.34, 1.08, .76), uShallow * vec3(.59, .77, .69), smoothstep(.38, .74, large.g));
  bed *= marbling;
  bed += uSunColor * caustic * uCrestLightOn * uScattering * (.73 - .56 * uStorm) * uCausticGain;
  vec3 transmittance = exp(-vec3(.66, .32, .20) * opticalLength / max(.15, uClarity));
  vec3 columnColor = mix(uDeep, uShallow * .57, exp(-d * .63) * .42);
  vec3 body = columnColor * (1.0 - transmittance) + bed * transmittance;
  body *= mix(1.0, .61, uStorm);
  float waveGlass = smoothstep(.09, .72, vCrest.x) * smoothstep(.12, .65, w.depth);
  body += uCrestColor * waveGlass * (.22 * uScattering * uCrestLightOn);
  vec3 mirror = sceneMirror(w, uSky * vec3(.89, 1.03, 1.08), .71);
  body = mix(body, mirror, min(.87, uReflect * (.066 + f * 1.02)));
  body += uSunColor * uSunPower * sunLobe(w, 4.2, 20.0) * (.64 + .61 * w.grain.g);
  body += lampLight(w) * 1.14;
  float lace = filigree(w);
  float breaker = float(uDepthOn > .5) * smoothstep(.055, .20, w.depth) * (1.0 - smoothstep(.34, .74, w.depth));
  float swell = smoothstep(mix(.09, .24, uStorm), mix(.19, .71, uStorm), vCrest.x);
  float runup = w.edge + .48 * sin(uTime * 1.09 + w.p.x * .86 + w.p.y * .47) - .35 * vWorld.y;
  float onBank = smoothstep(-.6, -.17, runup) * (1.0 - smoothstep(.02, .35 + .24 * uStorm, runup));
  float foam = uFoam * (uShoreFoamOn * onBank * (.16 + lace * .67) +
    uCrestFoamOn * breaker * swell * (.13 + .63 * lace)) + boatFoam(w, lace);
  body = mix(body, vec3(.64, .73, .64), clamp(foam, 0.0, .9));
  gl_FragColor = vec4(max(fogAndImpact(w, body), vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
