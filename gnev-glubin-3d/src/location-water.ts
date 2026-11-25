import * as T from 'three';
import { createLocationWaterMap } from './location-environment';
import type { LocationLayout, LocationSlot } from './location-navigation';
import type { VisualTuning } from './visual-tuning';
import { createWaterCollection, type CollectionFrame, type ExpeditionWaterStyle } from './water-lab/collection';
import type { BreakerSite } from './water-lab/breaker';
import type { LabSettings, Mode } from './water-lab/collection-settings';

type StagePalette = Omit<ExpeditionWaterStyle, 'caustics' | 'foamGain' | 'lamps'>;
type WaterTuning = Pick<VisualTuning, 'waterGrade' | 'caustics' | 'foam' | 'lamps'>;

function palette(deep: string, shallow: string, mixing: number, foam: number, glints: number): StagePalette {
  return { deep: new T.Color(deep), shallow: new T.Color(shallow), mixing, foam, glints };
}

const stagePalettes: Record<LocationSlot, readonly [StagePalette, StagePalette, StagePalette]> = {
  pond: [
    palette('#074467', '#79cdb7', 0, .34, .88),
    palette('#163758', '#4f9a9c', .46, .55, .63),
    palette('#242145', '#56558c', .74, .90, .42),
  ],
  temple: [
    palette('#102e53', '#609b8e', .37, .36, .88),
    palette('#172946', '#557e83', .55, .56, .62),
    palette('#1b2241', '#64708d', .77, .83, .49),
  ],
};

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
  const stages = stagePalettes[layout.proposed_three_slot];
  const style: ExpeditionWaterStyle = { ...palette('#074467', '#79cdb7', 0, 0, 0), caustics: 1, foamGain: 1, lamps: 1 };
  let paintSettings: LabSettings | undefined;
  return {
    select(mode: Mode, settings: LabSettings) {
      collection.select(mode, settings);
      paintSettings = mode === 'watercolor' ? settings : undefined;
      const scale = pixelRatio * (paintSettings?.renderScale ?? 1);
      if (scale !== renderer.getPixelRatio()) renderer.setPixelRatio(scale);
    },
    visualBasin: { layout, map, bounds },
    heightAt: collection.heightAt,
    renderPasses: collection.renderPasses,
    renderScene: collection.renderScene,
    ripple: collection.ripple,
    clearRipples: collection.clearRipples,
    emitWake: collection.emitWake,
    update(time: number, wrath: number, frame: CollectionFrame, visualStage: number, tuning?: WaterTuning) {
      const stage = T.MathUtils.clamp(visualStage, 0, 2);
      const low = Math.floor(stage);
      const a = stages[low], b = stages[Math.min(2, low + 1)];
      const blend = stage - low;
      style.deep.copy(a.deep).lerp(b.deep, blend);
      style.shallow.copy(a.shallow).lerp(b.shallow, blend);
      const grading = tuning?.waterGrade ?? 1;
      style.mixing = Math.min(.96, T.MathUtils.lerp(a.mixing, b.mixing, blend) * grading);
      style.foam = T.MathUtils.lerp(a.foam, b.foam, blend);
      style.foamGain = tuning?.foam ?? 1;
      style.glints = Math.pow(T.MathUtils.lerp(a.glints, b.glints, blend), grading);
      style.caustics = tuning?.caustics ?? 1;
      style.lamps = tuning?.lamps ?? 1;
      // A small optical window persists over the bronze while the rest of the basin darkens.
      locationSurface.clarity.value = T.MathUtils.lerp(1, .87, stage / 2);
      if (!paintSettings) {
        collection.update(time, wrath, { ...frame, expedition: style });
        return;
      }
      paintedSun.set(paintSettings.sun ?? '#faf0cd');
      paintedSky.set(paintSettings.sky ?? '#59757a');
      if (frame.sky) paintedSky.lerp(frame.sky, .36 + .64 * wrath);
      paintedDirection.set(-.57, (paintSettings.elevation ?? .82) * 1.6, -.81).normalize();
      collection.update(time, wrath, { ...frame, expedition: style, sky: paintedSky,
        sunColor: paintedSun, sunDirection: paintedDirection });
    },
    dispose() {
      collection.dispose();
      map.dispose();
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    },
  };
}
