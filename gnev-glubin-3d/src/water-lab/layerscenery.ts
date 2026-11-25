import * as T from 'three';
import type {createWatercolorBed} from '../watercolor-bed';

type LayerMode = 'refraction' | 'meadow' | 'wreck' | 'night';
type Point = [number, number, number];
const tau = Math.PI * 2;

function rng(seed:number) {
  return () => { seed = (Math.imul(1664525,seed)+1013904223)>>>0; return seed / 4294967296; };
}

function coloredGeometry(p:number[], c:number[], indices:number[]) {
  const g = new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));
  g.setAttribute('color',new T.Float32BufferAttribute(c,3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function mesh(parent:T.Object3D,g:T.BufferGeometry,m:T.Material, colorOnly=false) {
  const obj = new T.Mesh(g,m);
  obj.userData.refractiveFoliage=colorOnly;
  parent.add(obj);
  return obj;
}

type HeightAt = (x:number,z:number)=>number;
type SandMesh = T.Mesh<T.PlaneGeometry,T.ShaderMaterial>;

// Each variant inherits the *entire* bathymetry, shader and vertex colours of the
// original seabed. Only the protected sand bank beneath the new site is lifted.
// Outside the feathered bank, geometry and illumination are identical, with a
// global vertex-colour tint to grade the entire seabed by moonlight.
function shoal(parent:T.Group, source:SandMesh, light:string, dark:string, night=false):HeightAt {
  const geom=source.geometry.clone(), mat=source.material.clone();
  const pos=geom.getAttribute('position'), colors=geom.getAttribute('color');
  const a=new T.Color(light), b=new T.Color(dark), tint=new T.Color(), original=new T.Color();
  const moonTint=new T.Color('#506179');
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=pos.getZ(i),base=pos.getY(i);
    const u=(x-3.7)/13.3,v=(z-3.2)/11.9;
    const blend=1.-T.MathUtils.smoothstep(Math.hypot(u,v),.32,1.);
    const dune=.11*Math.sin(x*.53+z*.40)+.068*Math.sin(z*.47-x*.17);
    pos.setY(i,T.MathUtils.lerp(base,Math.max(base,-1.60+dune),blend));
    original.fromBufferAttribute(colors,i);
    if(night) original.multiply(moonTint);
    const rib=.5+.5*Math.sin(.93*x+z*2.34+.64*Math.sin(x*.82+.42*z));
    const bank=.5+.5*Math.sin(.42*x-.27*z+.63*Math.sin(z*.99));
    tint.copy(a).lerp(b,.19+.34*bank+.20*(1-rib));
    original.lerp(tint,blend*.88).toArray(colors.array as Float32Array,i*3);
  }
  geom.computeBoundingSphere();
  mesh(parent,geom,mat).name='Continuous submerged sand bank';
  const nx=geom.parameters.widthSegments+1,nz=geom.parameters.heightSegments+1;
  const ox=pos.getX(0),oz=pos.getZ(0),dx=pos.getX(1)-ox,dz=pos.getZ(nx)-oz;
  return (x,z)=>{
    const u=T.MathUtils.clamp((x-ox)/dx,0,nx-1.001),v=T.MathUtils.clamp((z-oz)/dz,0,nz-1.001);
    const ix=Math.floor(u),iz=Math.floor(v),ux=u-ix,vz=v-iz;
    const j=iz*nx+ix;
    return T.MathUtils.lerp(T.MathUtils.lerp(pos.getY(j),pos.getY(j+1),ux),
      T.MathUtils.lerp(pos.getY(j+nx),pos.getY(j+nx+1),ux),vz);
  };
}

function starGeometry() {
  const p:number[]=[0,.11,0], c:number[]=[], indices:number[]=[];
  const tint=new T.Color('#e88c5f');
  tint.toArray(c,0);
  for(let k=0;k<10;k++) {
    const a=k*tau/10, r=k%2===0 ? 1:.31;
    p.push(Math.cos(a)*r,.035+Number(k%2===1)*.013,Math.sin(a)*r);
    tint.set(k%2===0?'#b8794d':'#c68756').toArray(c,c.length);indices.push(0,1+((k+1)%10),1+k);
  }
  return coloredGeometry(p,c,indices);
}

function meadowScene(group:T.Group, source:SandMesh, clock:T.IUniform<number>, storm:T.IUniform<number>) {
  const shoalHeight=shoal(group,source,'#e3cc91','#b7aa84');
  const random=rng(905);
  const p:number[]=[], cols:number[]=[], idx:number[]=[], bend:number[]=[], centers:number[]=[];
  const tint=new T.Color(), end=new T.Color();
  // Two broken meadows flank an S-shaped channel of sand.
  for(let tuft=0;tuft<142;tuft++) {
    const z=-6.8+random()*19.0, side=tuft%2?1:-1;
    const channel=3.9+2.1*Math.sin(z*.34+.24);
    const x=channel+side*(1.52+random()**1.32*4.9)+Math.sin(z*.83)*.42;
    const y=shoalHeight(x,z);
    if(y < -2.75)continue;
    const scale=.87+random()*.50;
    for(let l=0;l<6;l++) {
      const a=random()*tau, dx=Math.cos(a), dz=Math.sin(a);
      const len=(.81+random()*.70)*scale;
      const width=(.143+random()*.103)*scale;
      const lean=.69+random()*.61, twist=(random()-.5)*1.25;
      const baseX=x+.11*dx, baseZ=z+.11*dz;
      const phase=random()*4;
      const start=p.length/3;
      tint.set(['#254e39','#527e31','#34765c','#7d8f3e','#435e32'][Math.floor(random()*5)]);
      end.set(['#a4b953','#dddd70','#84bf6e'][Math.floor(random()*3)]);
      const col=new T.Color();
      for(let j=0;j<=6;j++) {
        const t=j/6, forward=lean*len*t**1.76;
        const cx=baseX+dx*forward+.12*t*t,cz=baseZ+dz*forward+.15*Math.sin(t*2.4+phase)*t;
        const cy=y+len*(.75*t-.32*t**2)-.04;
        const bladeWidth=width*(.28+.93*Math.sin(Math.PI*t*.98)**.65)*(1-.78*t**3);
        const sideA=a+twist*t;
        for(let k=-1;k<=1;k++) {
          p.push(cx-Math.sin(sideA)*bladeWidth*k,cy+(k===0?.038*t:0),cz+Math.cos(sideA)*bladeWidth*k);
          col.copy(tint).lerp(end,.12+.49*t).multiplyScalar(k===0?1.13:k===1?.86:1);
          col.toArray(cols,cols.length);bend.push(t*t);centers.push(x,z);
        }
        if(j>0)for(let k=0;k<2;k++) {
          const i=start+j*3+k;idx.push(i-3,i,i+1,i-3,i+1,i-2);
        }
      }
    }
  }
  const leaves=coloredGeometry(p,cols,idx);
  leaves.setAttribute('leafWeight',new T.Float32BufferAttribute(bend,1));
  leaves.setAttribute('leafAnchor',new T.Float32BufferAttribute(centers,2));
  const material=new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide});
  material.onBeforeCompile=s=>{
    s.uniforms.leafTime=clock;s.uniforms.leafStorm=storm;
    s.vertexShader='uniform float leafTime,leafStorm; attribute float leafWeight; attribute vec2 leafAnchor;\n'+s.vertexShader
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        float current=sin(leafTime*.34+dot(leafAnchor,vec2(.19,.12)));
        transformed.xz+=leafWeight*(.64+.21*leafStorm)*vec2(.14,.08)*current;`);
  };
  mesh(group,leaves,material,true).name='Posidonia · coherent rooted ribbons';
  const stars=new T.InstancedMesh(starGeometry(),new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide}),9);
  const obj=new T.Object3D();
  for(let i=0;i<9;i++) {
    const z=-4+i*1.63+random()*.55, x=3.9+2.1*Math.sin(z*.34+.24)+(random()-.5)*2.8;
    obj.position.set(x,shoalHeight(x,z)+.045,z);obj.scale.setScalar(.31+random()*.31);
    obj.rotation.y=random()*tau;obj.updateMatrix();stars.setMatrixAt(i,obj.matrix);
  }
  group.add(stars);
}

// Merge rigid, opaque parts into a single draw while preserving individual wood,
// terracotta and painted collar colours.
function sculpture(parent:T.Group) {
  const p:number[]=[],n:number[]=[],c:number[]=[];
  const v=new T.Vector3(),normal=new T.Vector3(),tint=new T.Color(),normalMat=new T.Matrix3();
  const obj=new T.Object3D();
  function place(g:T.BufferGeometry, pos:Point, scale:Point, rotation:Point,color:string) {
    obj.position.set(...pos);obj.rotation.set(...rotation,'YXZ');obj.scale.set(...scale);obj.updateMatrix();
    normalMat.getNormalMatrix(obj.matrix);tint.set(color);
    const vertices=g.attributes.position, normals=g.attributes.normal;
    for(let j=0;j<(g.index?.count??vertices.count);j++) {
      const k=g.index?.getX(j)??j;
      v.fromBufferAttribute(vertices,k).applyMatrix4(obj.matrix).toArray(p,p.length);
      normal.fromBufferAttribute(normals,k).applyMatrix3(normalMat).normalize().toArray(n,n.length);tint.toArray(c,c.length);
    }
  }
  return {place,finish(){
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));
    geo.setAttribute('normal',new T.Float32BufferAttribute(n,3));geo.setAttribute('color',new T.Float32BufferAttribute(c,3));
    mesh(parent,geo,new T.MeshStandardMaterial({vertexColors:true,roughness:.94,side:T.DoubleSide}));
  }};
}

function wreckScene(group:T.Group,source:SandMesh) {
  shoal(group,source,'#bcb194','#98937f');
  const hull=new T.Group();hull.position.set(3.4,-1.65,4.35);hull.rotation.y=2.12;group.add(hull);
  const sculpt=sculpture(hull), random=rng(774);
  const cuboid=new T.BoxGeometry(), ribs:string[]=['#a27a49','#4c3b33','#86613e'];
  const eye=new T.Object3D(), a=new T.Vector3(),b=new T.Vector3();
  eye.rotation.order='YXZ';
  function beam(from:Point,to:Point,width:number,depth:number,color:string) {
    a.set(...from);b.set(...to);eye.position.copy(a).lerp(b,.5);eye.lookAt(b);
    eye.rotateZ(.032);
    sculpt.place(cuboid,[eye.position.x,eye.position.y,eye.position.z],[width*1.18,depth*1.18,a.distanceTo(b)+.07],
      [eye.rotation.x,eye.rotation.y,eye.rotation.z],color);
  }
  // Sunken merchant hull, an asymmetric broken port side exposes the cargo.
  beam([0,.04,-4.55],[.08,.04,4.08],.27,.33,'#645340');
  for(let rib=0;rib<10;rib++) {
    const z=-3.96+rib*.83, span=.49+1.19*Math.sin((rib+.45)*Math.PI/10.2);
    for(const side of [-1,1]) {
      const lip=.40+.17*Math.sin(rib*1.5);
      const top=side===1&&rib>4 ? .39+random()*.18 : 1+random()*.18;
      const center:Point=[0,.11,z],knee:Point=[.67*span*side,.30,z+.09],rim:Point=[span*side,top,z+.14];
      beam(center,knee,.15,.19,ribs[rib%3]);beam(knee,rim,.15,.16,ribs[(rib+1)%3]);
      if(rib<9&&(side===-1||rib<4))beam([span*side,lip,z],[span*side,lip+.03,z+.87],.15,.14,'#786044');
    }
  }
  for(let j=0;j<3;j++)beam([-.69+j*.37,.28,1.7],[.17+j*.34,.33,3.5+j*.31],.26,.10,ribs[j]);
  beam([-1.25,.53,2.83],[1.64,.3,.95],.17,.16,'#67543c');
  const jar=new T.LatheGeometry([[.06,0],[.12,.08],[.27,.32],[.31,.50],[.24,.64],[.13,.72],[.115,.89],[.16,.90],[.16,.96],[.10,.96],[.095,.82]].map(([x,y])=>new T.Vector2(x,y)),18);
  const handle=new T.TorusGeometry(.145,.034,5,13);
  const ring=new T.TorusGeometry(.139,.021,5,18);
  for(const [x,z,tilt] of [[.35,-1.25,.24],[.52,-.55,-.41],[-.32,.14,.32],[1.70,-.61,1.14],[2.62,-.28,.74],[2.04,1.17,1.30],[2.85,1.39,1.11],[-.47,-1.85,.50]]) {
    const size=1.12+random()*.42;
    const frame=new T.Object3D();frame.position.set(x,.19+Math.abs(tilt)*.1,z);frame.rotation.y=random()*.9;frame.rotation.z=tilt;frame.scale.setScalar(size);frame.updateMatrix();
    function jarPart(g:T.BufferGeometry,at:Point,sc:Point,rot:Point,color:string) {
      const part=new T.Object3D();part.position.set(...at);part.scale.set(...sc);part.rotation.set(...rot,'YXZ');
      part.updateMatrix();part.applyMatrix4(frame.matrix);
      sculpt.place(g,part.position.toArray(),part.scale.toArray(),[part.rotation.x,part.rotation.y,part.rotation.z],color);
    }
    const clay=['#f7a551','#c6733d','#e39755'][Math.floor(random()*3)];
    jarPart(jar,[0,0,0],[1,1,1],[0,0,0],clay);
    for(const side of [-1,1])jarPart(handle,[side*.176,.685,0],[.78,1.24,.82],[0,0,side*.42],clay);
    jarPart(ring,[0,.85,0],[1,1,1],[Math.PI/2,0,0],'#705438');
  }
  sculpt.finish();[cuboid,jar,handle,ring].forEach(g=>g.dispose());

  const school=new T.Group();group.add(school);
  const colors=new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide});
  const pp:number[]=[],cc:number[]=[],ii:number[]=[];
  const model=[[.47,0,0],[.03,.055,.105],[-.33,0,.025],[.03,-.025,-.105],[.06,.075,0],[-.51,.015,.13],[-.51,.015,-.13],[.02,.0,.20],[-.04,0,-.20]];
  const shades=['#ded8af','#b6c8a6','#6e9285','#526f67','#c9cbb0','#b3b99c','#9ba791','#adbaa0','#859985'];
  for(let i=0;i<model.length;i++){pp.push(...model[i]);new T.Color(shades[i]).toArray(cc,cc.length);}
  ii.push(0,1,4,1,2,4,4,2,3,0,4,3,2,5,6,1,7,2,2,8,3);
  const g=coloredGeometry(pp,cc,ii);
  const fish=new T.InstancedMesh(g,colors,17);fish.userData.refractiveFoliage=true;fish.frustumCulled=false;school.add(fish);
  const swimmers=Array.from({length:17},()=>({x:(random()-.5)*3.9,z:(random()-.5)*1.6,phase:random()*tau,size:.84+random()*.51}));
  return (t:number)=>{
    const angle=t*.12, x=3.9+Math.cos(angle+.4)*3.1,z=3.85+Math.sin(angle+.4)*2.20;
    school.position.set(x,0,z);school.rotation.y=Math.atan2(-Math.cos(angle+.4)*1.65,-Math.sin(angle+.4)*2.45);
    for(let i=0;i<swimmers.length;i++) {
      const s=swimmers[i];eye.position.set(s.x+.16*Math.sin(t*.64+s.phase),-.83+.052*Math.sin(t*.73+s.phase),s.z+.13*Math.cos(t*.56+s.phase));
      eye.rotation.set(0,.08*Math.sin(t*2.8+s.phase),.05*Math.sin(t*.8+s.phase));eye.scale.setScalar(s.size);
      eye.updateMatrix();fish.setMatrixAt(i,eye.matrix);
    }
    fish.instanceMatrix.needsUpdate=true;
  };
}

function jellyGeometry() {
  const p:number[]=[],c:number[]=[],indices:number[]=[], col=new T.Color();
  const rings=10, slices=30;
  for(let j=0;j<=rings;j++)for(let i=0;i<=slices;i++){
    const t=j/rings,a=tau*i/slices;
    const rad=Math.sin(t*Math.PI*.56)*(.93+.036*Math.cos(a*8)*t);
    const y=.41*(1-t*t)+.058*Math.cos(a*8)*t**4;
    p.push(Math.cos(a)*rad,y,Math.sin(a)*rad);
    col.set('#62437f').lerp(new T.Color('#96dede'),.22+.37*Math.cos(a*4)**4+.18*t**3+.10*(1.-t));
    col.lerp(new T.Color('#b6fff3'),.90*t**8).toArray(c,c.length);
    if(i>0&&j>0){const k=j*(slices+1)+i;indices.push(k-1,k,k-slices-2,k-slices-2,k,k-slices-1);}
  }
  return coloredGeometry(p,c,indices);
}

function nightScene(group:T.Group,source:SandMesh) {
  const shoalHeight=shoal(group,source,'#455269','#323646',true);
  const solid=sculpture(group), rock=new T.IcosahedronGeometry(1,1), random=rng(77412);
  // Low indigo rock outcrops, separated by two luminous channels.
  for(let k=0;k<45;k++){
    const x=(k<22?-.5:5.2)+(random()-.5)*3.5,z=-5.5+random()*12;
    const w=.23+random()*.68, y=shoalHeight(x,z);
    solid.place(rock,[x,y+w*.12,z],[w,w*.40,w*(.75+random()*.34)],[0,random()*tau,0],k%2?'#40445a':'#51445d');
  }
  solid.finish();rock.dispose();
  const colonies=new T.InstancedMesh(new T.SphereGeometry(1,11,7),new T.MeshBasicMaterial({color:'#59acb2'}),62);
  colonies.userData.refractiveFoliage=true;
  colonies.userData.emissiveLayer=true;
  const o=new T.Object3D();
  for(let k=0;k<62;k++) {
    const x=(k<31?-.5:5.2)+Math.sin(k*.91)*1.8,z=-5.3+11.2*(k%31)/30;
    o.position.set(x,shoalHeight(x,z)+.18,z);const size=.05+.065*random();o.scale.set(size*1.55,size*.8,size);o.updateMatrix();colonies.setMatrixAt(k,o.matrix);
  }
  group.add(colonies);
  const bell=jellyGeometry(), surface=new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide});
  const trailsP:number[]=[],trailsC:number[]=[],trailsI:number[]=[];
  const tint=new T.Color();
  for(let j=0;j<7;j++) {
    const a=j*tau/7, x=Math.cos(a)*.67,z=Math.sin(a)*.67, start=trailsP.length/3;
    for(let i=0;i<=12;i++){
      const t=i/12, cx=x+t*(.9+.20*j)+Math.sin(4.6*t+a)*.12, cz=z+.16*Math.sin(t*6+a)+.37*t;
      const width=(.072+.063*Math.sin(a)**2)*(1.-.67*t);
      for(const sign of [-1,1]) {
        trailsP.push(cx, -.12-.31*t,cz+sign*width);
        tint.set('#d3daec').lerp(new T.Color('#6e7694'),.14+t*.64).toArray(trailsC,trailsC.length);
      }
      if(i){const k=start+i*2;trailsI.push(k-2,k,k+1,k-2,k+1,k-1);}
    }
  }
  const trails=coloredGeometry(trailsP,trailsC,trailsI);
  const bells=new T.InstancedMesh(bell,surface,10),wings=new T.InstancedMesh(trails,surface,10);
  // Four horseshoe-shaped central lobes make the drifting bells readable from above.
  const arc=new T.TorusGeometry(.205,.047,6,18,Math.PI*1.58);arc.rotateX(-Math.PI/2);
  const lobes=new T.InstancedMesh(arc,new T.MeshBasicMaterial({color:'#cefff2'}),40);
  for(const m of [bells,wings,lobes]){m.frustumCulled=false;m.userData.refractiveFoliage=true;m.userData.emissiveLayer=true;group.add(m);}
  const jellySites=[[1.4,7.0,.96],[2.4,4.1,.67],[6.1,4.80,1.06],[6.4,1.70,.64],
    [3.4,.15,.74],[.60,-3.75,.51],[4.5,-4.1,.75],[-.9,2.3,.58],[9.3,5.2,.62],[8.1,-3.3,.54]];
  const part=new T.Object3D(), world=new T.Matrix4();
  return (t:number,wind:number,amount:number)=>{
    colonies.material.color.set('#59acb2').multiplyScalar(.82+.23*amount);
    lobes.material.color.set('#cefff2').multiplyScalar(.97+.10*amount);
    for(let i=0;i<jellySites.length;i++) {
      const [cx,cz,scale]=jellySites[i], phase=i*2.13;
      const pulse=.5+.5*Math.sin(t*(.73+wind*.05)+phase);
      o.position.set(cx+.38*Math.sin(t*.18+phase),-1.17+.14*Math.cos(phase)+.052*Math.sin(t*.39+phase),cz+.28*Math.cos(t*.17+phase));
      o.rotation.set(.08*Math.sin(phase),.57+.42*Math.sin(phase+t*.12),.13*Math.cos(phase));
      o.scale.set(scale*(.94+.09*pulse),scale*(1.05-.10*pulse),scale*(.94+.09*pulse));o.updateMatrix();
      bells.setMatrixAt(i,o.matrix);wings.setMatrixAt(i,o.matrix);
      for(let j=0;j<4;j++) {
        const theta=j*Math.PI*.5+.4;
        part.position.set(Math.cos(theta)*.23,.42,Math.sin(theta)*.23);
        part.rotation.y=-theta+.8;part.scale.setScalar(.72);part.updateMatrix();
        world.multiplyMatrices(o.matrix,part.matrix);lobes.setMatrixAt(i*4+j,world);
      }
    }
    bells.instanceMatrix.needsUpdate=wings.instanceMatrix.needsUpdate=lobes.instanceMatrix.needsUpdate=true;
  };
}

export function createLayerScenery(scene:T.Scene,bed:Pick<ReturnType<typeof createWatercolorBed>,'floor'>) {
  const meadow=new T.Group(),wreck=new T.Group(),night=new T.Group();
  meadow.name='Posidonia meadow';wreck.name='Amphora wreck';night.name='Moon jelly channel';
  scene.add(meadow,wreck,night);
  const clock={value:0},storm={value:0};
  const original=bed.floor;
  meadowScene(meadow,original,clock,storm);
  const updateWreck=wreckScene(wreck,original),updateNight=nightScene(night,original);
  let mode:LayerMode='refraction';
  function setMode(value:LayerMode) {
    mode=value;original.visible=mode==='refraction';meadow.visible=mode==='meadow';wreck.visible=mode==='wreck';night.visible=mode==='night';
  }
  setMode(mode);
  return {setMode,update(time:number,wrath:number,amount:number){
    clock.value=time;storm.value=wrath;
    if(mode==='wreck')updateWreck(time);
    if(mode==='night')updateNight(time,wrath,amount);
  },dispose(){
    original.visible=true;
    const geometries=new Set<T.BufferGeometry>(), materials=new Set<T.Material>();
    for(const root of [meadow,wreck,night]) {
      root.removeFromParent();
      root.traverse(item=>{
        if(item instanceof T.Mesh) {
          if(item instanceof T.InstancedMesh)item.dispose();
          geometries.add(item.geometry);
          for(const m of Array.isArray(item.material)?item.material:[item.material])materials.add(m);
        }
      });
    }
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }};
}
