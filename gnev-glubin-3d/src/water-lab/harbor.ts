import * as T from 'three';
import { loadWaterDemoArt, buildWaterDemoTerrain, makeFisher } from '../water-demo-scene';
import { poseBoat } from '../water/waves';
import { makeCoastAtlas, WakeField, type WaterPoint } from '../water/fields';
import { createWatercolorBed } from '../watercolor-bed';
import { addLabRuins } from './ruins';
import { createLabUniforms, waterHeight, worldRect } from './shared';
import { createLabMirror } from './mirror';

type CommonSettings = {
  waves: number; wind: number; wrath: number; light: number; feature: number; detail: number;
  deep: string; shallow: string;
};
type Actions = {pause:()=>boolean; reset:()=>void; cast:()=>void; angle:(degrees:number)=>void};
const harborBounds={minX:-38,minZ:-48,maxX:44,maxZ:27};
export type LabContext = {
  renderer:T.WebGLRenderer; scene:T.Scene; sea:T.Mesh; uniforms:ReturnType<typeof createLabUniforms>;
  showTerrace:(visible:boolean)=>void; bed:ReturnType<typeof createWatercolorBed>;
  sun:T.DirectionalLight; fill:T.DirectionalLight; ambient:T.HemisphereLight; sky:T.Color;
  bounds:typeof harborBounds; terrain:ReturnType<typeof buildWaterDemoTerrain>;
};
type LabFrame = { camera: T.OrthographicCamera; hull: WaterPoint & { heading: number } };
export interface LabRenderModes<M,S> {
  select:(mode:M, settings:S)=>T.Material|void;
  update:(time:number, settings:S, frame:LabFrame)=>void;
  render:(camera:T.OrthographicCamera)=>void;
  renderScene?:(camera:T.OrthographicCamera)=>void;
  heightOffset?:(x:number,z:number)=>number;
  heightAt?:(x:number,z:number)=>number;
  emitWake?:(stern:WaterPoint,velocity:WaterPoint)=>void;
  ripple?:(x:number,z:number,strength:number)=>void;
  clearTransient?:()=>void;
  renderScale?:()=>number;
  dispose:()=>void;
}
export async function startLab<M extends string,S extends CommonSettings>(
  setup:(ctx:LabContext)=>LabRenderModes<M,S>,
  makeLabUI:(change:(mode:M,value:S)=>void,actions:Actions)=>{setStatus:(s:string)=>void},
  {managedWater=false}={}
) {
  const canvas = document.querySelector<HTMLCanvasElement>('#sea')!;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const scene = new T.Scene();
  const sky = new T.Color('#aac4c1');
  scene.background = sky;
  const ambient = new T.HemisphereLight('#fff0cb', '#48706e', 1.65);
  const sun = new T.DirectionalLight('#ffe0a1', 2.25);
  const fill=new T.DirectionalLight('#b9dbe2',1.05);
  fill.position.set(7,9,12);
  scene.add(ambient,sun,fill);
  const camera = new T.OrthographicCamera(-16,16,8,-8,.15,155);
  const art = await loadWaterDemoArt();
  const terrain = buildWaterDemoTerrain(scene, art.dock);
  const {shores} = terrain;
  // Weather bands follow each rock face all the way down to its tide mark.
  const rockMaterials=new Set<T.MeshStandardMaterial>();
  scene.traverse(o=>{
    if(o instanceof T.Mesh && o.material instanceof T.MeshStandardMaterial && o.material.flatShading && o.material.vertexColors)
      rockMaterials.add(o.material);
  });
  for(const mat of rockMaterials) mat.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vRockPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvRockPoint=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader='varying vec3 vRockPoint;\n'+shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 p=vRockPoint;
      float beds=p.y*4.1+p.x*.43+sin(p.z*1.08+p.x*.23)*.67+sin(p.x*2.1+p.z*1.17)*.12;
      float bands=sin(beds)*.06+sin(beds*2.21+.5)*.036+sin(p.x*26.+sin(p.z*9.6)+p.y*8.)*.012;
      diffuseColor.rgb*=.88+bands+.11*smoothstep(.15,1.2,p.y);
      diffuseColor.rgb=mix(diffuseColor.rgb*vec3(.67,.84,.77),diffuseColor.rgb,smoothstep(.14,.67,p.y+bands));`);
  };
  const showTerrace=addLabRuins(scene);
  const boat = new T.Group();
  art.boat.rotation.y = Math.PI;
  art.rod.position.set(.44,.73,-.08);
  boat.add(art.boat,art.rod);
  makeFisher(boat);
  scene.add(boat);
  scene.traverse(o => o.layers.enable(1));
  const bed = createWatercolorBed(shores,harborBounds,{stableFoliage:true});
  scene.add(bed.group);
  const seam = managedWater ? new T.PlaneGeometry(1,1) : new T.PlaneGeometry(140,128,244,216);
  seam.rotateX(-Math.PI/2);
  const placeholder = new T.MeshBasicMaterial();
  const sea = new T.Mesh<T.BufferGeometry,T.Material>(seam,placeholder);
  sea.frustumCulled = false;
  if (!managedWater) scene.add(sea);
  const uniforms = createLabUniforms();
  const modes=setup({renderer,scene,sea,uniforms,showTerrace,bed,sky,sun,fill,ambient,bounds:harborBounds,terrain});
  const mirror = managedWater ? undefined : createLabMirror(renderer,scene,uniforms);
  const wake = managedWater ? undefined : new WakeField(worldRect);
  const coast = managedWater ? undefined : makeCoastAtlas(harborBounds,shores);
  uniforms.uWake.value=wake?.target.texture ?? null;
  uniforms.uShoreMap.value=coast ?? null;
  const bobber = new T.Group();
  bobber.add(art.bobber);
  bobber.scale.setScalar(1.35);
  const tip = art.rod.getObjectByName('line_tip') ?? art.rod;
  const floatTip = art.bobber.getObjectByName('line_attach') ?? art.bobber;
  const fishingPoints = new T.BufferAttribute(new Float32Array(9*3),3).setUsage(T.DynamicDrawUsage);
  const line = new T.Line(new T.BufferGeometry().setAttribute('position',fishingPoints),
    new T.LineBasicMaterial({color: '#e8dfbd',transparent:true,opacity:.8}));
  line.frustumCulled=false;
  scene.add(bobber,line);
  const keys = new Set<string>();
  const position = new T.Vector3(), velocity = new T.Vector3(), target = new T.Vector3();
  const offset = new T.Vector3(15,15,20), lookBias = new T.Vector3();
  const castOrigin = new T.Vector3(), castTo = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3();
  const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0,1,0),0), hit = new T.Vector3();
  let settings:S, heading=-.87, time=2.7, lastCast=-100;
  let paused=false, castActive=false, lastBite=-1, elevation=32, statusUntil=0, statusText='';
  let frameRequest=0, lastFrame=performance.now(), needsFrame=true, lastScale=1;
  const labFrame:LabFrame={camera,hull:{x:0,z:0,heading}};
  const stern={x:0,z:0};
  const heightAt=modes.heightAt ?? ((x:number,z:number)=>waterHeight(x,z,time,settings.waves,settings.wrath,settings.wind)
    +(modes.heightOffset?.(x,z)??0));

  function setLook(degrees:number) {
    needsFrame=true;
    elevation=degrees;
    offset.y=25*Math.tan(T.MathUtils.degToRad(elevation));
    uniforms.uEye.value.copy(offset).normalize();
  }
  function apply(next:M,value:S) {
    needsFrame=true;
    settings={...value};
    uniforms.uWaves.value=value.waves; uniforms.uWind.value=value.wind; uniforms.uWrath.value=value.wrath;
    uniforms.uLight.value=value.light; uniforms.uFeature.value=value.feature; uniforms.uDetail.value=value.detail;
    uniforms.uDeep.value.set(value.deep); uniforms.uShallow.value.set(value.shallow);
    sky.set('#c3d4ce').lerp(new T.Color('#596c77'),value.wrath*.85);
    sun.intensity=(1.6+value.light*.56)*(1-.44*value.wrath);
    sun.position.copy(uniforms.uSun.value).multiplyScalar(24);
    ambient.intensity=1.57-.47*value.wrath;
    const selected=modes.select(next,settings);
    if (selected) sea.material=selected;
    if (lastScale!==(modes.renderScale?.()??1)) resize();
  }
  function canSail(x:number,z:number,r:number) {
    if(x < -22 || x > 16 || z < -27 || z > 10) return false;
    if(x > -9-r && x < -3.32+r && z > -7-r && z < 5.55+r) return false;
    return shores.every(s=>{
      const dx=x-s.x, dz=z-s.z, c=Math.cos(s.angle??0), sn=Math.sin(s.angle??0);
      return ((dx*c+dz*sn)/(s.radiusX+r))**2+((dz*c-dx*sn)/(s.radiusZ+r))**2>1;
    });
  }
  function reset() {
    needsFrame=true;
    position.set(0,0,0);velocity.set(0,0,0);heading=-.87;keys.clear();wake?.clear();modes.clearTransient?.();
    castActive=false; lastBite=-1; uniforms.uCast.value.z=-100;
    target.copy(position).add(lookBias);
    statusText='Лодка у причала';statusUntil=time+2;
  }
  function cast(point?:T.Vector3) {
    if(paused) return;
    castOrigin.copy(position);
    if(point) {
      const length=Math.hypot(point.x-position.x,point.z-position.z);
      if(length<.9) return;
      castTo.copy(point).sub(position).setLength(Math.min(length,7)).add(position);
      if(!canSail(castTo.x,castTo.z,.1)) return;
    } else {
      const castHeading=[0,.65,-.65,1.5,-1.5,Math.PI].find(d=>
        canSail(position.x-Math.sin(heading+d)*4.9,position.z-Math.cos(heading+d)*4.9,.1));
      if(castHeading===undefined) return;
      castTo.set(position.x-Math.sin(heading+castHeading)*4.9,0,position.z-Math.cos(heading+castHeading)*4.9);
    }
    lastCast=time;castActive=true;lastBite=-1;
    uniforms.uCast.value.set(castTo.x,castTo.z,time+.62,1);
    statusText='Заброс';statusUntil=time+1.2;
  }
  const ui=makeLabUI(apply,{pause:()=>{
    needsFrame=true;
    paused=!paused;
    return paused;
  },reset,cast:()=>cast(),angle:setLook});
  setLook(elevation);
  function resize() {
    needsFrame=true;
    const w=canvas.clientWidth||innerWidth, h=canvas.clientHeight||innerHeight;
    const aspect=w/h, halfHeight=Math.max(9.1,7.5/aspect);
    camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;
    camera.top=halfHeight;camera.bottom=-halfHeight;camera.updateProjectionMatrix();
    lookBias.set(.10,0,-3.2);
    lastScale=modes.renderScale?.()??1;
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5,1720/w)*lastScale);
    renderer.setSize(w,h,false);
  }
  resize();reset();
  window.addEventListener('resize',resize);
  const steering=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'];
  window.addEventListener('keydown',e=>{
    if((e.target as HTMLElement).matches('input,select,textarea'))return;
    if(steering.includes(e.code)) {e.preventDefault();keys.add(e.code);}
    if(e.code==='Space'&&!(e.target as HTMLElement).closest('button')) {e.preventDefault();if(!e.repeat)cast();}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>keys.clear());
  canvas.addEventListener('pointerup',e=>{
    if(e.button!==0)return;
    (document.activeElement as HTMLElement|null)?.blur?.();
    const area=canvas.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2((e.clientX-area.left)/area.width*2-1,1-(e.clientY-area.top)/area.height*2),camera);
    if(ray.ray.intersectPlane(plane,hit))cast(hit);
  });

  function sail(dt:number) {
    const pressed=(a:string,b:string)=>Number(keys.has(a)||keys.has(b));
    const dx=pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft');
    const dz=pressed('KeyW','ArrowUp')-pressed('KeyS','ArrowDown');
    const factor=4.6/(Math.hypot(dx,dz)||1);
    velocity.x=T.MathUtils.damp(velocity.x,(dx*.8-dz*.6)*factor,4.2,dt);
    velocity.z=T.MathUtils.damp(velocity.z,(-dx*.6-dz*.8)*factor,4.2,dt);
    for(const k of ['x','z'] as const) {
      const x=position.x+(k==='x'?velocity.x*dt:0),z=position.z+(k==='z'?velocity.z*dt:0);
      if(canSail(x,z,.82))position[k]+=velocity[k]*dt;
      else velocity[k]=0;
    }
    if(velocity.lengthSq()>.11) {
      const delta=Math.atan2(-velocity.x,-velocity.z)-heading;
      heading+=Math.atan2(Math.sin(delta),Math.cos(delta))*(1-Math.exp(-dt*5.5));
      if(castActive && position.distanceTo(castTo)>8.2)castActive=false;
    }
    stern.x=position.x+Math.sin(heading)*1.32;
    stern.z=position.z+Math.cos(heading)*1.32;
    wake?.emit(time,stern,velocity);
  }
  function animateFloat() {
    bobber.visible=line.visible=castActive;
    if(!castActive)return;
    const age=time-lastCast;
    const f=Math.min(age/.62,1);
    const cycle=Math.floor((age-2.6)/4.3);
    const bite=age>=2.6?(age-2.6)%4.3:9;
    if (age>=.62 && lastBite===-1) {
      lastBite=-2;
      modes.ripple?.(castTo.x,castTo.z,1);
    }
    if(cycle>=0&&cycle!==lastBite) {
      lastBite=cycle;
      uniforms.uCast.value.set(castTo.x,castTo.z,time,1.55);
      modes.ripple?.(castTo.x,castTo.z,1.55);
      statusText='Поклёвка';statusUntil=time+1;
    }
    bobber.position.lerpVectors(castOrigin,castTo,f);
    bobber.position.y=heightAt(bobber.position.x,bobber.position.z)+Math.sin(f*Math.PI)*1.72
      +.42*(1-f)-(bite<.52?Math.sin(bite*Math.PI/.52)*.30:0);
    tip.getWorldPosition(a);floatTip.getWorldPosition(b);
    for(let i=0;i<fishingPoints.count;i++) {
      const t=i/(fishingPoints.count-1);
      fishingPoints.setXYZ(i,T.MathUtils.lerp(a.x,b.x,t),T.MathUtils.lerp(a.y,b.y,t)-Math.sin(Math.PI*t)*.14,T.MathUtils.lerp(a.z,b.z,t));
    }
    fishingPoints.needsUpdate=true;
  }
  let displayStatus='';
  function frame(now:number) {
    const dt=paused?0:Math.min((now-lastFrame)/1000,.085);
    lastFrame=now;
    if(paused && !needsFrame) {
      frameRequest=requestAnimationFrame(frame);
      return;
    }
    needsFrame=false;
    time+=dt;
    if(dt>0) sail(dt);
    uniforms.uTime.value=time;
    labFrame.hull.x=position.x; labFrame.hull.z=position.z; labFrame.hull.heading=heading;
    modes.update(time,settings,labFrame);
    if(dt>0) modes.emitWake?.(stern,velocity);
    uniforms.uHull.value.set(position.x,position.z,Math.sin(heading),Math.cos(heading));
    poseBoat(boat,heightAt,position.x,position.z,heading,{waterline:.13});
    animateFloat();
    if (!managedWater) bed.update(time,settings.wrath);
    a.copy(position).add(lookBias);target.lerp(a,1-Math.exp(-dt*5.2));
    camera.position.copy(target).add(offset);camera.lookAt(target);camera.updateMatrixWorld();
    uniforms.uWakeOn.value=Number(wake?.render(renderer,time)??false);
    renderer.setRenderTarget(null);
    mirror?.render(camera);
    modes.render(camera);
    if(modes.renderScene) modes.renderScene(camera);
    else renderer.render(scene,camera);
    const stage=settings.wrath>=1?'Финальная волна':settings.wrath>=.65?'Ярость':settings.wrath>=.32?'Знамение':'Штиль';
    const message=paused?'Стоп-кадр':(time<statusUntil?statusText:stage);
    if(message!==displayStatus){ui.setStatus(message);displayStatus=message;}
    frameRequest=requestAnimationFrame(frame);
  }
  frameRequest=requestAnimationFrame(frame);
  window.addEventListener('pagehide', e=>{
    if(e.persisted)return;
    cancelAnimationFrame(frameRequest);
    modes.dispose();bed.dispose();wake?.dispose();mirror?.dispose();
    coast?.dispose();placeholder.dispose();seam.dispose();renderer.dispose();
  },{once:true});
}

export function showLabError(error: unknown) {
  const p=document.createElement('p');p.className='lab-load-error';
  p.textContent='Не удалось открыть 3D-бухту. '+String(error instanceof Error ? error.message : error);
  document.body.append(p);console.error(error);
}
