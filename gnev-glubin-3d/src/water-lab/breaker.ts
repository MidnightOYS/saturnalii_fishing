import * as T from 'three';
import { labVertex, labFragmentHeader, labWaveFunctions } from './shared';
import { fitLocationSurface, type LocationSurface } from '../water/location-surface';

type Uniforms = Record<string, T.IUniform>;

const columns = 75;
const rows = 48;
const tileColumns = 8;
const frameCount = 64;
const smooth = (a: number, b: number, x: number) => T.MathUtils.smoothstep(x, a, b);
const mix = T.MathUtils.lerp;

// Cubic sections in (forward, up). The path returns underneath its own lip.
// A vertical line through the breaking face intersects the surface three times.
const contour = [
  [.34, -4.6, -.20, -2.50, -.12, -.95, 1.99, -.12, 1.95],
  [.48, -.12, 1.95, .40, 2.02, .92, 1.84, 1.02, 1.45],
  [.57, 1.02, 1.45, 1.14, 1.10, 1.03, .77, .85, .64],
  [.67, .85, .64, .96, 1.29, .66, 1.57, .25, 1.56],
  [.80, .25, 1.56, -.12, 1.51, -.32, 1.17, -.27, .92],
  [1.0, -.27, .92, -.17, .32, 1.35, .06, 3.0, -.20],
];

function curledProfile(v: number) {
  let previousEnd = 0;
  for (const section of contour) {
    const [end, z0, y0, z1, y1, z2, y2, z3, y3] = section;
    if (v <= end) {
      const t = (v - previousEnd) / (end - previousEnd);
      const s = 1 - t;
      const cubic = (a: number, b: number, c: number, d: number) =>
        s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
      return [cubic(z0, z1, z2, z3), cubic(y0, y1, y2, y3)];
    }
    previousEnd = end;
  }
  return [3, -.2];
}

// One-time procedural VAT bake. Each frame occupies one tile. RGBA stores local
// lateral position, elevation, forward position and aeration respectively.
function bakeBreaker() {
  const width = columns * tileColumns;
  const height = rows * frameCount / tileColumns;
  const data = new Float32Array(width * height * 4);
  const profiles = Array.from({ length: rows }, (_, q) => curledProfile(q / (rows - 1)));
  for (let frame = 0; frame < frameCount; frame++) {
    const cycle = frame / frameCount;
    const tileX = frame % tileColumns * columns;
    const tileY = Math.floor(frame / tileColumns) * rows;
    for (let col = 0; col < columns; col++) {
      const x = col / (columns - 1) * 2 - 1;
      // The shoal is asymmetric. One end has already fallen by the time the opposite shoulder rises.
      const t = cycle - .29*x + .052*Math.sin(6*x+1) + .018*Math.sin(15*x);
      const taper = Math.pow(Math.max(0,1-x*x), 1.52);
      const grow = smooth(.07,.32,t);
      const fall = smooth(.48,.72,t);
      const fade = 1-smooth(.72,.95,t);
      const barrel = smooth(.19,.43,t)*(1-fall);
      const endFade = smooth(.015,.17,cycle)*(1-smooth(.81,.99,cycle));
      const along = .80+.16*Math.cos(4*x-.4)+.13*Math.cos(8.7*x+1.6);
      const crestShape = taper*grow*fade*endFade*along;
      const bow = -.88*x*x + .64*Math.sin(x*3.2+.40) + .19*Math.sin(8*x+.7);
      const scallop = .11*Math.cos(15*x-.3)+.054*Math.sin(27*x+2);
      for (let row=0;row<rows;row++) {
        const q=row/(rows-1);
        const [rolledZ,rolledY]=profiles[row];
        const straight=mix(-4.6,3,q);
        const swell=Math.pow(Math.max(0,Math.sin(Math.PI*q)),2.9);
        const zeta=(q-.49-scallop*.20)/.074;
        const crest=Math.exp(-zeta*zeta);
        const high=mix(swell*mix(1.17,.20,fall),rolledY,barrel)-.32*fall*crest;
        const forward=mix(straight,rolledZ,barrel)+fall*.98*swell+(cycle-.48)*4.8+bow+
          (scallop+.22*Math.sin(x*4-.7))*barrel*Math.sin(q*Math.PI);
        const fluting=(.09*Math.sin(x*17+q*9)+.075*Math.cos(x*28-3*t))*crest*barrel;
        const aeration=smooth(.29,.51,t)*(1-smooth(.64,.87,t))*
          (crest*(.59+.20*Math.sin(11*x+3*t)+.14*Math.sin(25*x)) + fall*.13*swell);
        const i = 4 * ((tileY + row) * width + tileX + col);
        data[i] = x;
        data[i + 1] = crestShape * (high + fluting) - .09;
        data[i + 2] = forward;
        data[i + 3] = Math.min(1, aeration * taper * grow);
      }
    }
  }
  const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.FloatType);
  texture.needsUpdate = true;
  texture.minFilter = texture.magFilter = T.NearestFilter;
  texture.generateMipmaps = false;
  // The boat and float query the same baked coordinates, including frame interpolation.
  function heightAt(lateral: number, forward: number, cycle: number) {
    if (Math.abs(lateral) >= 1 || Math.abs(forward) > 8) return 0;
    const x = (lateral * .5 + .5) * (columns - 1);
    const col = Math.floor(x), tx = x - col;
    const f = cycle * frameCount, frame = Math.floor(f), tf = f - frame;
    function frameStart(i: number) {
      return 4 * ((Math.floor(i / tileColumns) * rows) * width + (i % tileColumns) * columns + col);
    }
    const a = frameStart(frame), b = frameStart((frame + 1) % frameCount);
    function sample(row: number, channel: number) {
      const k = row * width * 4 + channel;
      return mix(mix(data[a+k], data[a+k+4], tx), mix(data[b+k], data[b+k+4], tx), tf);
    }
    let previousZ = sample(0, 2), previousY = sample(0, 1), highest = 0;
    for (let row = 1; row < rows; row++) {
      const z = sample(row, 2), y = sample(row, 1);
      if (forward >= Math.min(z, previousZ) && forward <= Math.max(z, previousZ) && Math.abs(z-previousZ) > 1e-6) {
        highest = Math.max(highest, mix(previousY, y, (forward-previousZ)/(z-previousZ)));
      }
      previousZ = z;
      previousY = y;
    }
    return highest;
  }
  return { texture, heightAt };
}

const seaPattern = /* glsl */`
  float surfHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
  float surfNoise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(surfHash(i),surfHash(i+vec2(1,0)),f.x),
               mix(surfHash(i+vec2(0,1)),surfHash(i+vec2(1,1)),f.x),f.y);
  }
  float surfGrain(vec2 p) {
    return surfNoise(p)*.53 + surfNoise(p*2.1+3.9)*.30 + surfNoise(p*4.47-2.)*.17;
  }
`;

const colorOutput = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

const surfLight = /* glsl */`
  vec3 seaBody(vec2 p, vec3 normal) {
    float t=uTime*(.65+.35*uWind);
    float small=clamp(1.-4.*length(fwidth(p)),0.,1.);
    vec2 ripple=vec2(sin(p.x*4.5+p.y*2.9+t*2.2)+.51*sin(p.y*8.7-t*2.8),
                     cos(p.y*4.2-.7*p.x-t*1.8)+.40*cos(p.x*7.8+t*3.2));
    vec3 n=normalize(normal+vec3(ripple.x,0.,ripple.y)*(.021+.023*uWrath)*small);
    float noise=surfGrain(p*.29+vec2(.029*t,-.018*t));
    float shelf=.035+.088*smoothstep(-15.,4.,p.y+sin(p.x*.16)*2.7);
    float face=clamp(dot(n,normalize(vec3(-.48,.34,-.68))),0.,1.);
    vec3 body=mix(uDeep*vec3(.72,.88,.91),uShallow,shelf+.045*noise)*(.71+.35*face+.13*noise);
    float grazing=pow(1.-max(dot(n,normalize(uEye)),0.),5.);
    body+=vec3(.025,.064,.075)*grazing;
    float spec=max(0.,dot(reflect(-normalize(uEye),n),normalize(uSun)));
    float glitterPatch=surfGrain(p*vec2(.71,.38)+t*.043+noise*.65);
    float streak=surfNoise(p*vec2(5.4,2.1)+ripple*.18+vec2(t*.23,-t*.19));
    float fleck=smoothstep(.60,.81,glitterPatch)*smoothstep(.48,.84,streak);
    return body+uSunColor*uLight*(.015*pow(spec,62.)+.27*pow(spec,186.)*fleck);
  }
`;

const seaFragment = labFragmentHeader + seaPattern + surfLight + /* glsl */`
  uniform vec4 uSites[2];
  uniform vec2 uClips;
  // After the lip lands, leave broken white water moving out beyond its foot.
  float spilledFoam(vec2 p, vec4 site, float cycle) {
    vec2 rel=p-site.xy;
    float c=cos(site.w), s=sin(site.w);
    float lateral=(rel.x*c-rel.y*s)/site.z;
    float phase=cycle-.29*lateral+.052*sin(6.*lateral+1.)+.018*sin(15.*lateral);
    float envelope=smoothstep(.50,.67,phase)*(1.-smoothstep(.85,1.01,phase));
    float along=rel.x*s+rel.y*c;
    float edge=(cycle-.48)*4.8-.88*lateral*lateral+.64*sin(lateral*3.2+.40)+.19*sin(8.*lateral+.7)+(phase-.51)*3.6+.37;
    float span=1.-smoothstep(.65,1.03,abs(lateral));
    float delta=along-edge;
    float turbulence=surfGrain(p*2.3+vec2(-uTime*.25,uTime*.19));
    float wash=exp(-delta*delta*2.)*smoothstep(.32,.75,turbulence);
    float ring=1.-smoothstep(.035,.235,abs(delta+.34*(turbulence-.5)));
    return envelope*span*(wash*.28+ring*.16)*smoothstep(.34,.65,turbulence);
  }
  void main() {
    vec2 p=vWorld.xz;
    float t=uTime*(.65+.35*uWind);
    vec3 body=seaBody(p,normalize(vNormal));
    float caps=smoothstep(.36,.91,vWorld.y)*smoothstep(.63,.84,surfGrain(p*2.+t*.045));
    float white=spilledFoam(p,uSites[0],uClips.x)+spilledFoam(p,uSites[1],uClips.y);
    float froth=clamp((white*min(1.,uFeature)+caps*.19*uWrath)*uDetail,0.,.53);
    body=mix(body,vec3(.71,.88,.86),froth);
    gl_FragColor=vec4(labFinish(body),1.);
    ${colorOutput}
  }
`;

const vatRead = /* glsl */`
  uniform sampler2D uPositions;
  uniform float uClip,uSpan,uFeature,uWrath,uWaves,uWind,uTime;
  ${labWaveFunctions}
  vec4 readVat(vec2 grid, float frame) {
    vec2 tile=vec2(mod(frame,${tileColumns}.),floor(frame/${tileColumns}.));
    vec2 cell=vec2(${columns}.,${rows}.);
    return texture2D(uPositions,(tile*cell+grid+.5)/(cell*${tileColumns}.));
  }
  vec4 shape(vec2 grid) {
    grid=clamp(grid,vec2(0.),vec2(${columns-1}.,${rows-1}.));
    float f=fract(uClip)*${frameCount}.;
    return mix(readVat(grid,floor(f)),readVat(grid,mod(floor(f)+1.,${frameCount}.)),fract(f));
  }
  float heightGain() {return max(.06,uFeature)*(.76+.33*uWrath+.14*uWaves);}
  vec3 placed(vec4 baked) {
    vec3 world=(modelMatrix*vec4(baked.x*uSpan,baked.y*heightGain(),baked.z,1.)).xyz;
    world.y+=labHeight(world.xz);
    return world;
  }
`;

const faceVertex = vatRead + /* glsl */`
  varying vec3 vWorld,vNormal;
  varying vec4 vBreak;
  void main() {
    vec2 g=floor(uv*vec2(${columns-1}.,${rows-1}.)+.5);
    vec4 baked=shape(g);
    vWorld=placed(baked);
    vec3 dx=placed(shape(g+vec2(1,0)))-placed(shape(g-vec2(1,0)));
    vec3 dq=placed(shape(g+vec2(0,1)))-placed(shape(g-vec2(0,1)));
    vNormal=normalize(mix(labNormal(vWorld.xz),normalize(cross(dq,dx)),smoothstep(.03,.41,baked.y*heightGain())));
    vBreak=vec4(uv,baked.a,baked.y*heightGain());
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
  }
`;

const faceFragment = labFragmentHeader + seaPattern + surfLight + /* glsl */`
  varying vec4 vBreak;
  void main() {
    if(vBreak.w<.004) discard;
    vec3 n=normalize(vNormal);
    vec3 eye=normalize(uEye);
    float elevation=smoothstep(.08,1.30,vBreak.w);
    vec3 base=seaBody(vWorld.xz,labNormal(vWorld.xz));
    vec3 tilted=seaBody(vWorld.xz,n);
    float cavity=smoothstep(.58,.70,vBreak.y)*(1.-smoothstep(.83,.94,vBreak.y));
    float shoulder=dot(n,normalize(uSun))*.5+.5;
    float crown=(vBreak.y-.43)/.18;
    float film=exp(-crown*crown)*elevation*(.40+.60*shoulder);
    vec3 shell=tilted*(1.-.68*cavity*elevation);
    shell+=vec3(.001,.085,.055)*film*uLight;
    vec2 flowUv=vec2(vBreak.x*20.,vBreak.y*7.);
    float fracture=surfGrain(flowUv*2.05+vec2(uTime*.21,-uTime*.26));
    float threads=surfNoise(flowUv*vec2(4.7,1.25)+fracture*1.1);
    float filmFoam=smoothstep(.10,.44,vBreak.z)*smoothstep(.51,.71,fracture*.73+threads*.27);
    shell=mix(shell,vec3(.44,.65,.60),clamp(filmFoam*uDetail*.81,0.,.73));
    vec3 color=mix(base,shell,smoothstep(.015,.37,vBreak.w));
    gl_FragColor=vec4(labFinish(color),1.);
    ${colorOutput}
  }
`;

function makeGeometry() {
  const geometry = new T.PlaneGeometry(1, 1, columns - 1, rows - 1);
  // All final positions are provided by vertex textures; the source plane bounds do not apply.
  return geometry;
}

function makeSprayGeometry() {
  const count = 235;
  let state = 4171;
  const random = () => { state = (Math.imul(1664525,state)+1013904223)>>>0; return state / 4294967296; };
  const seeds=new Float32Array(count*4);
  for(let i=0;i<count;i++) seeds.set([random(),random(),random(),random()],i*4);
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(count*3),3));
  geo.setAttribute('aSeed',new T.Float32BufferAttribute(seeds,4));
  return geo;
}

const sprayVertex = vatRead + /* glsl */`
  attribute vec4 aSeed;
  uniform float uDetail;
  varying float vOpacity;
  varying vec3 vWorld;
  void main(){
    vec2 grid=vec2(floor(aSeed.x*${columns-1}.),floor((.43+.13*aSeed.y)*${rows-1}.));
    vec4 base=shape(grid);
    float age=fract(uClip*11.+aSeed.w);
    float spread=.5+.84*aSeed.z;
    vec3 p=placed(base);
    float gain=heightGain();
    vec3 drift=(mat3(modelMatrix)*vec3(.10*(aSeed.y-.5),0.,1.))*age*spread;
    p+=drift*min(gain,2.);
    p.y+=sin(age*3.14159265)*(.14+.39*aSeed.z)*gain;
    vWorld=p;
    vOpacity=base.a*smoothstep(.1,.29,base.y)*sin(age*3.14159265)*(.68+.25*aSeed.w)*uDetail;
    gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
    gl_PointSize=clamp((1.+aSeed.z*1.9)*max(.5,uDetail),1.,4.3);
  }
`;

const sprayFragment=/* glsl */`
  varying float vOpacity;
  varying vec3 vWorld;
  void main(){
    float disc=1.-smoothstep(.10,.5,length(gl_PointCoord-.5));
    float opacity=disc*vOpacity;
    if(opacity<.05)discard;
    gl_FragColor=vec4(.77,.88,.85,min(.79,opacity));
    ${colorOutput}
  }
`;

export type BreakerSite = { x: number; z: number; span: number; angle: number };

export function createBreakers(uniforms: Uniforms, placement?: readonly [BreakerSite, BreakerSite], surface?: LocationSurface) {
  const vat=bakeBreaker();
  const surfaceGeometry=makeGeometry();
  const sprayGeometry=makeSprayGeometry();
  const group=new T.Group();
  group.name='VAT · plunging reef breakers';
  const sites=placement?.map(site=>new T.Vector4(site.x,site.z,site.span,site.angle)) ?? [
    new T.Vector4(1.3,-5.9,5.15,.60),
    new T.Vector4(-7.8,-11.8,3.80,.81),
  ];
  const localUniforms={...uniforms,uSites:{value:sites},uClips:{value:new T.Vector2(.47,.11)}};
  const material=new T.ShaderMaterial({name:'Surf · aerated coastal water',uniforms:localUniforms,vertexShader:labVertex,fragmentShader:seaFragment});
  const pieces=sites.map(site=>{
    const clip={value:0};
    const local={...uniforms,uClip:clip,uPositions:{value:vat.texture},uSpan:{value:site.z}};
    const face=new T.ShaderMaterial({name:'Surf · vertex animation texture',uniforms:local,vertexShader:faceVertex,
      fragmentShader:faceFragment,side:T.DoubleSide});
    const spray=new T.ShaderMaterial({name:'Surf · lip spray',uniforms:local,vertexShader:sprayVertex,fragmentShader:sprayFragment,
      transparent:true,depthWrite:false});
    fitLocationSurface(face, surface);
    fitLocationSurface(spray, surface);
    const body=new T.Mesh(surfaceGeometry,face);
    const mist=new T.Points(sprayGeometry,spray);
    body.frustumCulled=false;
    mist.frustumCulled=false;
    const siteGroup=new T.Group();
    siteGroup.position.set(site.x,0,site.y);
    siteGroup.rotation.y=site.w;
    siteGroup.add(body,mist);
    group.add(siteGroup);
    return {clip,face,spray,mist,siteGroup};
  });
  let lastTime: number | undefined;
  let elapsed=0;
  function update(time:number) {
    if(lastTime!==undefined) elapsed+=Math.max(0,time-lastTime)*(.69+.31*uniforms.uWind.value);
    lastTime=time;
    const a=(.47+elapsed/7.6)%1, b=(.11+elapsed/8.9)%1;
    localUniforms.uClips.value.set(a,b);
    pieces[0].clip.value=a;
    pieces[1].clip.value=b;
    for (const piece of pieces) {
      piece.siteGroup.visible=uniforms.uFeature.value>.015;
      piece.mist.visible=uniforms.uDetail.value>.02;
    }
  }
  function displacementAt(x: number,z: number) {
    const strength=uniforms.uFeature.value;
    if (strength<.015) return 0;
    let highest=0;
    for (let i=0;i<sites.length;i++) {
      const site=sites[i], dx=x-site.x, dz=z-site.y, c=Math.cos(site.w), s=Math.sin(site.w);
      const strengthAtPoint=vat.heightAt((dx*c-dz*s)/site.z,dx*s+dz*c,pieces[i].clip.value);
      highest=Math.max(highest,strengthAtPoint);
    }
    return highest*Math.max(.06,strength)*(.76+.33*uniforms.uWrath.value+.14*uniforms.uWaves.value);
  }
  return {group,material,update,displacementAt,dispose(){
    group.removeFromParent();
    vat.texture.dispose();
    surfaceGeometry.dispose();
    sprayGeometry.dispose();
    material.dispose();
    for(const p of pieces){p.face.dispose();p.spray.dispose();}
  }};
}
