import type { BufferGeometry, Group, Material, Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { LocationLayout, LocationSlot } from './location-navigation';

export interface LoadedLocation {
  root: Group;
  layout: LocationLayout;
}

const locations = {
  pond: { slug: 'moon-cistern', root: 'MOON_CISTERN' },
  temple: { slug: 'bronze-harbor', root: 'BRONZE_HARBOR' },
} as const;
const loader = new GLTFLoader();

export function disposeLocation(root: Group) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value?.isTexture) textures.add(value as Texture);
    }
    material.dispose();
  }
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}

async function request(file: string, signal: AbortSignal) {
  const response = await fetch(new URL(`models/locations/${file}`, document.baseURI), { signal });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response;
}

async function readEmbeddedModel(script: HTMLScriptElement): Promise<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(script.textContent!.trim()), byte => byte.charCodeAt(0));
  if (script.dataset.compression !== 'gzip') return bytes.buffer;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function loadLocation(slot: LocationSlot, signal: AbortSignal): Promise<LoadedLocation> {
  const { slug, root: expectedRoot } = locations[slot];
  const embeddedModel = document.querySelector<HTMLScriptElement>(`script[data-model="${slug}"]`);
  const embeddedLayout = document.querySelector<HTMLScriptElement>(`script[data-layout="${slug}"]`);
  if (Boolean(embeddedModel) !== Boolean(embeddedLayout)) throw new Error(`Incomplete embedded location: ${slug}`);

  const [bytes, layout]: [ArrayBuffer, LocationLayout] = embeddedModel && embeddedLayout
    ? [await readEmbeddedModel(embeddedModel), JSON.parse(embeddedLayout.textContent!)]
    : await Promise.all([
      request(`${slug}.glb`, signal).then(response => response.arrayBuffer()),
      request(`${slug}-layout.json`, signal).then(response => response.json()),
    ]);
  signal.throwIfAborted();
  if (layout.location !== slug || layout.proposed_three_slot !== slot) {
    throw new Error(`Layout does not match the selected location: ${slug}`);
  }
  const { scene: root } = await loader.parseAsync(bytes, '');
  if (signal.aborted || !root.getObjectByName(expectedRoot)) {
    disposeLocation(root);
    signal.throwIfAborted();
    throw new Error(`Missing model root: ${expectedRoot}`);
  }
  return { root, layout };
}
