import type { LocationNavigation, LocationSlot, Point } from './location-navigation';

export const maxSeaWaves = 2;
export const waveHalfDepth = .68;

export type SeaWave = {
  start: Point;
  heading: number;
  direction: Point;
  length: number;
  halfWidth: number;
  speed: number;
  warningTime: number;
  age: number;
  hit: boolean;
};

type Hull = { position: Point; heading: number; radius: number; halfLength: number };

export function waveTravel(wave: SeaWave, age = wave.age): number {
  return Math.max(0, (age - wave.warningTime) * wave.speed);
}

function waveHits(wave: SeaWave, previous: Point, hull: Hull, age: number): boolean {
  if (wave.age <= wave.warningTime) return false;
  const { x, z } = wave.direction;
  const longitudinal = (p: Point) => (p.x - wave.start.x) * x + (p.z - wave.start.z) * z;
  const lateral = (p: Point) => (p.x - wave.start.x) * z - (p.z - wave.start.z) * x;
  const angle = hull.heading - wave.heading;
  const halfLength = hull.radius + hull.halfLength * Math.abs(Math.cos(angle));
  const halfWidth = hull.radius + hull.halfLength * Math.abs(Math.sin(angle));
  const sweepStart = waveTravel(wave, age);
  const sweepEnd = Math.min(wave.length, waveTravel(wave));
  if (sweepStart > sweepEnd) return false;

  // Test the boat segment in the wave's moving coordinate frame.
  const start = { x: longitudinal(previous) - sweepStart, z: lateral(previous) };
  const end = { x: longitudinal(hull.position) - sweepEnd, z: lateral(hull.position) };
  const limits = { x: halfLength + waveHalfDepth, z: halfWidth + wave.halfWidth };
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'z'] as const) {
    const from = start[axis];
    const delta = end[axis] - from;
    const limit = limits[axis];
    if (Math.abs(delta) < 1e-8) {
      if (Math.abs(from) > limit) return false;
      continue;
    }
    const a = (-limit - from) / delta;
    const b = (limit - from) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

export class SeaWaves {
  readonly active: SeaWave[] = [];
  private next = 0;
  private followUp = false;

  constructor(private readonly random: () => number) {}

  reset(location: LocationSlot) {
    this.clear();
    this.next = location === 'temple' ? 16 : 21;
  }

  clear() {
    this.active.length = 0;
    this.followUp = false;
  }

  step(dt: number, wrath: number, location: LocationSlot, navigation: LocationNavigation,
    previous: Point, hull: Hull, damage: () => boolean) {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const wave = this.active[i];
      const oldAge = wave.age;
      wave.age += dt;
      if (!wave.hit && waveHits(wave, previous, hull, oldAge)) {
        wave.hit = true;
        if (damage()) return;
      }
      if (waveTravel(wave) > wave.length) this.active.splice(i, 1);
    }
    this.next -= dt;
    if (this.next > 0 || this.active.length >= maxSeaWaves) return;

    const temple = location === 'temple';
    const pressure = wrath / 100;
    const wave = this.place(hull.position, navigation, pressure, temple);
    if (!wave) {
      this.next = 1.4;
      return;
    }
    this.active.push(wave);
    if (!this.followUp && wrath >= (temple ? 66 : 87)) {
      this.followUp = true;
      this.next = 1.85;
    } else {
      this.followUp = false;
      this.next = (temple ? 22 : 27) - pressure * 13;
    }
  }

  private place(boat: Point, navigation: LocationNavigation, pressure: number, temple: boolean): SeaWave | null {
    const offset = this.random() * Math.PI * 2;
    const speed = 3.85 + pressure * 3.9 + (temple ? .75 : 0);
    const halfWidth = 2.4 + pressure + (temple ? .3 : 0);
    const warningTime = 2.15 - pressure * .38;
    for (const range of [7.2, 4.4]) {
      for (let i = 0; i < 12; i += 1) {
        const heading = offset + i * Math.PI / 6;
        const direction = { x: Math.sin(heading), z: Math.cos(heading) };
        const start = { x: boat.x - direction.x * range, z: boat.z - direction.z * range };
        const end = { x: boat.x + direction.x * 3.2, z: boat.z + direction.z * 3.2 };
        if (!navigation.clear(start, end, .22)) continue;
        return {
          start, direction, heading, halfWidth, speed, warningTime,
          length: range + 3.2, age: 0, hit: false,
        };
      }
    }
    return null;
  }
}
