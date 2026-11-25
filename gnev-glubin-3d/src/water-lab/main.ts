import { startLab,showLabError } from './harbor';
import { createBreakers } from './breaker';
import { createRefraction } from './refraction';
import { createSlopeLight } from './slope-light';
import { makeLabUI,type Mode,type LabSettings } from './ui';

startLab<Mode,LabSettings>(({renderer,scene,sea,uniforms})=>{
  const optics=createRefraction(renderer,scene,sea,uniforms);
  const slopes=createSlopeLight(uniforms);
  const breakers=createBreakers(uniforms);
  scene.add(breakers.group);
  const variants={refraction:optics, slopes, breakers};
  let active: Mode='refraction';
  return {
    select(mode) {
      active=mode; breakers.group.visible=mode==='breakers'; return variants[mode].material;
    },
    update(time){if(active==='breakers')breakers.update(time);},
    render(camera){if(active==='refraction')optics.render(camera);},
    heightOffset(x,z){return active==='breakers'?breakers.displacementAt(x,z):0;},
    dispose(){optics.dispose();slopes.dispose();breakers.dispose();},
  };
},makeLabUI).catch(showLabError);
