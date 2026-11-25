import { Pond } from './rules/game.js';
import { enemyHitRadius, enemyLineup, enemyNames, enemyTiming, type EnemyEncounter, type EnemyExit } from './enemies';
import { Polyphemus, readPolyphemusSave, type PolyphemusSave } from './polyphemus/rules';
import { LocationNavigation, worldHeading, worldPoint, type LocationLayout, type Point } from './location-navigation';

export type { Point } from './location-navigation';
type School = Point & { id: number };
type Arrow = { start: Point; end: Point; age: number; travel: number };
type MissedCast = { start: Point; end: Point; age: number };
type Impact = Point & { hit: boolean; age: number };

export const waterCamera = { x: 11, y: 19, z: 19 };
export const schoolRadius = 1.15;
const castReach = 10;
const castMinimum = 2.2;
const castChargeTime = 1.08;
export const reach = 12;
// The current game boat measures 4 × 1.88 m. Its ends taper into the capsule.
const boatClearance = 1.10;
const boatSpineHalfLength = 1.06;

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const between = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

// First intersection along a segment, including contacts when the segment starts inside.
function contact(a: Point, b: Point, center: Point, radius: number): number {
  const x = b.x - a.x;
  const z = b.z - a.z;
  const dx = a.x - center.x;
  const dz = a.z - center.z;
  const c = dx * dx + dz * dz - radius * radius;
  if (c <= 0) return 0;
  const length = x * x + z * z;
  const dot = dx * x + dz * z;
  const discriminant = dot * dot - length * c;
  if (!length || dot >= 0 || discriminant < 0) return Infinity;
  const t = (-dot - Math.sqrt(discriminant)) / length;
  return t <= 1 ? t : Infinity;
}

function hullSpine(position: Point, heading: number): [Point, Point] {
  const x = Math.sin(heading) * boatSpineHalfLength;
  const z = Math.cos(heading) * boatSpineHalfLength;
  return [{ x: position.x - x, z: position.z - z }, { x: position.x + x, z: position.z + z }];
}

export class Expedition extends Pond {
  declare meta: Pond['meta'] & PolyphemusSave;
  readonly polyphemus: Polyphemus;
  readonly recoveredStake: boolean;

  constructor(meta?: Partial<Pond['meta'] & PolyphemusSave>, random = Math.random) {
    super({ ...meta, ...readPolyphemusSave(meta) }, random);
    this.polyphemus = new Polyphemus(this.meta, id => this.balance[id].value, random);
    this.recoveredStake = this.polyphemus.recover();
  }

  override sell() {
    return this.polyphemus.sell();
  }

  readonly helm = new Set<string>();
  position: Point = { x: 1, z: 0 };
  heading = .45;
  velocity: Point = { x: 0, z: 0 };
  schools: School[] = [];
  fishingSpot: School | null = null;
  castPoint: Point | null = null;
  missedCast: MissedCast | null = null;
  monster: EnemyEncounter | null = null;
  monsterExit: EnemyExit | null = null;
  aiming = false;
  drawing = false;
  charge = 0;
  target: Point | null = null;
  arrow: Arrow | null = null;
  impact: Impact | null = null;
  private schoolTimer = 0;
  private monsterTimer = 0;
  private monsterIndex = 0;
  private schoolId = 1;
  private castChargeAge = 0;
  private returnPose: { position: Point; heading: number } | null = null;
  private navigation: LocationNavigation | null = null;
  private schoolSites: Point[] = [];

  override get firstPerson() {
    return Boolean(this.fishingSpot && this.run?.phase !== 'cast' && super.firstPerson);
  }

  private chargedPoint(minimum: number, maximum: number) {
    if (!this.target) return null;
    const length = distance(this.position, this.target);
    if (length < .08) return null;
    return between(this.position, this.target, (minimum + (maximum - minimum) * this.charge) / length);
  }

  get castPreview() {
    const point = this.chargedPoint(castMinimum, castReach);
    if (!point) return null;
    const open = this.navigation?.clear(this.position, point) ?? false;
    const school = open ? this.schools.reduce<School | null>((nearest, school) => {
      const range = distance(point, school);
      return range <= schoolRadius && (!nearest || range < distance(point, nearest)) ? school : nearest;
    }, null) : null;
    return { point, school, open };
  }

  get shotEnd() {
    return this.chargedPoint(1.1, reach);
  }

  beginCast() {
    if (this.run?.phase !== 'ready' || this.aiming || this.drawing) return false;
    this.drawing = true;
    this.charge = 0;
    this.castChargeAge = 0;
    this.velocity = { x: 0, z: 0 };
    return true;
  }

  releaseCast() {
    if (!this.drawing || this.aiming || this.run?.phase !== 'ready') return;
    const preview = this.castPreview;
    this.abortDraw();
    if (!preview?.open) {
      if (preview) this.tell('Заброс перекрыт. Выбери открытый участок воды.');
      return;
    }
    const { point, school } = preview;
    if (!school) {
      this.missedCast = { start: { ...this.position }, end: point, age: 0 };
      this.tell('Заброс мимо рыбного места.');
      return;
    }
    this.missedCast = null;
    this.castPoint = point;
    this.fishingSpot = school;
    this.turnBoatTowards(Math.atan2(this.position.x - point.x, this.position.z - point.z), 1);
    this.cast({ angle: 0, depth: .52 });
    if (this.run.cast) this.run.cast.hasBite = true;
    this.run.distance = distance(this.position, point);
  }

  override start(id: string, layout?: LocationLayout) {
    if (this.polyphemus.round || !layout || layout.proposed_three_slot !== id) return false;
    const navigation = new LocationNavigation(layout);
    const pose = (anchor: 'boat_spawn' | 'boat_return') => ({
      position: worldPoint(layout.anchors_xyz[anchor]),
      heading: worldHeading(layout.anchor_heading_from_east_towards_south_rad[anchor]),
    });
    const spawn = pose('boat_spawn');
    const returnPose = pose('boat_return');
    const firstSchool = worldPoint(layout.first_fish_hint_xyz);
    const spawnSpine = hullSpine(spawn.position, spawn.heading);
    const returnSpine = hullSpine(returnPose.position, returnPose.heading);
    const castRange = distance(spawn.position, firstSchool);
    if (!navigation.clear(...spawnSpine, boatClearance) || !navigation.clear(...returnSpine, boatClearance)
      || !(castRange >= castMinimum && castRange <= castReach) || !navigation.clear(spawn.position, firstSchool)) {
      throw new Error(`Invalid boat or fishing anchors in ${layout.location}`);
    }

    const schoolSites: Point[] = [];
    const { minX, maxX, minZ, maxZ } = layout.water_bounds;
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) {
      throw new Error(`Invalid water bounds in ${layout.location}`);
    }
    const columns = 8;
    const rows = 10;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const site = {
          x: minX + (column + .5) / columns * (maxX - minX),
          z: minZ + (row + .5) / rows * (maxZ - minZ),
        };
        if (navigation.clear(site, site, schoolRadius)) schoolSites.push(site);
      }
    }
    if (!super.start(id)) return false;
    this.navigation = navigation;
    this.returnPose = returnPose;
    this.position = spawn.position;
    this.heading = spawn.heading;
    this.helm.clear();
    this.velocity = { x: 0, z: 0 };
    this.schoolId = 1;
    this.schools = [{ ...firstSchool, id: this.schoolId++ }];
    this.schoolSites = schoolSites;
    this.fishingSpot = null;
    this.castPoint = null;
    this.missedCast = null;
    this.monster = null;
    this.monsterExit = null;
    this.monsterIndex = 0;
    this.aiming = false;
    this.abortDraw();
    this.arrow = null;
    this.impact = null;
    this.schoolTimer = 7;
    this.monsterTimer = this.balance.wrath.firstAttack;
    this.replenishSchool();
    this.replenishSchool();
    return true;
  }

  override finish(reason = 'return') {
    super.finish(reason);
    if (this.run || !this.returnPose) return;
    if (reason === 'return') {
      this.position = this.returnPose.position;
      this.heading = this.returnPose.heading;
    }
    this.returnPose = null;
    this.navigation = null;
    this.schoolSites = [];
  }

  override spawnHotspots() {
    // The 3D expedition owns persistent schools in world space.
  }

  private replenishSchool() {
    const navigation = this.navigation;
    if (!navigation) return;
    const available = this.schoolSites.filter(site => this.schools.every(school => distance(site, school) > schoolRadius * 2));
    const nearby = available.filter(site => {
      const range = distance(this.position, site);
      return range >= castMinimum && range <= castReach && navigation.clear(this.position, site);
    });
    const options = nearby.length ? nearby : available;
    const site = options[Math.floor(this.random() * options.length)];
    if (site) this.schools.push({ ...site, id: this.schoolId++ });
  }

  override primary() {
    if (this.run?.phase === 'hook' && !this.aiming) super.primary();
  }

  override miss(message: string, sound?: string) {
    this.fishingSpot = null;
    this.castPoint = null;
    super.miss(message, sound);
  }

  override land() {
    this.schools = this.schools.filter(school => school !== this.fishingSpot);
    this.fishingSpot = null;
    this.castPoint = null;
    this.schoolTimer = Math.min(this.schoolTimer, 3);
    super.land();
  }

  toggleBow() {
    if (!this.run || this.run.phase === 'surge') return;
    this.aiming = !this.aiming;
    this.abortDraw();
    if (this.aiming && this.run.cast) this.cancel();
  }

  abortDraw() {
    this.drawing = false;
    this.charge = 0;
    this.castChargeAge = 0;
    this.target = null;
  }

  beginDraw() {
    if (!this.aiming || this.drawing || this.arrow || !this.run || this.run.phase === 'surge') return false;
    this.drawing = true;
    this.charge = 0;
    return true;
  }

  releaseArrow() {
    if (!this.drawing) return;
    const end = this.shotEnd;
    if (end && this.charge >= .12) {
      this.arrow = { start: { ...this.position }, end, age: 0, travel: .15 + distance(this.position, end) * .026 };
    } else {
      this.tell('Удерживай ЛКМ, чтобы натянуть лук.');
    }
    const pointer = this.target;
    this.abortDraw();
    this.target = pointer;
  }

  private moveBoat(dt: number) {
    if (this.run?.phase !== 'ready' && !(this.run?.phase === 'pack' && this.aiming)) return;
    const navigation = this.navigation;
    if (!navigation || (this.drawing && !this.aiming)) return;
    const side = Number(this.helm.has('east')) - Number(this.helm.has('west'));
    const north = Number(this.helm.has('north')) - Number(this.helm.has('south'));
    const speed = this.drawing ? 2 : 4.65;
    const scale = speed / (Math.hypot(side, north) || 1) / Math.hypot(waterCamera.x, waterCamera.z);
    const ease = 1 - Math.exp(-dt * 9);
    this.velocity.x += ((side * waterCamera.z - north * waterCamera.x) * scale - this.velocity.x) * ease;
    this.velocity.z += ((-side * waterCamera.x - north * waterCamera.z) * scale - this.velocity.z) * ease;
    for (const axis of ['x', 'z'] as const) {
      const next = { ...this.position, [axis]: this.position[axis] + this.velocity[axis] * dt };
      if (!this.velocity[axis]) continue;
      const [bow, stern] = hullSpine(this.position, this.heading);
      const [nextBow, nextStern] = hullSpine(next, this.heading);
      // The frame's sweep is checked at the two ends and across the destination hull.
      if (navigation.clear(bow, nextBow, boatClearance) && navigation.clear(stern, nextStern, boatClearance)
        && navigation.clear(nextBow, nextStern, boatClearance)) this.position = next;
      else this.velocity[axis] = 0;
    }
    if (Math.hypot(this.velocity.x, this.velocity.z) > .25) {
      this.turnBoatTowards(Math.atan2(-this.velocity.x, -this.velocity.z), Math.min(1, dt * 10));
    }
  }

  private turnBoatTowards(heading: number, ease: number) {
    const navigation = this.navigation;
    if (!navigation) return;
    const delta = heading - this.heading;
    const turn = Math.atan2(Math.sin(delta), Math.cos(delta)) * ease;
    if (Math.abs(turn) < 1e-6) return;
    const steps = Math.ceil(Math.abs(turn) / .16);
    const turnStep = turn / steps;
    // A slightly wider capsule at the midpoint covers the arc between checked poses.
    const arcClearance = boatClearance + 2 * boatSpineHalfLength * Math.sin(Math.abs(turnStep) / 4);
    for (let i = 0; i < steps; i += 1) {
      const [a, b] = hullSpine(this.position, this.heading + turnStep / 2);
      if (!navigation.clear(a, b, arcClearance)) break;
      this.heading += turnStep;
    }
  }

  private spawnMonster() {
    const navigation = this.navigation;
    const run = this.run;
    if (!navigation || !run) return;
    const lineup = enemyLineup[run.zone.id as keyof typeof enemyLineup];
    const offset = this.random() * Math.PI * 2;
    for (let i = 0; i < 12; i += 1) {
      const angle = offset + i * Math.PI / 6;
      const point = { x: this.position.x + Math.cos(angle) * 8.5, z: this.position.z + Math.sin(angle) * 8.5 };
      if (!navigation.clear(point, point, .45) || !navigation.clear(point, this.position, .3)) continue;
      const kind = lineup[this.monsterIndex % lineup.length];
      this.monsterIndex += 1;
      this.monster = {
        ...point, kind, age: 0, windup: 0, steering: 0, moving: false,
        heading: Math.atan2(this.position.x - point.x, this.position.z - point.z),
      };
      this.tell(`Из воды поднялся прислужник Посейдона — ${enemyNames[kind]}. Достань лук.`);
      return;
    }
    this.monsterTimer = 1;
  }

  private resetMonster(monster: EnemyEncounter, clip: EnemyExit['clip']) {
    this.monsterExit = { monster, clip };
    this.monster = null;
    this.monsterTimer = this.balance.wrath.attackInterval + this.random() * this.balance.wrath.attackSpread * .6;
  }

  private moveMonster(dt: number) {
    const monster = this.monster;
    const run = this.run;
    const navigation = this.navigation;
    if (!monster || !run || !navigation) return;
    monster.age += dt;
    if (monster.age < enemyTiming.emerge) return;
    monster.moving = false;
    monster.heading = Math.atan2(this.position.x - monster.x, this.position.z - monster.z);
    const blocked = !navigation.clear(monster, this.position, .3);
    if (!blocked && distance(monster, this.position) < 1.65) {
      monster.windup += dt;
      if (monster.windup >= enemyTiming.windup) {
        run.health -= this.balance.wrath.attackDamage;
        this.resetMonster(monster, 'attack');
        this.cancel();
        this.tell('Прислужник ударил по лодке.');
        if (run.health <= 0) this.finish('health');
      }
      return;
    }
    monster.windup = 0;
    const direction = Math.atan2(this.position.z - monster.z, this.position.x - monster.x);
    const step = dt * (this.stage === 3 ? 4.85 : 3.4);
    const turn = monster.steering || 1;
    if (!blocked) monster.steering = 0;
    for (const offset of blocked ? [turn * .76, turn * 1.48, turn * 2.15, -turn * .76, -turn * 1.48] : [0]) {
      const next = { x: monster.x + Math.cos(direction + offset) * step, z: monster.z + Math.sin(direction + offset) * step };
      if (!navigation.clear(monster, next, .3)) continue;
      monster.heading = Math.PI / 2 - direction - offset;
      monster.moving = true;
      Object.assign(monster, next);
      monster.steering = Math.sign(offset);
      break;
    }
  }

  private updateArrow(dt: number) {
    if (this.impact) {
      this.impact.age += dt;
      if (this.impact.age >= .55) this.impact = null;
    }
    const arrow = this.arrow;
    const navigation = this.navigation;
    if (!arrow || !navigation) return;
    const previous = between(arrow.start, arrow.end, arrow.age / arrow.travel);
    arrow.age = Math.min(arrow.travel, arrow.age + dt);
    const next = between(arrow.start, arrow.end, arrow.age / arrow.travel);
    const monster = this.monster;
    const enemyHit = monster ? contact(previous, next, monster, enemyHitRadius) : Infinity;
    const obstruction = navigation.firstContact(previous, next);
    const hit = enemyHit <= 1 && enemyHit < obstruction;
    if (hit && monster) this.resetMonster(monster, 'defeat');
    const at = Math.min(enemyHit, obstruction, 1);
    if (hit || obstruction <= 1 || arrow.age >= arrow.travel) {
      this.impact = { ...between(previous, next, at), age: 0, hit };
      this.arrow = null;
      this.tell(hit ? 'Попадание. Прислужник утонул.' : 'Промах.');
    }
  }

  override updateThreat(dt: number) {
    if (this.advanceWrath(dt)) {
      this.aiming = false;
      this.abortDraw();
      this.arrow = null;
      this.missedCast = null;
      this.monster = null;
      this.monsterExit = null;
      return true;
    }
    if (this.missedCast) {
      this.missedCast.age += dt;
      if (this.missedCast.age >= this.balance.aim.flight + .4) this.missedCast = null;
    }
    if (this.drawing) {
      if (this.aiming) this.charge = Math.min(1, this.charge + dt / .78);
      else {
        this.castChargeAge = (this.castChargeAge + dt) % (2 * castChargeTime);
        this.charge = 1 - Math.abs(1 - this.castChargeAge / castChargeTime);
      }
    }
    this.moveBoat(dt);
    this.schoolTimer -= dt;
    if (this.schoolTimer <= 0) {
      if (this.schools.length < 4) this.replenishSchool();
      this.schoolTimer = 9;
    }
    this.updateArrow(dt);
    if (this.monster) this.moveMonster(dt);
    else if (this.stage >= 2) {
      this.monsterTimer -= dt * (this.stage === 3 ? 1.5 : 1);
      if (this.monsterTimer <= 0) this.spawnMonster();
    }
    return !this.run;
  }
}
