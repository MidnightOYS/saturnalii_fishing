import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Shore } from './water';

const wood = new T.MeshStandardMaterial({ color: '#5f4531', roughness: .94 });
const darkWood = new T.MeshStandardMaterial({ color: '#352e24', roughness: .95 });
const stone = new T.MeshStandardMaterial({ vertexColors: true, roughness: .91, flatShading: true });
const limestone = new T.MeshStandardMaterial({ color: '#a9a58b', roughness: .90, flatShading: true });
const copper = new T.MeshStandardMaterial({ color: '#7c553a', metalness: .24, roughness: .73 });
const flame = new T.MeshBasicMaterial({ color: new T.Color('#ffd38b').multiplyScalar(2.3) });
const foliage = new T.MeshStandardMaterial({ color: '#344d38', roughness: 1, flatShading: true });

const loader = new GLTFLoader();
export const demoModels = ['boat', 'bobber', 'dock_deck', 'rod'] as const;
type Model = (typeof demoModels)[number];

async function model(name: Model) {
  const embedded = document.querySelector<HTMLScriptElement>(`script[data-model="${name}"]`);
  if (embedded) {
    const bytes = Uint8Array.from(atob(embedded.textContent!.trim()), byte => byte.charCodeAt(0));
    return (await loader.parseAsync(bytes.buffer, '')).scene;
  }
  return (await loader.loadAsync(new URL(`models/${name}.glb`, document.baseURI).href)).scene;
}

export async function loadWaterDemoArt() {
  const [boat, bobber, dock, rod] = await Promise.all(demoModels.map(model));
  return { boat, bobber, dock, rod };
}

export function addMesh(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function block(parent: T.Object3D, material: T.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
  return addMesh(parent, new T.BoxGeometry(w, h, d), material, x, y, z);
}

function pole(parent: T.Object3D, material: T.Material, x: number, y: number, z: number, radius: number, height: number) {
  return addMesh(parent, new T.CylinderGeometry(radius * .85, radius, height, 8), material, x, y, z);
}

function makeRock(parent: T.Object3D, shore: Shore, height: number, seed: number, tint: string) {
  const levels = [[-1.1, .91], [-.13, 1], [.23, .96], [.63, .70], [.92, .43], [1, .13]];
  const count = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  const hash = (i: number) => {
    const v = Math.sin(i * 17.731 + seed * 22.174) * 43758.54531;
    return v - Math.floor(v);
  };
  for (const [j, [elevation, scale]] of levels.entries()) {
    for (let i = 0; i < count; i += 1) {
      const angle = i / count * Math.PI * 2 + (hash(i) - .5) * .32;
      const width = scale * (.90 + .18 * hash(i + j * 15));
      positions.push(
        Math.cos(angle) * width * shore.radiusX + j * shore.radiusX * .038,
        elevation * height + (hash(i + j * 23) - .5) * height * .19,
        Math.sin(angle) * width * shore.radiusZ - j * shore.radiusZ * .035,
      );
      if (j === 0) continue;
      const a = (j - 1) * count + i;
      const b = (j - 1) * count + (i + 1) % count;
      indices.push(a, a + count, b, b, a + count, b + count);
    }
  }
  const apex = positions.length / 3;
  positions.push(shore.radiusX * .17, height * 1.015, -shore.radiusZ * .17);
  for (let i = 0; i < count; i += 1) indices.push(apex - count + i, apex, apex - count + (i + 1) % count);
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3)).setIndex(indices).toNonIndexed();
  geometry.computeVertexNormals();
  const color = new T.Color(tint), algae = new T.Color('#374b40');
  const vertices = geometry.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < vertices.count; i += 3) {
    const heightAverage = (vertices.getY(i) + vertices.getY(i + 1) + vertices.getY(i + 2)) / 3;
    const tone = color.clone().lerp(algae, 1 - T.MathUtils.smoothstep(heightAverage, -.14, height * .6));
    tone.multiplyScalar(.79 + .31 * hash(i + 50)).toArray(colors, i * 3);
    tone.toArray(colors, (i + 1) * 3);
    tone.toArray(colors, (i + 2) * 3);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  const rock = addMesh(parent, geometry, stone, shore.x, 0, shore.z);
  rock.rotation.y = -(shore.angle ?? 0);
}

const rockSites: (Shore & { height: number; tint: string })[] = [
  { x: -13.5, z: .5, radiusX: 7, radiusZ: 8.7, angle: .25, shelf: 6, height: 2.9, tint: '#68665d' },
  { x: -10.6, z: -7, radiusX: 3.55, radiusZ: 3.3, angle: -.6, shelf: 4.6, height: 2.3, tint: '#797464' },
  { x: -13.5, z: -11, radiusX: 5, radiusZ: 5.3, angle: .63, shelf: 4.8, height: 5.1, tint: '#706957' },
  { x: -8.6, z: -9.8, radiusX: 1.5, radiusZ: 2.25, angle: .3, shelf: 3.65, height: 1.3, tint: '#8b8068' },
  { x: 4.65, z: -11.2, radiusX: 3.58, radiusZ: 2.48, angle: -.28, shelf: 5.25, height: 3.45, tint: '#747770' },
  { x: 6.84, z: -12.8, radiusX: 2.08, radiusZ: 2.55, angle: .14, shelf: 4.1, height: 2.6, tint: '#727667' },
  { x: 2.39, z: -10.34, radiusX: 1.45, radiusZ: 1.43, angle: -.4, shelf: 3.2, height: .91, tint: '#91917d' },
  { x: 9.5, z: -22.5, radiusX: 6.2, radiusZ: 4.4, angle: -.1, shelf: 6, height: 4.27, tint: '#696c64' },
  { x: -6.5, z: -27, radiusX: 7.8, radiusZ: 7.2, angle: .2, shelf: 5.4, height: 5, tint: '#727467' },
  { x: -20.5, z: -24.3, radiusX: 7.6, radiusZ: 8.1, angle: -.2, shelf: 5, height: 8.2, tint: '#606a63' },
];

function cypress(group: T.Group, x: number, y: number, z: number, height: number) {
  pole(group, darkWood, x, y + height * .35, z, .085, height * .78);
  const crown = addMesh(group, new T.IcosahedronGeometry(1, 1), foliage, x, y + height * .76, z);
  crown.scale.set(height * .14, height * .54, height * .12);
  crown.rotation.z = -.12;
}

function pillar(group: T.Group, x: number, y: number, z: number, height: number) {
  block(group, limestone, x, y + .16, z, 1.18, .32, 1.18);
  for (let i = 0; i < height; i += .55) {
    pole(group, limestone, x, y + .45 + i, z, .36 - i * .012, .535);
  }
  block(group, limestone, x, y + height + .2, z, .94, .22, .94);
}

function brazier(group: T.Group, x: number, y: number, z: number) {
  pole(group, copper, x, y - .41, z, .12, .73);
  addMesh(group, new T.CylinderGeometry(.29, .10, .22, 9), copper, x, y, z);
  const ember = addMesh(group, new T.IcosahedronGeometry(.19, 1), flame, x, y + .16, z);
  ember.scale.y = 1.65;
  const light = new T.PointLight('#ffac59', 17, 7, 2);
  light.position.set(x, y + .33, z);
  group.add(light);
  return { position: light.position, strength: .75 };
}

export function buildWaterDemoTerrain(scene: T.Scene, dockModule: T.Object3D) {
  const group = new T.Group();
  scene.add(group);
  const shores: Shore[] = [...rockSites];
  for (const [i, rock] of rockSites.entries()) makeRock(group, rock, rock.height, i + 3, rock.tint);

  cypress(group, -13.8, 4.12, -11.9, 3.4);
  cypress(group, -12.2, 3.62, -11.1, 2.65);
  cypress(group, -8.1, 4.0, -28, 4.3);
  cypress(group, -4.1, 3.95, -27.2, 3.6);
  cypress(group, -2.8, 3.8, -29.3, 2.9);
  pillar(group, -5.6, 4.35, -26.9, 2.75);
  pillar(group, -7.6, 4.1, -26.7, 2.98);
  pillar(group, -7.6, 4.1, -28.8, 1.15);
  const architrave = block(group, limestone, -6.6, 7.48, -26.8, 3.0, .47, .89);
  architrave.rotation.z = .025;

  const dockX = -5.95;
  for (const z of [-5.8, -3.76, -1.72, .32, 2.36, 4.4]) {
    const deck = dockModule.clone();
    deck.position.set(dockX, .62, z);
    group.add(deck);
  }
  for (const x of [-8.19, -3.7]) {
    for (const z of [-6.6, -3.73, -.39, 2.5, 4.94]) {
      pole(group, darkWood, x, .16, z, .22, 2.28);
      pole(group, wood, x, 1.34, z, .25, .11);
      shores.push({ x, z, radiusX: .24, radiusZ: .24 });
    }
  }
  for (const z of [-2.53, -1.68, 4.1]) {
    const amphora = addMesh(group, new T.LatheGeometry([
      new T.Vector2(.04, 0), new T.Vector2(.17, .09), new T.Vector2(.28, .49), new T.Vector2(.18, .67),
      new T.Vector2(.095, .72), new T.Vector2(.10, .86), new T.Vector2(.14, .87),
    ], 10), copper, -6.25, .73, z);
    amphora.scale.setScalar(z === -2.53 ? .78 : 1);
  }
  const lamps = [
    brazier(group, -3.48, 1.6, 2.88), brazier(group, -3.58, 1.59, -3.11), brazier(group, -7.2, 1.6, -5.95),
  ];
  return { shores, lamps };
}

export function makeFisher(boat: T.Group) {
  const fisher = new T.Group();
  boat.add(fisher);
  const cloth = new T.MeshStandardMaterial({ color: '#89634a', roughness: .98, flatShading: true });
  const cloak = new T.MeshStandardMaterial({ color: '#806b44', roughness: .95, flatShading: true });
  const skin = new T.MeshStandardMaterial({ color: '#b9865f', roughness: 1, flatShading: true });
  addMesh(fisher, new T.CapsuleGeometry(.22, .29, 3, 8), cloth, 0, .87, .05);
  addMesh(fisher, new T.IcosahedronGeometry(.167, 1), skin, 0, 1.29, -.015);
  addMesh(fisher, new T.SphereGeometry(.20, 9, 5, 0, Math.PI * 2, 0, Math.PI * .53), cloak, 0, 1.32, .02);
  const mantle = addMesh(fisher, new T.ConeGeometry(.31, .58, 8, 1, true), cloak, 0, .79, .14);
  mantle.rotation.x = -.35;
}
