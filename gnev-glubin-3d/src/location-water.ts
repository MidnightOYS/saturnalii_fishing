import * as T from 'three';
import { createLocationWaterMap } from './location-environment';
import type { LocationLayout } from './location-navigation';
import { createWaterCollection, type CollectionFrame } from './water-lab/collection';
import type { BreakerSite } from './water-lab/breaker';
import type { LabSettings, Mode } from './water-lab/collection-settings';

function breakerSites(layout: LocationLayout): readonly [BreakerSite, BreakerSite] {
  const polygon = layout.water_polygon_xz;
  const area = polygon.reduce((sum, [x, z], index) => {
    const [endX, endZ] = polygon[(index + 1) % polygon.length];
    return sum + x * endZ - z * endX;
  }, 0);
  const winding = Math.sign(area);
  const { minX, maxX, minZ, maxZ } = layout.water_bounds;

  function site(sideX: number, zFraction: number, span: number) {
    const targetZ = T.MathUtils.lerp(minZ, maxZ, zFraction);
    let bestDistance = Infinity;
    let best: BreakerSite = { x: sideX, z: targetZ, angle: 0, span };
    for (const [index, [x, z]] of polygon.entries()) {
      const [endX, endZ] = polygon[(index + 1) % polygon.length];
      const dx = endX - x, dz = endZ - z;
      const length = Math.hypot(dx, dz);
      if (length < .05) continue;
      const middleX = (x + endX) / 2, middleZ = (z + endZ) / 2;
      const distance = Math.hypot(middleX - sideX, (middleZ - targetZ) * 2);
      if (distance >= bestDistance) continue;
      const outX = winding * dz / length, outZ = -winding * dx / length;
      bestDistance = distance;
      best = { x: middleX - outX * 3, z: middleZ - outZ * 3, angle: Math.atan2(outX, outZ), span };
    }
    return best;
  }

  return [site(maxX, .28, 2.7), site(minX, .45, 2.25)];
}

export function createGameWater(renderer: T.WebGLRenderer, scene: T.Scene, layout: LocationLayout,
  lamps?: readonly { position: T.Vector3; strength: number }[]) {
  const { map, bounds } = createLocationWaterMap(layout);
  const [eyeX, , eyeZ] = layout.anchors_xyz.fx_bronze_eye ?? [0, 0, 0];
  const radius = layout.fx_zones_m.fx_bronze_eye ?? 0;
  const locationSurface = {
    map, bounds, eye: new T.Vector4(eyeX - .6, eyeZ - .3, radius * 1.6, radius * 1.45),
    clarity: { value: 1 },
  };
  const collection = createWaterCollection({
    renderer, scene, bounds: layout.water_bounds, lamps, locationSurface,
    breakerSites: breakerSites(layout),
  });
  const pixelRatio = renderer.getPixelRatio();
  const paintedSun = new T.Color();
  const paintedSky = new T.Color();
  const paintedDirection = new T.Vector3();
  let paintSettings: LabSettings | undefined;
  return {
    select(mode: Mode, settings: LabSettings) {
      collection.select(mode, settings);
      paintSettings = mode === 'watercolor' ? settings : undefined;
      const scale = pixelRatio * (paintSettings?.renderScale ?? 1);
      if (scale !== renderer.getPixelRatio()) renderer.setPixelRatio(scale);
    },
    heightAt: collection.heightAt,
    renderPasses: collection.renderPasses,
    renderScene: collection.renderScene,
    ripple: collection.ripple,
    emitWake: collection.emitWake,
    update(time: number, wrath: number, frame: CollectionFrame) {
      locationSurface.clarity.value = 1 - T.MathUtils.smoothstep(wrath, .05, .70);
      if (!paintSettings) {
        collection.update(time, wrath, frame);
        return;
      }
      paintedSun.set(paintSettings.sun ?? '#faf0cd');
      paintedSky.set(paintSettings.sky ?? '#59757a');
      if (frame.sky) paintedSky.lerp(frame.sky, .36 + .64 * wrath);
      paintedDirection.set(-.57, (paintSettings.elevation ?? .82) * 1.6, -.81).normalize();
      collection.update(time, wrath, { ...frame, sky: paintedSky, sunColor: paintedSun, sunDirection: paintedDirection });
    },
    dispose() {
      collection.dispose();
      map.dispose();
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    },
  };
}
