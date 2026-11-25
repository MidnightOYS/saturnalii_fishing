import * as T from 'three';
import type { LocationSurface } from '../water/location-surface';
import { labVertex, labFragmentHeader, labWaveFunctions } from './shared';

// Only solid receivers enter the overhead depth atlas. Subpixel moving leaves
// must not switch a refracted ray between the canopy and the ground.
const receiverGLSL = `
uniform sampler2D uReceiverDepth;
uniform vec2 uAtlasCenter;
uniform float uAtlasSpan;
const float receiverCameraY = 25.0;
const float receiverNear = 0.1;
const float receiverFar = 75.0;
vec2 receiverUV(vec2 xz) {
  return vec2(.5) + (xz - uAtlasCenter) * vec2(1., -1.) / uAtlasSpan;
}
float receiverHeight(vec2 uv) {
  return receiverCameraY - mix(receiverNear, receiverFar, texture2D(uReceiverDepth, uv).r);
}
bool receiverHit(vec3 origin, vec3 direction, out vec3 hit) {
  // Bracket the first crossing, then bisect. All tests use the rendered depth,
  // including steps, columns, stones and submerged parts of moving objects.
  float previous = .0;
  float distance = .04;
  bool found = false;
  for (int i = 0; i < 15; i++) {
    vec3 point = origin + direction * distance;
    vec2 uv = receiverUV(point.xz);
    if (any(lessThan(uv, vec2(.001))) || any(greaterThan(uv, vec2(.999)))) break;
    float bottom = receiverHeight(uv);
    if (point.y <= bottom) { found = true; break; }
    previous = distance;
    distance += clamp((point.y - bottom) / max(-direction.y, .25) * .80, .18, 2.4);
    if (distance > 23.0) break;
  }
  if (!found) { hit = origin + direction * 23.0; return false; }
  for (int i = 0; i < 4; i++) {
    float mid = (previous + distance) * .5;
    vec3 point = origin + mid * direction;
    if (point.y > receiverHeight(receiverUV(point.xz))) previous = mid;
    else distance = mid;
  }
  hit = origin + direction * distance;
  return true;
}
`;

const concentrationFragment = `
varying vec2 vIncidentXZ;
varying vec2 vRefractedXZ;
varying float vReceiverValid;
void main() {
  if (vReceiverValid < .99) discard;
  vec2 ai = dFdx(vIncidentXZ), bi = dFdy(vIncidentXZ);
  vec2 ao = dFdx(vRefractedXZ), bo = dFdy(vRefractedXZ);
  float before = abs(ai.x * bi.y - ai.y * bi.x);
  float after = abs(ao.x * bo.y - ao.y * bo.x);
  // Additive light splats automatically sum energy from overlapping folds.
  float concentration = min(before / max(after, 0.000001), 5.0);
  gl_FragColor = vec4(vec3(.145 * concentration), 1.0);
}`;

const targetSize = 1024;
const atlasVertices = 232;
type Uniforms = Record<string, T.IUniform>;

const capillaryGLSL = `
vec3 waterOpticalNormal(vec2 p, vec3 normal) {
  float t = uTime * (.65 + .35 * uWind);
  float a = dot(p, vec2(2.12, 1.28)) + sin(p.y * .61 - t * .28) * .65 - t * 1.42;
  float b = dot(p, vec2(-1.20, 2.64)) + .72 * sin(p.x * .77 + t * .32) - t * 1.73;
  float c = dot(p, vec2(3.03, -.84)) + .62 * sin(a * .56) + t * 1.62;
  vec2 slope = vec2(.092, .056) * cos(a) + vec2(-.055, .120) * cos(b) + vec2(.070, -.019) * cos(c);
  return normalize(normal + vec3(slope.x, 0., slope.y) * (.48 + uWaves * .5) * (.8 + uWind * .22));
}
`;

const concentrationVertex = `
uniform float uTime,uWrath,uWaves,uWind;
uniform float uGameWater;
uniform vec3 uSun;
uniform sampler2D uShoreMap;
uniform vec4 uWorldRect;
varying vec2 vIncidentXZ;
varying vec2 vRefractedXZ;
varying float vReceiverValid;
${receiverGLSL}
${labWaveFunctions}
${capillaryGLSL}
void main() {
  vec2 xz = uAtlasCenter + position.xy * uAtlasSpan * vec2(1., -1.);
  if (uGameWater > .5) {
    vec2 uv = (xz - uWorldRect.xy) / uWorldRect.zw;
    vec3 coast = texture2D(uShoreMap, clamp(uv, 0., 1.)).rgb;
    if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.))) ||
        coast.b < .49 || coast.r > .88 || coast.g > .86) {
      vIncidentXZ = vRefractedXZ = xz;
      vReceiverValid = 0.;
      gl_Position = vec4(position.xy * 2., 0., 1.);
      return;
    }
  }
  vec3 sea = vec3(xz.x, labHeight(xz), xz.y);
  vec3 normal = waterOpticalNormal(xz, labNormal(xz));
  vec3 sunRay = refract(-normalize(uSun), normal, 1.0 / 1.333);
  vec3 hit;
  bool found = receiverHit(sea, sunRay, hit);
  vIncidentXZ = xz;
  vRefractedXZ = hit.xz;
  vReceiverValid = found ? 1. : 0.;
  gl_Position = vec4(receiverUV(hit.xz) * 2. - 1., 0., 1.);
}`;

const opticsFragment = `${labFragmentHeader}
${receiverGLSL}
${capillaryGLSL}
uniform sampler2D uSubmergedScene;
uniform sampler2D uCausticFlux;
uniform vec2 uColorRaySlope;
uniform float uLayerStyle, uLayerAmount;
uniform vec4 uEyeWindow;
uniform float uEyeClarity;

// Two slowly evolving crossed fields give shafts and suspended sediment a
// position in the water column, independently of the wave surface.
float flowCloud(vec2 p) {
  return .50+.25*sin(p.x+p.y*.46+sin(p.y*.71))+.25*sin(p.y*.9-p.x*.55);
}
float underwaterLight(vec3 p) {
  vec2 source = p.xz - p.y * uSun.xz / max(.30, uSun.y);
  return smoothstep(.52,.91,flowCloud(source * vec2(1.21,.53)+vec2(uTime*.055,-uTime*.025)));
}
float plankton(vec2 p, float density, vec2 offset) {
  vec2 st=p*density+offset;
  vec2 cell=floor(st);
  vec2 seed=fract(sin(vec2(dot(cell,vec2(27.31,83.71)),dot(cell,vec2(51.19,31.73))))*2547.531);
  vec2 d=fract(st)-(.24+.52*seed);
  float radius=.043+.038*seed.x;
  float aa=max(.012,max(fwidth(st.x),fwidth(st.y))*.65);
  float core=1.-smoothstep(max(.0,radius-aa),radius+aa,length(d));
  return smoothstep(.52,.82,seed.y)*(core+.14*exp(-dot(d,d)*53.));
}
void main() {
  vec3 eyeDir = normalize(uEye);
  vec3 n = waterOpticalNormal(vWorld.xz, normalize(vNormal));
  // Capillary slopes are important to direct-light glints. Keeping their
  // contribution small in transmission prevents a leaf several metres below
  // the surface from skating back and forth by many screen pixels.
  vec3 viewNormal = normalize(mix(normalize(vNormal),n,.14));
  vec3 transmitted = refract(-eyeDir, viewNormal, 1. / 1.333);
  vec3 ray = normalize(mix(-eyeDir, transmitted, clamp(uDetail, 0., 1.8)));
  vec3 hit;
  bool found = receiverHit(vWorld, ray, hit);
  vec2 uv = clamp(receiverUV(hit.xz), .001, .999);
  float path = found ? length(hit - vWorld) : 22.;
  float shelf = 1., causticMask = 1., eyeWindow = 0.;
  if (uGameWater > .5) {
    vec2 coastUV = (vWorld.xz - uWorldRect.xy) / uWorldRect.zw;
    vec2 coast = texture2D(uShoreMap, clamp(coastUV, 0., 1.)).rg;
    float shoreDistance = coast.r * 7. - 1.;
    shelf = (1. - smoothstep(.18, .77, coast.g)) * (1. - smoothstep(1.3, 4.5, shoreDistance));
    causticMask = shelf * (1. - smoothstep(.85, 2.55, -hit.y)) * (found ? 1. : 0.);
    if (uEyeClarity > .0 && uEyeWindow.z > .0) {
      float eyeDistance = length((hit.xz - uEyeWindow.xy) / uEyeWindow.zw);
      eyeWindow = (1. - smoothstep(.26, 1.20, eyeDistance)) * uEyeClarity;
    }
  }
  // Project the hit into the full scene captured along the mean refracted
  // direction; foliage between the surface and the floor keeps its silhouette.
  vec2 colorUV=clamp(receiverUV(hit.xz-hit.y*uColorRaySlope),.001,.999);
  vec4 receiverColor = texture2D(uSubmergedScene, colorUV, .25);
  vec3 bed = receiverColor.rgb;
  bool meadow = uLayerStyle > .5 && uLayerStyle < 1.5;
  bool wreck = uLayerStyle > 1.5 && uLayerStyle < 2.5;
  bool night = uLayerStyle > 2.5;
  // Unity flux is a flat surface. Compression brightens the receiver while
  // divergence removes energy. The map is evaluated at the same refracted hit.
  float flux = texture2D(uCausticFlux, uv).r / .145;
  float sunlight = exp(-path * (.12 + uWrath * .18));
  float focusing = clamp(flux - 1., -.70, 2.2) * uFeature * uLight * sunlight * causticMask * uSceneSun;
  if (meadow || wreck) focusing *= meadow ? .47 : .42;
  bed *= max(.49, .89 + focusing * .48);
  bed += uSunColor * vec3(.035, .095, .075) * max(0., focusing);
  // Preserve receiver texture contrast while accounting for the incident
  // light's trip down through the water before it returns along the view ray.
  vec3 downwardTint = vec3(.43, .77, .80);
  vec3 absorption = vec3(.65, .255, .205) * (1. + .86 * uWrath);
  if (uLayerStyle < .5) absorption *= exp2(.83*(uLayerAmount-1.));
  if (meadow) {
    downwardTint=vec3(.74,.90,.74);
    absorption*=vec3(.59,.64,.75);
  }
  if (wreck) {
    downwardTint=vec3(.94,.82,.65);
    absorption*=vec3(.37,.65,.76);
  }
  if (night) {
    downwardTint=vec3(.24,.45,.68);
    absorption*=vec3(.84,.86,.80);
  }
  if (uGameWater > .5) {
    absorption *= mix(1.66, .78, shelf);
    absorption *= 1. - (.63 + .15 * uWrath) * eyeWindow;
    downwardTint = mix(downwardTint, vec3(.72, .83, .76), eyeWindow * .67);
  }
  vec3 transmission = exp(-path * absorption);
  vec3 volume = mix(uDeep, uShallow, exp(-path * .39) * .57 * shelf);
  volume *= vec3(.65, .91, .95);
  if (!found) transmission = vec3(0.);
  vec3 body = bed * downwardTint * transmission + volume * (1. - transmission);
  float layer = clamp(uLayerAmount,0.,2.);
  vec3 midWater=vWorld+ray*min(path*.48,4.);
  if (meadow) {
    float beam = .33*underwaterLight(mix(vWorld,midWater,.5))
               + .43*underwaterLight(midWater)+.24*underwaterLight(mix(midWater,hit,.45));
    float opticalScatter=1.-exp(-min(path,12.)*.13);
    body+=vec3(.041,.054,.022)*beam*opticalScatter*layer*uLight;
  } else if (wreck) {
    vec2 current=hit.xz*vec2(.46,.84)+vec2(-uTime*.04,uTime*.018);
    float bank=smoothstep(.30,.83,flowCloud(current));
    float column=(1.-exp(-min(path,12.)*.22))*bank;
    vec3 silt=mix(vec3(.110,.084,.048),uShallow*vec3(.56,.57,.39),.48);
    body=mix(body,silt,clamp(column*layer*.38,0.,.45));
  } else if (night) {
    // The color atlas stores actual emitter coverage in inverse alpha. Bells
    // emit their own light at swimming depth, so it travels upwards only.
    float coverage = (1.-receiverColor.a) * (found ? 1. : 0.);
    vec3 emission = receiverColor.rgb * vec3(1.08,1.25,1.32)
      * exp(-min(path,1.65)*vec3(.18,.09,.074));
    body=mix(body,emission,coverage);
    float lengthXZ=distance(vWorld.xz,uHull.xy);
    vec2 wakeUV=clamp((vWorld.xz-uWorldRect.xy)/uWorldRect.zw,0.,1.);
    float wakeGlow=texture2D(uWake,wakeUV).r*uWakeOn;
    float age=max(0.,uTime-uCast.z);
    float pulse=(1.-smoothstep(0.,3.,age))*exp(-pow((distance(vWorld.xz,uCast.xy)-age*1.4)*1.4,2.))*uCast.w;
    float activeGlow=.05+.17*exp(-lengthXZ*.69)+1.3*wakeGlow+.9*pulse;
    vec2 drift=vec2(.023,-.036)*uTime;
    vec2 nearXZ=vWorld.xz+ray.xz*min(.60,path*.33);
    vec2 farXZ=midWater.xz;
    float sparks=plankton(nearXZ,2.7,drift)+.54*plankton(farXZ,1.7,-drift*.39+12.);
    body+=layer*(activeGlow*vec3(.018,.39,.42)*(sparks*4.5+.23)
      + vec3(.004,.013,.023)*underwaterLight(midWater));
  }
  float slopeLight = clamp(dot(n - vec3(0.,1.,0.), normalize(uSun)), -.30, .30);
  body *= .95 + .29 * slopeLight;
  vec3 reflected = reflect(-eyeDir, n);
  float ndv = clamp(dot(n, eyeDir), .0, 1.);
  float fresnel = .0204 + .9796 * pow(1. - ndv, 5.);
  vec3 sky = mix(vec3(.18, .38, .49), vec3(.06, .17, .245), smoothstep(.02, .88, reflected.y));
  if(uLayerStyle>2.5) sky=vec3(.028,.055,.11);
  if (uGameWater > .5) sky = sceneSkyRadiance(reflected) * (night ? .44 : 1.);
  vec3 color = mix(body, sky, fresnel * (.58 + .24 * uLight) * (1. - eyeWindow * .34));
  float glint = max(dot(reflected, normalize(uSun)), .0);
  vec2 p = vWorld.xz;
  float ripple = .5 + .5 * sin(dot(p,vec2(8.5,5.4)) - uTime*2.31 + .9*sin(p.y*2.1+uTime*.7));
  float sparkle = pow(glint, 650.) * smoothstep(.72, .96, ripple);
  vec3 glintColor=uLayerStyle>2.5?vec3(.39,.65,.89):uSunColor;
  float sunGate = meadow ? .34 : (wreck ? .37 : (night ? .55 : 1.));
  color += glintColor * uLight * uSceneSun * sunGate * (.34 * sparkle + .014 * pow(glint, 125.));
  gl_FragColor = vec4(labFinish(color), 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createRefraction(
  renderer: T.WebGLRenderer, scene: T.Scene, water: T.Mesh, uniforms: Uniforms, surface?: LocationSurface
) {
  const receivers = new T.WebGLRenderTarget(targetSize, targetSize, {
    depthBuffer: true, generateMipmaps: false, magFilter: T.LinearFilter, minFilter: T.LinearFilter
  });
  receivers.texture.name = 'Solid receiver pass';
  receivers.depthTexture = new T.DepthTexture(targetSize, targetSize, T.UnsignedIntType);
  // MSAA integrates edge coverage before mipmapping. This helps even when
  // a blade is narrower than one texel in the intermediate scene capture.
  const sceneColor = new T.WebGLRenderTarget(targetSize,targetSize,{
    depthBuffer: true, generateMipmaps: true, magFilter:T.LinearFilter,
    minFilter:T.LinearMipmapLinearFilter, samples:renderer.capabilities.isWebGL2 ? 4 : 0
  });
  sceneColor.texture.name='Filtered oblique underwater color';
  const depthMaterial = new T.MeshDepthMaterial({colorWrite:false,side:T.DoubleSide});
  const caustics = new T.WebGLRenderTarget(targetSize, targetSize, {
    depthBuffer: false, generateMipmaps: true, magFilter: T.LinearFilter, minFilter: T.LinearMipmapLinearFilter
  });
  caustics.texture.name = 'Refracted sunlight flux';
  const atlasCenter = new T.Vector2();
  const opticalUniforms = {
    ...uniforms, uReceiverDepth: { value: receivers.depthTexture }, uSubmergedScene: { value: sceneColor.texture },
    uCausticFlux: { value: caustics.texture }, uColorRaySlope: {value:new T.Vector2()},
    uEyeWindow: { value: surface?.eye ?? new T.Vector4() }, uEyeClarity: surface?.clarity ?? { value: 0 },
    uLayerStyle: uniforms.uLayerStyle ?? {value:0}, uLayerAmount: uniforms.uLayerAmount ?? {value:1},
    uAtlasCenter: { value: atlasCenter }, uAtlasSpan: { value: 50 }
  };
  const material = new T.ShaderMaterial({
    name: 'Water • refracted receiver geometry', vertexShader: labVertex, fragmentShader: opticsFragment,
    uniforms: opticalUniforms
  });
  const splatMaterial = new T.ShaderMaterial({
    name: 'Sunlight refracted to physical receivers', vertexShader: concentrationVertex,
    fragmentShader: concentrationFragment, uniforms: opticalUniforms, transparent: true,
    blending: T.AdditiveBlending, side: T.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false
  });
  splatMaterial.forceSinglePass = true;
  const photonGrid = new T.Mesh(new T.PlaneGeometry(1, 1, atlasVertices, atlasVertices), splatMaterial);
  photonGrid.frustumCulled = false;
  const fluxScene = new T.Scene();
  fluxScene.add(photonGrid);
  const atlasCamera = new T.OrthographicCamera(-25, 25, 25, -25, .1, 75);
  atlasCamera.up.set(0, 0, -1);
  const colorCamera = new T.OrthographicCamera();
  const throughWater = new T.Vector2();
  const hiddenFoliage: T.Object3D[] = [];
  const hiddenSurfaceEffects: T.Object3D[] = [];
  const emitterMaterials = new Map<T.MeshBasicMaterial,T.MeshBasicMaterial>();
  const activeEmitters = new Map<T.Mesh,T.MeshBasicMaterial>();
  const forward = new T.Vector3();
  const center = new T.Vector3();
  const restoreColor = new T.Color();
  const surfaceClip = new T.Plane(new T.Vector3(0, -1, 0), .04);

  function render(camera: T.OrthographicCamera) {
    camera.getWorldDirection(forward);
    camera.getWorldPosition(center);
    center.addScaledVector(forward, -center.y / Math.min(forward.y, -.05));
    const width = (camera.right - camera.left) / camera.zoom;
    const depth = (camera.top - camera.bottom) / (camera.zoom * Math.max(.20, -forward.y));
    // Tiny camera movements shouldn't scroll a subtexel footprint across the bed.
    const span = Math.ceil(Math.hypot(width, depth) + 14);
    const texelSize = span / targetSize;
    atlasCenter.set(Math.round(center.x / texelSize) * texelSize, Math.round(center.z / texelSize) * texelSize);
    opticalUniforms.uAtlasSpan.value = span;
    atlasCamera.left = atlasCamera.bottom = -span * .5;
    atlasCamera.right = atlasCamera.top = span * .5;
    atlasCamera.position.set(atlasCenter.x, 25, atlasCenter.y);
    atlasCamera.lookAt(atlasCenter.x, 0, atlasCenter.y);
    atlasCamera.updateProjectionMatrix();
    // A sheared orthographic projection keeps the XZ texel grid fixed in world
    // space. A point at height y samples the reference image at xz - y*slope.
    // In air mode (detail=0) this projection exactly matches the gameplay view.
    const detail=T.MathUtils.clamp(uniforms.uDetail.value,0,1.8);
    const eta=1/1.333;
    const refractedY=-Math.sqrt(Math.max(.001,1-eta*eta*(1-forward.y*forward.y)));
    const rayY=T.MathUtils.lerp(forward.y,refractedY,detail);
    throughWater.set(forward.x,forward.z).multiplyScalar(T.MathUtils.lerp(1,eta,detail)/rayY);
    opticalUniforms.uColorRaySlope.value.copy(throughWater);
    colorCamera.copy(atlasCamera);
    const e=colorCamera.projectionMatrix.elements;
    e[8]-=2/span*throughWater.x;
    e[9]+=2/span*throughWater.y;
    e[12]-=25*2/span*throughWater.x;
    e[13]+=25*2/span*throughWater.y;
    colorCamera.projectionMatrixInverse.copy(colorCamera.projectionMatrix).invert();
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), mipmap = renderer.getActiveMipmapLevel();
    const clipping = renderer.clippingPlanes;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(restoreColor);
    const autoClear = renderer.autoClear;
    const visible = water.visible;
    const override = scene.overrideMaterial;
    const background = scene.background;
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    try {
      water.visible = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = false;
      scene.background = null;
      renderer.clippingPlanes = [...clipping, surfaceClip];
      renderer.setClearColor(0x000000, 0);
      hiddenFoliage.length=0;
      hiddenSurfaceEffects.length = 0;
      scene.traverseVisible(o=>{
        if (o.userData.waterSurfaceEffect) {
          hiddenSurfaceEffects.push(o);
          o.visible = false;
          return;
        }
        if (opticalUniforms.uLayerStyle.value>2.5 && o.userData.emissiveLayer &&
            o instanceof T.Mesh && o.material instanceof T.MeshBasicMaterial) {
          const original=o.material;
          let capture=emitterMaterials.get(original);
          if (!capture) {
            capture=original.clone();
            capture.color=original.color;
            capture.onBeforeCompile=shader=>{
              shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
                '#include <opaque_fragment>\ngl_FragColor.a=0.;');
            };
            emitterMaterials.set(original,capture);
          }
          activeEmitters.set(o,original);
          o.material=capture;
        }
        if (o.userData.refractiveFoliage || o.name==='Seagrass banks') {
          hiddenFoliage.push(o);
          o.visible=false;
        }
      });
      scene.overrideMaterial=depthMaterial;
      renderer.setRenderTarget(receivers);
      renderer.clear();
      renderer.render(scene, atlasCamera);
      scene.overrideMaterial=override;
      for(const o of hiddenFoliage) o.visible=true;
      renderer.setRenderTarget(sceneColor);
      renderer.clear();
      renderer.render(scene,colorCamera);
      renderer.clippingPlanes = clipping;
      renderer.setRenderTarget(caustics);
      renderer.clear();
      if (uniforms.uFeature.value > .001 && uniforms.uLight.value > .001 && uniforms.uSceneSun.value > .001)
        renderer.render(fluxScene, atlasCamera);
    } finally {
      for(const [mesh,original] of activeEmitters) mesh.material=original;
      activeEmitters.clear();
      for(const o of hiddenFoliage) o.visible=true;
      for (const o of hiddenSurfaceEffects) o.visible = true;
      scene.overrideMaterial=override;
      renderer.setRenderTarget(previous, face, mipmap);
      renderer.setClearColor(restoreColor, clearAlpha);
      renderer.clippingPlanes = clipping;
      renderer.shadowMap.autoUpdate = shadowUpdate;
      scene.background = background;
      renderer.autoClear = autoClear;
      water.visible = visible;
    }
  }

  function dispose() {
    for(const mat of emitterMaterials.values()) mat.dispose();
    emitterMaterials.clear();
    depthMaterial.dispose();
    sceneColor.dispose();
    receivers.dispose();
    caustics.dispose();
    photonGrid.geometry.dispose();
    splatMaterial.dispose();
    material.dispose();
  }
  return { material, render, dispose };
}
