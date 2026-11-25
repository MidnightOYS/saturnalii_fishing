import { Group, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type BoatVariant = 'rowing' | 'sail';
type BoatAsset = 'boat' | 'boat-oar' | 'boat-sail-rig';
type ReadAsset = (asset: BoatAsset) => Promise<ArrayBuffer>;

const assetDirectory = 'models/blind-eye/';
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const pitchRotation = new Quaternion();

async function readBoatAsset(asset: BoatAsset): Promise<ArrayBuffer> {
  const embedded = document.querySelector<HTMLScriptElement>(`script[data-model="blind-eye-${asset}"]`);
  if (embedded) {
    const bytes = Uint8Array.from(atob(embedded.textContent?.trim() ?? ''), character => character.charCodeAt(0));
    if (embedded.dataset.compression !== 'gzip') return bytes.buffer;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  const url = new URL(`${assetDirectory}${asset}.glb`, document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

function requireNode(parent: Object3D, name: string): Object3D {
  const node = parent.getObjectByName(name);
  if (!node) throw new Error(`Blind Eye asset is missing ${name}`);
  return node;
}

function poseOar(oar: Object3D, yaw: number, pitch: number) {
  oar.quaternion.setFromAxisAngle(yAxis, MathUtils.degToRad(yaw));
  oar.quaternion.multiply(pitchRotation.setFromAxisAngle(zAxis, -MathUtils.degToRad(pitch)));
}

function prepareRig(template: Group, mastSocket: Object3D) {
  const root = requireNode(template, 'sail_rig').clone(true);
  const cloth = requireNode(root, 'sail_cloth');
  if (!(cloth instanceof Mesh)) throw new Error('sail_cloth must be a mesh');

  const fillIndex = cloth.morphTargetDictionary?.sail_fill;
  const flutterIndex = cloth.morphTargetDictionary?.sail_flutter;
  const weights = cloth.morphTargetInfluences;
  if (!weights || fillIndex === undefined || flutterIndex === undefined) {
    throw new Error('sail_cloth must provide sail_fill and sail_flutter');
  }
  root.visible = false;
  mastSocket.add(root);
  return { root, fillIndex, flutterIndex, weights };
}

export interface BoatVisual {
  /** Mount this art group on the game's existing movement and buoyancy root. */
  root: Group;
  prepareSail(): Promise<void>;
  update(variant: BoatVariant, docked: boolean, fishingView: boolean, speed: number, dt: number, time: number): void;
  resetSail(): void;
}

/** Use one loader instance per game page or renderer lifetime. */
export function createBoatVisualLoader(readAsset: ReadAsset = readBoatAsset) {
  const loader = new GLTFLoader();
  const templates = new Map<BoatAsset, Promise<Group>>();

  function load(asset: BoatAsset): Promise<Group> {
    const cached = templates.get(asset);
    if (cached) return cached;
    const request = readAsset(asset)
      .then(bytes => loader.parseAsync(bytes, ''))
      .then(result => result.scene)
      .catch(error => {
        templates.delete(asset);
        throw error;
      });
    templates.set(asset, request);
    return request;
  }

  return async function createBoatVisual(): Promise<BoatVisual> {
    const [hullTemplate, oarTemplate] = await Promise.all([load('boat'), load('boat-oar')]);
    const hull = requireNode(hullTemplate, 'boat').clone(true);
    const mastSocket = requireNode(hull, 'mast_socket');
    const port = oarTemplate.clone(true);
    const starboard = oarTemplate.clone(true);
    requireNode(hull, 'oarlock_port').add(port);
    requireNode(hull, 'oarlock_starboard').add(starboard);
    const root = new Group();
    root.name = 'blind_eye_visual';
    // The asset's bow points to +Z, while the game root's bow points to -Z.
    root.rotation.y = Math.PI;
    root.add(hull);

    let rig: ReturnType<typeof prepareRig> | undefined;
    let preparingSail: Promise<void> | undefined;
    let fill = 0;
    let strokePhase = 0;

    function resetSail() {
      fill = 0;
      if (rig) {
        rig.weights[rig.fillIndex] = 0;
        rig.weights[rig.flutterIndex] = 0;
      }
    }

    return {
      root,
      prepareSail() {
        return preparingSail ??= load('boat-sail-rig').then(template => {
          rig = prepareRig(template, mastSocket);
        }).catch(error => {
          preparingSail = undefined;
          throw error;
        });
      },
      update(variant, docked, fishingView, speed, dt, time) {
        const sailing = variant === 'sail' && Boolean(rig);
        port.visible = starboard.visible = !sailing && !fishingView;
        if (rig) rig.root.visible = sailing && !fishingView;
        if (port.visible) {
          const effort = MathUtils.smoothstep(speed, .1, 2.8);
          strokePhase += dt * 6 * effort;
          // Lift the blades alongside the gunwales at the berth.
          const yaw = docked ? 86 : 23 + Math.sin(strokePhase) * 28 * effort;
          const pitch = docked ? 0 : 11 + Math.cos(strokePhase) * 16 * effort;
          poseOar(port, yaw, pitch);
          poseOar(starboard, 180 - yaw, pitch);
        }
        if (!rig || !sailing) return;
        const target = MathUtils.smoothstep(speed, .15, 4.65);
        const tau = target > fill ? .28 : .55;
        fill = MathUtils.lerp(fill, target, 1 - Math.exp(-dt / tau));
        const flutter = (.5 + .5 * Math.sin(time * 2 * Math.PI * .8)) * MathUtils.lerp(.40, .10, fill);
        rig.weights[rig.fillIndex] = fill;
        rig.weights[rig.flutterIndex] = flutter;
      },
      resetSail,
    };
  };
}
