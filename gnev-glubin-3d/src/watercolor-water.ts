import * as T from 'three';
import { createWater, type Shore, type WaterBounds } from './water';
import { lagoonVertex } from './water/lagoon';
import { waterOptics } from './water/optics';
import { fitLocationSurface, type LocationSurface } from './water/location-surface';

export type PaintedSurfaceSettings = {
  bottom: boolean;
  clarity: number;
  glints: number;
  caustics: number;
};

const vertex = lagoonVertex
  .replace('varying vec2 vCrest;', 'varying vec2 vCrest; varying vec4 vScreen;')
  .replace('gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);',
    'gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0); vScreen = gl_Position;');

const fragment = `${waterOptics}
varying vec4 vScreen;
uniform sampler2D tBottom;
uniform float uBottomOn, uGlints, uCaustics, uSurge;
uniform vec3 uStormInk;
uniform vec4 uHull, uThreat;

// Two sets of wind ripples travel across the common nearshore wave field.
vec3 paintNormal(WaterSurface w) {
  vec2 axis = normalize(vec2(.81, .59));
  vec2 across = vec2(-axis.y, axis.x);
  float flow = dot(w.p, axis);
  float crossFlow = dot(w.p, across);
  float ripple = sin(flow * 7.2 + crossFlow * 2.6 + w.grain.g * 3.0 - uTime * 4.9);
  float lace = cos(crossFlow * 13.2 - flow * 1.7 + w.detail.g * 2.9 + uTime * 3.0);
  vec2 bend = axis * ripple * .038 + across * lace * .028;
  float width = max(fwidth(w.p.x), fwidth(w.p.y));
  bend *= (1.0 - smoothstep(.05, .20, width)) * uCapillaryOn * (1.0 + uStorm * .7);
  return normalize(w.n + vec3(bend.x, 0.0, bend.y));
}

float lightsOnWater(WaterSurface w, vec3 n) {
  vec3 h = normalize(uSunDir + w.eye);
  float facet = max(0.0, dot(n, h));
  vec2 axis = normalize(uSunDir.xz + vec2(.001));
  vec2 along = w.p - uGlintOrigin;
  float side = dot(along, vec2(-axis.y, axis.x));
  float road = exp(-side * side / 61.0);
  float daylight = smoothstep(.32, .74, uSunDir.y);
  vec2 stroke = vec2(dot(w.p, axis) * .20, dot(w.p, vec2(-axis.y, axis.x)) * .69);
  stroke *= mix(vec2(.66, .92), vec2(1.16, 1.0), daylight);
  float fleck = texture2D(tDetail, stroke + vec2(-.075, .044) * uTime).g;
  float sparks = smoothstep(.53, .76, fleck) * pow(facet, mix(134.0, 240.0, daylight));
  float broad = pow(facet, 65.0) * mix(.055, .018, daylight);
  return (sparks * (.72 + .21 * daylight) + broad) * mix(.23 + .77 * road, 1.0, daylight);
}

float boatShadow(WaterSurface w, float waterDepth) {
  vec2 d = w.p - uHull.xy + uSunDir.xz * (.33 + .31 * waterDepth);
  vec2 bow = uHull.zw;
  vec2 local = vec2(dot(d, vec2(-bow.y, bow.x)), dot(d, bow));
  float mask = length(local / vec2(.85 + .09 * waterDepth, 1.72 + .11 * waterDepth));
  return (1.0 - smoothstep(.60, 1.39, mask)) * (1.0 - smoothstep(2.0, 8.0, waterDepth)) * .54;
}

float shadowBelow(WaterSurface w) {
  // Show the approaching servant below the water before the warning expires.
  vec2 delta = w.p - uThreat.xy;
  vec2 axis = vec2(cos(uThreat.w), sin(uThreat.w));
  vec2 local = vec2(dot(delta, axis), dot(delta, vec2(-axis.y, axis.x)));
  float body = length(local / vec2(2.3, .61));
  float fin = length((local - vec2(.03, .21)) / vec2(.72, 1.48));
  return (1.0 - smoothstep(.43, 1.25, min(body, fin))) * uThreat.z;
}

void main() {
  WaterSurface w = readSurface(.77);
  vec3 n = paintNormal(w);
  float depth = mix(.58, 10.4, pow(w.depth, 1.65));
  vec3 ray = refract(-w.eye, n, 1.0 / 1.333);
  float path = depth / max(.28, -ray.y);
  vec2 bottom = w.p + ray.xz * min(path, 7.1);
  vec2 screen = vScreen.xy / vScreen.w * .5 + .5;
  vec2 refracted = screen + clamp(n.xz * (.007 + .002 * depth), vec2(-.022), vec2(.022));
  vec3 seabed = uShallow * (.74 + w.detail.g * .26);
  if (uBottomOn > .5) {
    vec4 captured = texture2D(tBottom, clamp(refracted, .001, .999));
    seabed = mix(seabed, captured.rgb * .91 + uShallow * .10, captured.a);
  }
  float ca = texture2D(tDetail, bottom * vec2(.21, .173) + vec2(.031, -.046) * uTime + n.xz * .24).r;
  float cb = texture2D(tDetail, bottom.yx * .14 + vec2(-.024, .018) * uTime).r;
  float net = pow(max(0.0, ca * .73 + cb * .50 - .20), 3.5);
  float causticDepth = 1.0 - smoothstep(1.8, 7.1, depth);
  seabed += uSunColor * net * uCaustics * causticDepth * (1.0 - uStorm * .88) * .40;
  seabed *= 1.0 - boatShadow(w, depth);
  float readable = clamp(uClarity * (1.0 - uStorm * .83), .12, 3.4);
  vec3 transmission = exp(-vec3(.61, .37, .31) * path / readable);
  vec3 pigment = mix(uDeep, uStormInk, uStorm);
  pigment = mix(pigment, uShallow * vec3(.71, 1.02, 1.10), exp(-depth * .45) * (1.0 - uStorm * .83));
  float lightAngle = max(0.0, dot(n, uSunDir));
  float windStripe = sin(dot(w.p, vec2(.41, .81)) - uTime * 1.8 + w.grain.g * 4.0);
  pigment *= .76 + .29 * lightAngle + .08 * windStripe + .07 * w.grain.g;
  vec3 body = pigment * (1.0 - transmission) + seabed * transmission;
  float edgeForeshortening = pow(1.0 - max(0.0, dot(w.eye, n)), 3.0);
  body = mix(body, uSky, edgeForeshortening * .32 + .05 * w.detail.g);
  body += uCrestColor * smoothstep(.13, .65, vCrest.x) * (.17 + uStorm * .14) * (1.0 - lightAngle * .35);
  body *= 1.0 - shadowBelow(w) * (.45 + transmission.g * .29);
  body += uSunColor * lightsOnWater(w, n) * uSunPower * uGlints * (1.0 - uStorm * .62);
  body += lampLight(w) * (.65 + .55 * uStorm);
  vec2 foamUV = w.p * vec2(.127, .171) + (vec2(w.grain.g, w.detail.g) - .5) * .14;
  vec3 foamDetail = texture2D(tDetail, foamUV - vec2(.034, .018) * uTime).rgb;
  float breakup = texture2D(tDetail, w.p * vec2(.51, .74) + vec2(-.044, .057) * uTime).g;
  float lace = smoothstep(.50, .86, foamDetail.r) * smoothstep(.28, .74, breakup);
  float shore = w.edge + .32 * sin(w.p.x * .72 + w.p.y * .85 - uTime * 1.9) - .22 * vCrest.x;
  float wash = smoothstep(-.48, -.06, shore) * (1.0 - smoothstep(.14, .57 + uStorm * .42, shore));
  float breaker = smoothstep(.37, .80, vCrest.x) * smoothstep(.46, .92, uStorm);
  float foam = (wash * .44 + breaker * .83) * (.12 + lace * .72 + foamDetail.g * .10) * uFoam;
  foam += boatFoam(w, lace) * 1.20;
  float pulse = sin(length(w.p - uThreat.xy) * 9.0 - uTime * 9.0) * .5 + .5;
  float ringDistance = length(w.p - uThreat.xy) - 1.7;
  float menaceRing = smoothstep(.9, 1.0, pulse) * exp(-ringDistance * ringDistance * 1.9);
  foam += menaceRing * .34 * uThreat.z * (.29 + .71 * lace);
  if (uSurge >= 0.0) {
    float front = length(w.p - uHull.xy) - mix(17.8, .15, uSurge);
    float wall = exp(-front * front * .37);
    float lip = exp(-abs(front + .82) * 3.0);
    body += vec3(.03, .14, .16) * wall;
    foam += (.43 * wall + .51 * lip) * (.37 + lace * .53);
  }
  body = mix(body, mix(vec3(.92, .94, .74), vec3(.48, .66, .67), uStorm), clamp(foam, 0.0, .96));
  gl_FragColor = vec4(max(fogAndImpact(w, body), vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createPaintedWater(bounds: WaterBounds, shores: readonly Shore[], bed?: T.Group, locationSurface?: LocationSurface) {
  const water = createWater({
    bounds, shores, variant: 'C', apron: locationSurface ? 0 : 13, locationSurface,
    settings: { reflectionQuality: 'off', waveHeight: .78, waveScale: 1.13, wake: 1.21 },
  });
  const bedScene = new T.Scene();
  if (bed) bedScene.add(bed);
  const surfaceClip = new T.Plane(new T.Vector3(0, -1, 0), .04);
  const bedTarget = new T.WebGLRenderTarget(1, 1, {
    minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true, stencilBuffer: false,
  });
  const size = new T.Vector2();
  const clearColor = new T.Color();
  const uniforms = {
    tBottom: { value: bedTarget.texture }, uBottomOn: { value: 1 },
    uGlints: { value: .8 }, uCaustics: { value: .7 }, uSurge: { value: -1 },
    uStormInk: { value: new T.Color('#142b37') },
    uHull: { value: new T.Vector4(0, 0, 0, -1) },
    uThreat: { value: new T.Vector4() },
  };
  const material = new T.ShaderMaterial({
    name: 'PaintedWater', uniforms: { ...water.mesh.material.uniforms, ...uniforms },
    vertexShader: vertex, fragmentShader: fragment,
  });
  fitLocationSurface(material, locationSurface);
  water.mesh.material = material;

  function prepare(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.OrthographicCamera | T.PerspectiveCamera, settings: PaintedSurfaceSettings) {
    uniforms.uBottomOn.value = Number(settings.bottom);
    uniforms.uGlints.value = settings.glints;
    uniforms.uCaustics.value = settings.caustics;
    if (settings.bottom) {
      renderer.getDrawingBufferSize(size);
      const resolution = Math.min(.64, 1280 / Math.max(size.x, size.y));
      const width = Math.max(1, Math.round(size.x * resolution));
      const height = Math.max(1, Math.round(size.y * resolution));
      if (bedTarget.width !== width || bedTarget.height !== height) bedTarget.setSize(width, height);
      const previousTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const alpha = renderer.getClearAlpha();
      const auto = renderer.autoClear;
      const background = scene.background;
      const clipping = renderer.clippingPlanes;
      const visible = water.mesh.visible;
      try {
        if (!bed) {
          water.mesh.visible = false;
          scene.background = null;
          renderer.clippingPlanes = [...clipping, surfaceClip];
        }
        renderer.autoClear = false;
        renderer.setClearColor(0, 0);
        renderer.setRenderTarget(bedTarget);
        renderer.clear(true, true, false);
        renderer.render(bed ? bedScene : scene, camera);
      } finally {
        water.mesh.visible = visible;
        scene.background = background;
        renderer.clippingPlanes = clipping;
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, alpha);
        renderer.autoClear = auto;
      }
    }
    water.renderPasses(renderer, scene, camera);
  }

  return {
    water, prepare, surge: uniforms.uSurge, ink: uniforms.uStormInk.value, hull: uniforms.uHull.value, threat: uniforms.uThreat.value,
    dispose() { material.dispose(); bedTarget.dispose(); water.dispose(); },
  };
}
