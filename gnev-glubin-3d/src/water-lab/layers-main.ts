import {startLab,showLabError} from './harbor';
import {createRefraction} from './refraction';
import {createLayerScenery} from './layerscenery';
import {makeLabUI,type Mode,type LabSettings} from './layers-ui';

const styles:Record<Mode,number>={refraction:0,meadow:1,wreck:2,night:3};

startLab<Mode,LabSettings>(({renderer,scene,sea,uniforms,showTerrace,bed,sun,fill,ambient,sky})=>{
  const scenery=createLayerScenery(scene,bed);
  const uLayerStyle={value:0}, uLayerAmount={value:1};
  const optics=createRefraction(renderer,scene,sea,{...uniforms,uLayerStyle,uLayerAmount});
  let lastMode:Mode|undefined;
  return {
    select(mode,settings) {
      if(mode!==lastMode) {
        showTerrace(mode==='refraction');
        scenery.setMode(mode);
        bed.foliage.visible=mode==='refraction';
        lastMode=mode;
      }
      uLayerStyle.value=styles[mode];
      uLayerAmount.value=settings.layer;
      const night=mode==='night';
      sun.color.set(night?'#9ebaf2':'#ffe0a1');
      fill.color.set(night?'#52748b':'#b9dbe2');
      ambient.color.set(night?'#889cb8':'#fff0cb');
      ambient.groundColor.set(night?'#172c39':'#48706e');
      fill.intensity=night?.47:1.05;
      uniforms.uSunColor.value.set(night?'#bad0f0':'#ffe4ae');
      if(night) {
        sky.set('#263849'); ambient.intensity*=.67; sun.intensity*=.35;
      }
      return optics.material;
    },
    update(time,settings){scenery.update(time,settings.wrath,settings.layer);},
    render(camera){optics.render(camera);},
    dispose(){scenery.dispose();optics.dispose();},
  };
},makeLabUI).catch(showLabError);
