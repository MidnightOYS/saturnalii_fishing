import * as T from 'three';
import { maxSeaWaves, waveHalfDepth, waveTravel, type SeaWave } from './sea-waves';

const widthSegments = 16;

function makeStrip(color: T.ColorRepresentation, rows: number, vertexColors = false) {
  const geometry = new T.PlaneGeometry(1, 1, widthSegments, rows);
  // Deformed on the water surface, including from the low fishing camera.
  (geometry.attributes.position as T.BufferAttribute).setUsage(T.DynamicDrawUsage);
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
    color, vertexColors, side: T.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
  }));
  mesh.userData.waterSurfaceEffect = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

export function createSeaWaveVisuals(scene: T.Scene, host: HTMLElement) {
  const css = getComputedStyle(host);
  const red = new T.Color(css.getPropertyValue('--gd-danger-fg').trim() || '#FF9D95');
  red.g *= .37;
  red.b *= .37;
  const deep = new T.Color(css.getPropertyValue('--gd-storm-water').trim() || '#1B3038');
  deep.b *= 1.85;
  const foam = new T.Color(css.getPropertyValue('--gd-foam').trim() || '#9CCDD1');
  const blue = new T.Color();
  const visuals = Array.from({ length: maxSeaWaves }, () => {
    const warning = makeStrip(red, 18, true);
    const front = makeStrip('#fff', 20, true);
    const warningUv = warning.geometry.attributes.uv;
    const warningTint = new T.Float32BufferAttribute(new Float32Array(warningUv.count * 4), 4);
    for (let i = 0; i < warningUv.count; i += 1) {
      const end = Math.min(1, Math.sin(Math.PI * warningUv.getY(i)) * 5);
      const edge = Math.abs(warningUv.getX(i) * 2 - 1) ** 12;
      warningTint.setXYZW(i, 1, .85 + .15 * edge, .86 + .14 * edge, end * (.61 + .39 * edge));
    }
    warning.geometry.setAttribute('color', warningTint);

    const frontUv = front.geometry.attributes.uv;
    const frontTint = new T.Float32BufferAttribute(new Float32Array(frontUv.count * 4), 4);
    for (let i = 0; i < frontUv.count; i += 1) {
      const across = frontUv.getX(i);
      const along = frontUv.getY(i);
      const crest = Math.max(0, 1 - Math.abs(along - .73 - .025 * Math.sin(across * 42)) / .12);
      const opacity = Math.min(1, Math.sin(Math.PI * along) * 2.8) * (1 - Math.abs(across * 2 - 1) ** 9);
      blue.copy(deep).lerp(foam, .045 + .66 * crest ** 2);
      frontTint.setXYZW(i, blue.r, blue.g, blue.b, opacity);
    }
    front.geometry.setAttribute('color', frontTint);
    front.material.opacity = .96;
    warning.renderOrder = 1;
    front.renderOrder = 2;
    scene.add(warning, front);
    return { warning, front };
  });

  function updateStrip(mesh: ReturnType<typeof makeStrip>, wave: SeaWave, surface: (x: number, z: number) => number,
    start: number, length: number, crestHeight: number) {
    const uv = mesh.geometry.attributes.uv;
    const vertices = mesh.geometry.attributes.position;
    const { x: dx, z: dz } = wave.direction;
    for (let i = 0; i < uv.count; i += 1) {
      const t = uv.getY(i);
      const u = uv.getX(i) * 2 - 1;
      const along = start + t * length;
      const across = u * wave.halfWidth;
      const x = wave.start.x + dx * along + dz * across;
      const z = wave.start.z + dz * along - dx * across;
      const crest = crestHeight * Math.sin(Math.PI * t ** 2.3) * (1 - Math.abs(u) ** 6);
      vertices.setXYZ(i, x, surface(x, z) + .065 + crest, z);
    }
    vertices.needsUpdate = true;
  }

  return (waves: readonly SeaWave[], surface: (x: number, z: number) => number) => {
    for (let i = 0; i < visuals.length; i += 1) {
      const wave = waves[i];
      const { warning, front } = visuals[i];
      warning.visible = Boolean(wave && wave.age < wave.warningTime);
      front.visible = Boolean(wave && !warning.visible);
      if (!wave) continue;
      if (warning.visible) {
        const urgency = wave.age / wave.warningTime;
        warning.material.opacity = .42 + .15 * urgency + .08 * Math.sin(wave.age * 11);
        updateStrip(warning, wave, surface, 0, wave.length, 0);
      } else {
        updateStrip(front, wave, surface, waveTravel(wave) - waveHalfDepth, waveHalfDepth * 2,
          .82 + (wave.speed - 3.8) * .12);
      }
    }
  };
}
