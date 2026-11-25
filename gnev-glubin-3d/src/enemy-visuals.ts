import { AnimationMixer, LoopOnce, MathUtils, Object3D, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { enemyLineup, enemyTiming, type EnemyEncounter, type EnemyExit, type EnemyKind } from './enemies';
import { readEmbeddedModel } from './location-assets';
import type { LocationSlot } from './location-navigation';

const clips = ['emerge', 'idle', 'move', 'windup', 'attack', 'defeat'] as const;
type Clip = typeof clips[number];
type Surface = (x: number, z: number) => number;
type Ripple = (x: number, z: number, strength?: number) => void;
const backset = { hippocamp: 0, karkinos: 1, charybdis: 1.4, 'cretan-bull': .55 };
const attackDive = .36;

async function readEnemy(kind: EnemyKind) {
  const embedded = document.querySelector<HTMLScriptElement>(`script[data-model="enemies-${kind}"]`);
  if (embedded) return readEmbeddedModel(embedded);
  const url = new URL(`models/enemies/${kind}.glb`, document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

function createActor(kind: EnemyKind, { scene: root, animations }: GLTF) {
  const aim = root.getObjectByName('aim_target');
  const contact = root.getObjectByName('fx_contact');
  const waterline = root.getObjectByName('fx_surface');
  if (!aim || !contact || !waterline) throw new Error(`Missing ${kind} sockets`);

  const mixer = new AnimationMixer(root);
  const actions = new Map(clips.map(name => {
    const clip = animations.find(animation => animation.name === name);
    if (!clip) throw new Error(`Missing ${kind} animation: ${name}`);
    const action = mixer.clipAction(clip);
    if (name !== 'idle' && name !== 'move') {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    return [name, action] as const;
  }));
  root.visible = false;
  root.traverse(object => {
    if (object instanceof SkinnedMesh) object.frustumCulled = false;
  });
  let encounter: EnemyEncounter | undefined;
  let current: Clip | undefined;
  let surfaced = false;

  return {
    root, aim, contact, waterline,
    duration(clip: Clip) {
      return actions.get(clip)!.getClip().duration;
    },
    pose(monster: EnemyEncounter, surface: Surface, dt: number, dive = 0) {
      const heading = monster.heading + (kind === 'karkinos' && monster.moving ? Math.PI / 2 : 0);
      if (encounter !== monster) {
        encounter = monster;
        current = undefined;
        surfaced = false;
        mixer.stopAllAction();
        root.rotation.y = heading;
      }
      const angle = heading - root.rotation.y;
      const delta = Math.atan2(Math.sin(angle), Math.cos(angle));
      root.rotation.y += delta * (1 - Math.exp(-dt * 9));
      // Keep the larger bodies behind their existing contact point so their
      // head, claw or rim reaches the boat without taking its place.
      const x = monster.x - Math.sin(monster.heading) * backset[kind];
      const z = monster.z - Math.cos(monster.heading) * backset[kind];
      root.position.set(x, surface(x, z) - dive, z);
      root.visible = true;
    },
    animate(clip: Clip, dt: number, progress?: number) {
      const action = actions.get(clip)!;
      if (current !== clip) {
        const previous = current && actions.get(current);
        for (const other of actions.values()) if (other !== previous) other.stop();
        action.reset().setEffectiveWeight(1).play();
        if (previous) {
          if (clip === 'attack') previous.stop();
          else {
            previous.fadeOut(.12);
            action.fadeIn(.12);
          }
        }
        current = clip;
      }
      if (progress !== undefined) {
        action.paused = true;
        action.time = MathUtils.clamp(progress, 0, 1) * action.getClip().duration;
      }
      mixer.update(dt);
    },
    surfaceOnce(monster: EnemyEncounter) {
      if (surfaced || monster.age < enemyTiming.emerge * .5) return false;
      surfaced = true;
      return true;
    },
    hide() {
      root.visible = false;
      encounter = undefined;
      current = undefined;
      mixer.stopAllAction();
    },
  };
}

type Actor = ReturnType<typeof createActor>;

export function createEnemyVisuals(parent: Object3D) {
  const loader = new GLTFLoader();
  const loaded = new Map<EnemyKind, Actor>();
  const loading = new Map<EnemyKind, Promise<void>>();
  const socket = new Vector3();
  let active: Actor | undefined;
  let retiring: { exit: EnemyExit; actor: Actor; age: number } | undefined;
  let seenExit: EnemyExit | null = null;

  function preload(kind: EnemyKind) {
    if (loaded.has(kind) || loading.has(kind)) return;
    const request = readEnemy(kind)
      .then(bytes => loader.parseAsync(bytes, ''))
      .then(gltf => {
        const actor = createActor(kind, gltf);
        parent.add(actor.root);
        loaded.set(kind, actor);
      })
      .catch(error => console.warn(`Enemy model could not be loaded: ${kind}`, error))
      .finally(() => loading.delete(kind));
    loading.set(kind, request);
  }

  return {
    prepare(slot: LocationSlot) {
      for (const kind of enemyLineup[slot]) preload(kind);
    },
    reset() {
      active?.hide();
      retiring?.actor.hide();
      active = retiring = undefined;
      seenExit = null;
    },
    aimPoint(out: Vector3) {
      if (!active?.root.visible) return false;
      active.aim.getWorldPosition(out);
      return true;
    },
    update(monster: EnemyEncounter | null, exit: EnemyExit | null, dt: number, surface: Surface, ripple?: Ripple) {
      if (exit !== seenExit) {
        retiring?.actor.hide();
        retiring = undefined;
        seenExit = exit;
        const actor = exit && loaded.get(exit.monster.kind);
        if (exit && actor) {
          retiring = { exit, actor, age: 0 };
          actor.pose(exit.monster, surface, 0);
          actor.animate(exit.clip, 0, 0);
          if (exit.clip === 'attack') {
            actor.contact.getWorldPosition(socket);
            ripple?.(socket.x, socket.z, 1.4);
          }
        }
      }
      const next = monster ? loaded.get(monster.kind) : undefined;
      if (active !== next && active !== retiring?.actor) active?.hide();
      active = next;
      if (monster && active) {
        const emerges = monster.age < enemyTiming.emerge;
        const clip = emerges ? 'emerge' : monster.windup ? 'windup' : monster.moving ? 'move' : 'idle';
        const progress = emerges ? monster.age / enemyTiming.emerge
          : monster.windup ? monster.windup / enemyTiming.windup : undefined;
        active.pose(monster, surface, dt);
        active.animate(clip, dt, progress);
        if (active.surfaceOnce(monster)) {
          active.waterline.getWorldPosition(socket);
          ripple?.(socket.x, socket.z, 1);
        }
      }
      if (retiring && retiring.actor === active) retiring = undefined;
      if (!retiring) return;
      const { actor, exit: ended } = retiring;
      const duration = actor.duration(ended.clip);
      const excess = Math.max(0, retiring.age - duration);
      const dive = ended.clip === 'attack' ? excess / attackDive * 2.6 : 0;
      actor.pose(ended.monster, surface, dt, dive);
      actor.animate(ended.clip, dt, retiring.age / duration);
      retiring.age += dt;
      if (retiring.age >= duration + (ended.clip === 'attack' ? attackDive : 0)) {
        actor.hide();
        retiring = undefined;
      }
    },
  };
}
