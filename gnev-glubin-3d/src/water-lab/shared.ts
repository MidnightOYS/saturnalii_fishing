import * as T from 'three';

export const worldRect = new T.Vector4(-38, -48, 82, 75);
export function createLabUniforms() {
  return {
    uTime: { value: 0 }, uWrath: { value: 0 }, uWaves: { value: 1 },
    uLight: { value: 1 }, uFeature: { value: 1 }, uDetail: { value: 1 }, uWind: { value: 1 },
    uDeep: { value: new T.Color('#075366') }, uShallow: { value: new T.Color('#72bfae') },
    uSun: { value: new T.Vector3(-.43, .64, -.78).normalize() },
    uEye: { value: new T.Vector3(15, 15, 20).normalize() }, uSunColor: { value: new T.Color('#ffe4ae') },
    uCast: { value: new T.Vector4(1000,1000,-100,0) }, uWake: { value: null as T.Texture | null },
    uWakeOn: { value: 0 }, uShoreMap: { value: null as T.Texture | null }, uHull: { value: new T.Vector4() }, uWorldRect: { value: worldRect },
    uLabMirror: { value: null as T.Texture | null }, uMirrorVP: { value: new T.Matrix4() },
  };
}

const bands = [
  {x:.39,z:.26,a:.28,f:1.00,p:1.2}, {x:-.32,z:.64,a:.15,f:1.43,p:.35},
  {x:.89,z:.72,a:.082,f:1.92,p:3.7}, {x:-1.38,z:.54,a:.038,f:2.40,p:2.1},
];
export function waterHeight(x:number,z:number,t:number,waves:number,wrath:number,wind:number) {
  let height = 0;
  for (const b of bands) {
    const phase = b.x*x + b.z*z - t*b.f*(.69+.31*wind) + b.p;
    height += b.a*(Math.sin(phase) - .11*Math.cos(2*phase));
  }
  return height*waves*(.44+1.19*wrath);
}
const terms = bands.map(b => `band(p,vec2(${b.x.toFixed(3)},${b.z.toFixed(3)}),${b.a.toFixed(3)},${b.f.toFixed(3)},${b.p.toFixed(3)})`).join(' + ');
export const labWaveFunctions = `
vec3 band(vec2 p,vec2 k,float a,float freq,float phase) {
  float v=dot(k,p)-uTime*freq*(.69+.31*uWind)+phase;
  return a*vec3(sin(v)-.11*cos(2.0*v),k*(cos(v)+.22*sin(2.0*v)));
}
vec3 labWaveSample(vec2 p){return (${terms})*uWaves*(.44+1.19*uWrath);}
float labHeight(vec2 p){return labWaveSample(p).x;}
vec3 labNormal(vec2 p){vec3 h=labWaveSample(p);return normalize(vec3(-h.y,1.,-h.z));}
`;
const declarations = `
uniform float uTime,uWrath,uWaves,uLight,uFeature,uDetail,uWind;
uniform vec3 uDeep,uShallow,uSun,uEye,uSunColor;
varying vec3 vWorld,vNormal;
`;
export const labVertex = declarations+labWaveFunctions+`
void main(){
  vWorld=(modelMatrix*vec4(position,1.)).xyz;
  vec3 h=labWaveSample(vWorld.xz);
  vWorld.y+=h.x;
  vNormal=normalize(vec3(-h.y,1.,-h.z));
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;
export const labFragmentHeader = declarations+labWaveFunctions+`
uniform sampler2D uWake,uLabMirror,uShoreMap;
uniform mat4 uMirrorVP;
uniform float uWakeOn;
uniform vec4 uCast,uWorldRect,uHull;
vec3 labFinish(vec3 col){
  vec3 n=normalize(vNormal);
  vec4 refl=uMirrorVP*vec4(vWorld.x+n.x*.68,0.,vWorld.z+n.z*.68,1.);
  vec2 ruv=refl.xy/refl.w*.5+.5;
  vec2 edge=min(ruv,1.-ruv);
  vec4 mirrored=texture2D(uLabMirror,clamp(ruv,.001,.999));
  float fres=pow(1.-clamp(dot(n,uEye),0.,1.),4.);
  col=mix(col,mirrored.rgb/max(mirrored.a,.01),(.16+.55*fres)*mirrored.a*smoothstep(0.,.03,min(edge.x,edge.y)));
  vec2 uv=(vWorld.xz-uWorldRect.xy)/uWorldRect.zw;
  float shore=texture2D(uShoreMap,clamp(uv,0.,1.)).r*7.-1.;
  float curl=.13*sin(vWorld.x*3.3+vWorld.z*2.4-uTime*1.3)+.1*sin(vWorld.z*6.1+uTime);
  float swash=1.-smoothstep(.035,.19+.15*uWrath,abs(shore-.13-.13*sin(uTime*1.2)+curl));
  float fleck=smoothstep(-.45,.74,sin(vWorld.z*20.+vWorld.x*8.3)+sin(vWorld.x*13.4+uTime));
  col=mix(col,vec3(.61,.75,.68),swash*(.15+.29*fleck));
  vec2 rel=vWorld.xz-uHull.xy;
  vec2 local=vec2(dot(rel,uHull.zw),dot(rel,vec2(-uHull.w,uHull.z)));
  float contact=exp(-dot(local/vec2(1.72,.65),local/vec2(1.72,.65)));
  col*=1.-.66*contact;
  float foam=texture2D(uWake,clamp(uv,0.,1.)).r*uWakeOn;
  float grain=.68+.32*sin(dot(vWorld.xz,vec2(18.4,11.6))+3.*sin(vWorld.z*5.-uTime));
  float age=uTime-uCast.z;
  float d=distance(vWorld.xz,uCast.xy);
  float ring=exp(-pow((d-age*1.55)*9.,2.))+.5*exp(-pow((d-age*1.55+.28)*11.,2.));
  if(age>=0.&&age<2.)col+=vec3(.36,.59,.52)*ring*(1.-smoothstep(.35,2.,age))*uCast.w;
  return mix(col,vec3(.78,.87,.82),min(.88,foam*grain));
}`;
