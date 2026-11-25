import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readEmbeddedModel } from './location-assets';

export type IthacaAction = 'shop' | 'workshop' | 'polyphemus' | 'map';

const loader = new GLTFLoader();

async function fetchModel(name: string) {
  const path = `models/ithaca/${name}.glb`;
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function loadModel(name: string) {
  const embedded = document.querySelector<HTMLScriptElement>(`script[data-model="ithaca-${name}"]`);
  const bytes = embedded ? await readEmbeddedModel(embedded) : await fetchModel(name);
  return (await loader.parseAsync(bytes, '')).scene;
}

export async function loadIthaca() {
  const [deck, stall, workshop] = await Promise.all([
    loadModel('dock'), loadModel('ithaca_fish_stall'), loadModel('ithaca_workshop'),
  ]);
  const root = new T.Group();
  root.name = 'Ithaca';
  root.add(deck);
  deck.updateMatrixWorld(true);

  function anchor(name: string) {
    const object = deck.getObjectByName(name);
    if (!object) throw new Error(`Ithaca dock is missing the ${name} anchor`);
    return object;
  }

  function position(name: string) {
    return anchor(name).getWorldPosition(new T.Vector3());
  }

  function place(model: T.Group, name: string) {
    const mount = anchor(name);
    mount.getWorldPosition(model.position);
    mount.getWorldQuaternion(model.quaternion);
    root.add(model);
  }

  place(stall, 'interact_shop');
  place(workshop, 'interact_workshop');
  root.traverse(object => {
    if (object instanceof T.Mesh) object.castShadow = object.receiveShadow = true;
  });

  // The terrace houses share one exported mesh. Use a hit volume at the parlor's facade.
  const parlor = new T.Mesh(new T.BoxGeometry(3.02, 2.42, .36), new T.MeshBasicMaterial({ visible: false }));
  parlor.position.set(-8.59, 4.03, -7.63);
  parlor.rotation.y = .09;
  root.add(parlor);

  const flames = [
    { name: 'fx_hearth', scale: .66 },
    { name: 'fx_brazier_left', scale: .43 },
    { name: 'fx_brazier_right', scale: .43 },
    { name: 'fx_palace_brazier', scale: .54 },
  ].map(({ name, scale }) => {
    const flame = new T.Group();
    flame.position.copy(position(name));
    flame.scale.setScalar(scale);
    for (const [index, x] of [-.24, 0, .24].entries()) {
      const tongue = new T.Mesh(new T.ConeGeometry(.16, .96, 4), new T.MeshBasicMaterial({
        color: index === 1 ? '#ffe6a8' : '#ff974b', transparent: true, opacity: .83, depthWrite: false,
      }));
      tongue.position.set(x, .39, 0);
      flame.add(tongue);
    }
    root.add(flame);
    return flame;
  });

  const hearthLight = new T.PointLight('#ff9b50', 21, 7);
  hearthLight.position.copy(flames[0].position).y += .35;
  root.add(hearthLight);

  const camera = anchor('camera_dock');
  const berth = anchor('interact_boat');
  const boatPosition = berth.getWorldPosition(new T.Vector3());
  const boatRotation = berth.getWorldQuaternion(new T.Quaternion());
  const targets = { shop: stall, workshop, polyphemus: parlor };
  const labels = {
    shop: stall.position.clone().add(new T.Vector3(0, 2.85, .46)),
    workshop: workshop.position.clone().add(new T.Vector3(.25, 3.12, .24)),
    polyphemus: parlor.position.clone().add(new T.Vector3(0, 1.35, 0)),
    map: boatPosition.clone().add(new T.Vector3(0, 0, 2.4)),
  } satisfies Record<IthacaAction, T.Vector3>;

  return {
    root, targets, labels, boatPosition,
    // The game boat root faces -Z. Its GLB child already has the compensating half-turn.
    boatHeading: new T.Euler().setFromQuaternion(boatRotation, 'YXZ').y - Math.PI,
    mooringPier: position('mooring_pier'),
    mooringBoat: position('mooring_boat').sub(boatPosition)
      .applyQuaternion(boatRotation.invert())
      .applyAxisAngle(new T.Vector3(0, 1, 0), Math.PI),
    cameraFrom: position('camera_dock'),
    cameraTarget: position('camera_dock_target'),
    horizontalFov: camera.userData.horizontal_fov_deg as number,
    referenceAspect: camera.userData.reference_aspect as number,
    update(time: number) {
      hearthLight.intensity = 21 + Math.sin(time * 6.6) * 2.4;
      for (const [index, flame] of flames.entries()) {
        for (const [tongueIndex, tongue] of flame.children.entries()) {
          const t = time * (5.4 + tongueIndex) + index * 2 + tongueIndex;
          tongue.rotation.z = Math.sin(t) * .23 + (1 - tongueIndex) * .29;
          tongue.scale.y = .89 + Math.cos(t * 1.36) * .19;
        }
      }
    },
  };
}

export function createIthacaSky() {
  const material = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    uniforms: {
      horizon: { value: new T.Color('#d28f7a') },
      dusk: { value: new T.Color('#654a79') },
      sun: { value: new T.Color('#ffcd99') },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform vec3 horizon, dusk, sun;
      varying vec3 direction;
      void main() {
        vec3 dir = normalize(direction);
        float spread = smoothstep(-0.05, 0.43, dir.y);
        float bands = sin(dir.y * 78.0 + sin(dir.x * 18.0) * 1.2 + sin(dir.x * 46.0) * 0.4);
        vec3 color = mix(horizon, dusk, clamp(spread + smoothstep(0.1, 1.0, bands) * 0.09, 0.0, 1.0));
        float distanceToSun = distance(dir, normalize(vec3(-0.48, 0.062, -1.0)));
        color += sun * exp(-distanceToSun * 20.0) * 0.4;
        color = mix(color, sun * 2.8, 1.0 - smoothstep(0.021, 0.024, distanceToSun));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new T.Mesh(new T.SphereGeometry(90, 24, 12), material);
  sky.frustumCulled = false;
  sky.renderOrder = 100;
  return sky;
}
