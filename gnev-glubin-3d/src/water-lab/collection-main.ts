import './ui.css';
import './collection-ui.css';
import * as T from 'three';
import { startLab, showLabError } from './harbor';
import { createWaterCollection } from './collection';
import { makeLabUI, type LabSettings, type Mode } from './collection-ui';

startLab<Mode, LabSettings>(({ renderer, scene, bed, bounds, terrain, showTerrace, sun, fill, ambient, sky, uniforms }) => {
  const water = createWaterCollection({
    renderer, scene, bed, bounds, shores: terrain.shores, lamps: terrain.lamps, comparisonScenery: true,
  });
  const sunColor = new T.Color();
  const sunDirection = new T.Vector3();
  const stormSky = new T.Color('#233446');
  let active: Mode = 'refraction';
  let scale = 1;
  return {
    select(mode, settings) {
      active = mode;
      scale = mode === 'watercolor' ? T.MathUtils.clamp(settings.renderScale ?? 1, .6, 1) : 1;
      showTerrace(mode === 'refraction');
      water.select(mode, settings);
      const night = mode === 'night', painted = mode === 'watercolor';
      sunColor.set(night ? '#bad0f0' : painted ? (settings.sun ?? '#faf0cd') : '#ffe4ae');
      sunDirection.copy(uniforms.uSun.value);
      if (painted) {
        const storm = T.MathUtils.smoothstep(settings.wrath, 0, 1);
        sky.set(settings.sky ?? '#59757a').lerp(stormSky, storm);
        sunDirection.set(-.57, (settings.elevation ?? .82) * 1.6, -.81).normalize();
        sun.intensity = T.MathUtils.lerp(2.46, .85, storm);
        ambient.intensity = T.MathUtils.lerp(1.69, .83, storm);
      }
      if (night) {
        sky.set('#263849');
        ambient.intensity *= .67;
        sun.intensity *= .35;
      }
      sun.color.set(painted ? sunColor : night ? '#9ebaf2' : '#ffe0a1');
      sun.position.copy(sunDirection).multiplyScalar(24);
      ambient.color.set(painted ? '#ecf0d0' : night ? '#889cb8' : '#fff0cb');
      ambient.groundColor.set(painted ? '#37665d' : night ? '#172c39' : '#48706e');
      fill.color.set(night ? '#52748b' : '#b9dbe2');
      fill.intensity = night ? .47 : painted ? 0 : 1.05;
    },
    update(time, settings, frame) {
      const wrath = settings.wrath;
      const isPainted = active === 'watercolor';
      const menace = isPainted && wrath >= .65 ? .66 + Math.sin(time * 2.1) * .13 : 0;
      water.update(time, wrath, {
        ...frame, sky, sunDirection, sunColor,
        threat: menace > 0 ? { x: frame.hull.x + 5.6 - 3.35 * menace,
          z: frame.hull.z - 2.45 + 1.38 * menace, strength: menace, heading: time * .24 + 2.5 } : undefined,
      });
    },
    heightAt: water.heightAt,
    emitWake: water.emitWake,
    ripple: water.ripple,
    clearTransient: water.clearTransient,
    render: water.renderPasses,
    renderScene: water.renderScene,
    renderScale: () => scale,
    dispose: water.dispose,
  };
}, makeLabUI, { managedWater: true }).catch(showLabError);
