import { gerstnerGLSL } from './waves';

export const vertexShader = `
  ${gerstnerGLSL}
  varying vec3 vWorld, vNormal;
  varying vec2 vCrest;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    float compression, crest;
    displace(vWorld, vNormal, compression, crest);
    vCrest = vec2(compression, crest);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

export const fragmentShader = `
  #define MAX_RIPPLES 6
  #define MAX_LAMPS 4
  uniform float uTime, uStorm, uFoam, uWake, uWakeActive, uReflect, uDistortion, uFog, uSunPower;
  uniform float uCapillaryOn, uDepthOn, uCrestLightOn, uShoreFoamOn, uCrestFoamOn;
  uniform vec3 uDeep, uShallow, uCrestColor, uSky, uSunDir, uSunColor, uOrthoEye;
  uniform vec2 uGlintOrigin;
  uniform vec4 uWorldRect, uRipples[MAX_RIPPLES], uLamps[MAX_LAMPS];
  uniform mat4 uReflectMatrix;
  uniform sampler2D tReflection, tCoast, tDetail, tWake;
  varying vec3 vWorld, vNormal;
  varying vec2 vCrest;

  float edgeStep(float limit, float signal) {
    float w = max(fwidth(signal), 0.021);
    return smoothstep(limit - w, limit + w, signal);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 uv = (p - uWorldRect.xy) / uWorldRect.zw;
    vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
    float inAtlas = inside.x * inside.y;
    vec2 coast = mix(vec2(1.0), texture2D(tCoast, uv).rg, inAtlas);
    float shore = coast.r * 7.0 - 1.0;
    float depth = mix(1.0, coast.g, uDepthOn);
    vec3 eye = isOrthographic ? uOrthoEye : normalize(cameraPosition - vWorld);

    // Fine ripples travel independently of the six displaced wave bands.
    float r1 = dot(p, vec2(4.7, 6.4)) + sin(dot(p, vec2(.91, -1.43)) + uTime * .88) * .89 - uTime * 3.0;
    float r2 = dot(p, vec2(-9.1, 3.8)) + sin(p.y * 1.14 - uTime * .85) * .95 - uTime * 4.2;
    float r3 = dot(p, vec2(3.1, -12.3)) - uTime * 5.0;
    vec2 capillary = cos(r1) * vec2(.037, .046) + cos(r2) * vec2(-.026, .013) + cos(r3) * vec2(.009, -.025);
    vec2 footprint = fwidth(p);
    capillary *= (1.0 - smoothstep(.15, .42, max(footprint.x, footprint.y))) * mix(.78, 1.33, uStorm) * uCapillaryOn;
    float eventFoam = 0.0;
    for (int i = 0; i < MAX_RIPPLES; i++) {
      vec4 event = uRipples[i]; // x, z, age, strength
      if (event.w <= 0.0) continue;
      vec2 delta = p - event.xy;
      float distance = length(delta);
      float front = distance - event.z * (1.78 + event.w * .34);
      float spread = exp(-3.6 * abs(front)) * (1.0 - smoothstep(.12, 1.42, event.z));
      float pulse = cos(front * 20.0);
      capillary += delta / max(distance, .06) * pulse * spread * event.w * .22;
      float line = exp(-abs(front) * 20.0) + exp(-abs(front + .24) * 22.0) * .40;
      eventFoam = max(eventFoam, line * spread * event.w);
    }
    vec3 n = normalize(vNormal + vec3(capillary.x, 0.0, capillary.y));
    float ndv = max(dot(n, eye), 0.0);
    float fresnel = .045 + .955 * pow(1.0 - ndv, 4.0);
    float stormDim = mix(1.0, .49, uStorm);
    float crest = smoothstep(.02, .72, vCrest.y) * smoothstep(-.01, .38, vCrest.x);
    float backlight = .28 + .72 * pow(max(0.0, dot(eye, -uSunDir * vec3(1.0, 0.0, 1.0))), .7);
    float waveFacing = .67 + .40 * max(dot(n, uSunDir), 0.0);
    vec2 tide = p * vec2(.122, .169);
    vec3 detail = texture2D(tDetail, tide + vec2(.017, -.011) * uTime + vNormal.xz * .085).rgb;
    vec3 secondary = texture2D(tDetail, tide.yx * 1.82 + vec2(-.018, .013) * uTime).rgb;

    vec3 body = mix(uShallow, uDeep, smoothstep(.04, .93, depth)) * waveFacing * stormDim;
    vec3 clearCrest = uCrestColor * mix(1.0, .68, uStorm);
    body += uCrestLightOn * clearCrest * crest * (.57 + backlight) * (1.0 - depth * .27);
    // The submerged shelf catches a faint moving pattern beneath the surface.
    float bed = pow(detail.r, 2.6) * (.4 + .60 * secondary.r);
    body += uShallow * bed * (.20 * (1.0 - depth)) * (1.0 - uStorm * .78);
    body *= .96 + .075 * secondary.g;
    vec3 reflected = uSky;
    if (uReflect > .001) {
      vec2 bend = (n.xz + .30 * vNormal.xz) * uDistortion;
      vec4 clipped = uReflectMatrix * vec4(p.x + bend.x, 0.0, p.y + bend.y, 1.0);
      vec2 mirrorUV = clipped.xy / clipped.w * .5 + .5;
      float toEdge = min(min(mirrorUV.x, mirrorUV.y), min(1.0 - mirrorUV.x, 1.0 - mirrorUV.y));
      reflected = mix(uSky, texture2D(tReflection, mirrorUV).rgb, smoothstep(.002, .065, toEdge));
    }
    float reflectionStrength = (.105 + fresnel * .72) * uReflect;
    body = mix(body, reflected, clamp(reflectionStrength, 0.0, .86));

    // An elongated patch gives the sun a readable path with the parallel gameplay camera.
    vec2 horizontalSun = normalize(uSunDir.xz + vec2(.00001, 0.0));
    vec2 toSun = p - uGlintOrigin;
    float crossSun = dot(toSun, vec2(horizontalSun.y, -horizontalSun.x));
    float alongSun = dot(toSun, horizontalSun);
    float road = exp(-pow(crossSun / 5.8, 2.0) - pow(alongSun / 17.0, 2.0));
    vec3 halfSun = normalize(eye + uSunDir);
    float highlight = max(0.0, dot(n, halfSun));
    float glint = pow(highlight, 42.0) * .29 + pow(highlight, 123.0) * .42;
    float broken = smoothstep(.23, .84, .48 + .19 * cos(r1) + .12 * sin(r2) + detail.g * .24);
    body += uSunColor * uSunPower * road * glint * (.19 + .81 * broken) * mix(1.0, .29, uStorm);

    for (int i = 0; i < MAX_LAMPS; i++) {
      vec4 lamp = uLamps[i];
      if (lamp.w <= 0.0) continue;
      vec2 offset = (p - lamp.xz) - eye.xz * .72;
      vec2 axis = normalize(eye.xz + vec2(.0001, 0.0));
      float along = dot(offset, axis);
      float sideways = dot(offset, vec2(axis.y, -axis.x));
      float pool = exp(-sideways * sideways * 1.3 - along * along * .27);
      vec3 halfLamp = normalize(eye + normalize(lamp.xyz - vWorld));
      float glimmer = pow(max(dot(n, halfLamp), 0.0), 13.0);
      body += vec3(.78, .33, .094) * lamp.w * pool * (.11 + .61 * glimmer * broken);
    }
    float coastLine = shore + .19 * sin(uTime * 1.19 + p.x * .73 + p.y * .51) - .11 * vWorld.y;
    float shoreFoam = (1.0 - smoothstep(.08, mix(.53, .97, uStorm), coastLine)) * smoothstep(-.58, -.18, coastLine);
    float lace = edgeStep(.49, detail.r * .77 + secondary.r * .22 + detail.g * .25);
    float wash = edgeStep(.47, detail.g * .69 + secondary.g * .31);
    float breakers = smoothstep(.14, .49, vCrest.x) * smoothstep(.12, .61, vCrest.y);
    float crestFoam = breakers * smoothstep(.12, .72, uStorm);
    float idleFoam = uShoreFoamOn * shoreFoam * (.22 + lace * .65) * (.49 + .51 * wash);
    idleFoam += uCrestFoamOn * crestFoam * (.13 + .87 * lace) * (.28 + .72 * wash);
    float wake = 0.0;
    if (uWakeActive > 0.5) {
      wake = texture2D(tWake, uv).r * inAtlas * uWake * (.38 + .62 * lace);
    }
    float foam = clamp(idleFoam * uFoam + wake * .93, 0.0, .92);
    vec3 foamColor = mix(vec3(.61, .68, .59), vec3(.43, .58, .60), uStorm);
    body = mix(body, foamColor, foam);
    // Gameplay ripples retain contrast regardless of the cosmetic foam slider.
    body = mix(body, vec3(.79, .87, .68), clamp(eventFoam * .83, 0.0, .87));

    float fogDepth = -(viewMatrix * vec4(vWorld, 1.0)).z;
    body = mix(body, uSky, 1.0 - exp(-pow(fogDepth * uFog, 2.0)));
    gl_FragColor = vec4(max(body, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
