import { Pond } from './rules/game.js';

export type Point = { x: number; z: number };
type Obstacle = Point & { radius: number; kind: 'island' | 'wreck' | 'ruins'; angle: number };
type School = Point & { id: number };
type Monster = Point & { age: number; windup: number; steering: number };
type Arrow = { start: Point; end: Point; age: number; travel: number };
type MissedCast = { start: Point; end: Point; age: number };
type Impact = Point & { hit: boolean; age: number };

export const bounds = { left: -20, right: 20, near: 6, far: -41 };
export const waterCamera = { x: 11, y: 19, z: 19 };
export const schoolRadius = 1.15;
const castReach = 10;
const castMinimum = 2.2;
const castChargeTime = 1.08;
export const reach = 12;
const schoolSites = [
  { x: -2.9, z: -6.8 }, { x: 5.3, z: -3.7 }, { x: 1.5, z: -12.7 },
  { x: -7.5, z: -13.3 }, { x: 9.8, z: -16.3 }, { x: -12.9, z: -10.6 },
  { x: 2.5, z: -22.1 }, { x: -8.8, z: -28 }, { x: 7.8, z: -32.2 }, { x: -14, z: -31 }
];
const locations: Record<string, Obstacle[]> = {
  pond: [
    { x: -9, z: -7, radius: 3.7, kind: 'island', angle: .2 },
    { x: 7.6, z: -10.3, radius: 3.1, kind: 'wreck', angle: -.9 },
    { x: -3.9, z: -17, radius: 3.2, kind: 'island', angle: -.4 },
    { x: 13.3, z: -23.6, radius: 4, kind: 'island', angle: .8 },
    { x: -12.8, z: -24.8, radius: 3.1, kind: 'wreck', angle: .4 },
    { x: .5, z: -30, radius: 4.6, kind: 'island', angle: .7 }
  ],
  temple: [
    { x: -8, z: -9, radius: 3.8, kind: 'ruins', angle: .3 },
    { x: 8.8, z: -8.6, radius: 3.8, kind: 'island', angle: .2 },
    { x: 1.4, z: -16.5, radius: 4.6, kind: 'ruins', angle: .4 },
    { x: -13.1, z: -22, radius: 3.4, kind: 'wreck', angle: .1 },
    { x: 11.5, z: -22.5, radius: 3.4, kind: 'ruins', angle: -.2 },
    { x: -2.7, z: -30.9, radius: 4.9, kind: 'ruins', angle: .8 }
  ]
};

export const obstaclesFor = (zone: string) => locations[zone] ?? locations.pond;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const between = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

function inside({ x, z }: Point, margin: number) {
  return x >= bounds.left + margin && x <= bounds.right - margin
    && z >= bounds.far + margin && z <= bounds.near - margin;
}

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

function clear(a: Point, b: Point, obstacles: Obstacle[], margin: number) {
  return inside(b, margin) && obstacles.every(item => contact(a, b, item, item.radius + margin) === Infinity);
}

export class Expedition extends Pond {
  readonly helm = new Set<string>();
  position: Point = { x: 1, z: 0 };
  heading = .45;
  velocity: Point = { x: 0, z: 0 };
  schools: School[] = [];
  fishingSpot: School | null = null;
  castPoint: Point | null = null;
  missedCast: MissedCast | null = null;
  monster: Monster | null = null;
  aiming = false;
  drawing = false;
  charge = 0;
  target: Point | null = null;
  arrow: Arrow | null = null;
  impact: Impact | null = null;
  private schoolTimer = 0;
  private monsterTimer = 0;
  private schoolId = 1;
  private castChargeAge = 0;

  get obstacles() {
    return obstaclesFor(this.run?.zone.id ?? 'pond');
  }

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
    const open = clear(this.position, point, this.obstacles, 0);
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
    this.heading = Math.atan2(this.position.x - point.x, this.position.z - point.z);
    this.cast({ angle: 0, depth: .52 });
    if (this.run.cast) this.run.cast.hasBite = true;
    this.run.distance = distance(this.position, point);
  }

  override start(id: string) {
    if (!super.start(id)) return false;
    this.position = { x: 1, z: 0 };
    this.heading = .45;
    this.helm.clear();
    this.velocity = { x: 0, z: 0 };
    this.schools = [];
    this.fishingSpot = null;
    this.castPoint = null;
    this.missedCast = null;
    this.monster = null;
    this.aiming = false;
    this.abortDraw();
    this.arrow = null;
    this.impact = null;
    this.schoolTimer = 7;
    this.monsterTimer = this.balance.wrath.firstAttack;
    this.schoolId = 1;
    for (const site of schoolSites.slice(0, 2)) this.schools.push({ ...site, id: this.schoolId++ });
    this.replenishSchool();
    return true;
  }

  override spawnHotspots() {
    // The 3D expedition owns persistent schools in world space.
  }

  private replenishSchool() {
    const available = schoolSites.filter(site => clear(site, site, this.obstacles, .55)
      && this.schools.every(school => distance(site, school) > 1));
    const nearby = available.filter(site => distance(this.position, site) < 14);
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
    if (this.drawing && !this.aiming) return;
    const side = Number(this.helm.has('east')) - Number(this.helm.has('west'));
    const north = Number(this.helm.has('north')) - Number(this.helm.has('south'));
    const speed = this.drawing ? 2 : 4.65;
    const scale = speed / (Math.hypot(side, north) || 1) / Math.hypot(waterCamera.x, waterCamera.z);
    const ease = 1 - Math.exp(-dt * 9);
    this.velocity.x += ((side * waterCamera.z - north * waterCamera.x) * scale - this.velocity.x) * ease;
    this.velocity.z += ((-side * waterCamera.x - north * waterCamera.z) * scale - this.velocity.z) * ease;
    for (const axis of ['x', 'z'] as const) {
      const next = { ...this.position, [axis]: this.position[axis] + this.velocity[axis] * dt };
      if (clear(this.position, next, this.obstacles, 1.25)) this.position = next;
      else this.velocity[axis] = 0;
    }
    if (Math.hypot(this.velocity.x, this.velocity.z) > .25) {
      const delta = Math.atan2(-this.velocity.x, -this.velocity.z) - this.heading;
      this.heading += Math.atan2(Math.sin(delta), Math.cos(delta)) * Math.min(1, dt * 10);
    }
  }

  private spawnMonster() {
    const offset = this.random() * Math.PI * 2;
    for (let i = 0; i < 12; i += 1) {
      const angle = offset + i * Math.PI / 6;
      const point = { x: this.position.x + Math.cos(angle) * 8.5, z: this.position.z + Math.sin(angle) * 8.5 };
      if (!clear(point, this.position, this.obstacles, .3) || !inside(point, .45)) continue;
      this.monster = { ...point, age: 0, windup: 0, steering: 0 };
      this.tell('Прислужник поднялся из воды. Достань лук.');
      return;
    }
    this.monsterTimer = 1;
  }

  private resetMonster() {
    this.monster = null;
    this.monsterTimer = this.balance.wrath.attackInterval + this.random() * this.balance.wrath.attackSpread * .6;
  }

  private moveMonster(dt: number) {
    const monster = this.monster;
    const run = this.run;
    if (!monster || !run) return;
    monster.age += dt;
    if (monster.age < .78) return;
    if (distance(monster, this.position) < 1.65) {
      monster.windup += dt;
      if (monster.windup >= .74) {
        run.health -= this.balance.wrath.attackDamage;
        this.resetMonster();
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
    const blocked = !clear(monster, this.position, this.obstacles, .3);
    if (!blocked) monster.steering = 0;
    for (const offset of blocked ? [turn * .76, turn * 1.48, turn * 2.15, -turn * .76, -turn * 1.48] : [0]) {
      const next = { x: monster.x + Math.cos(direction + offset) * step, z: monster.z + Math.sin(direction + offset) * step };
      if (!clear(monster, next, this.obstacles, .3)) continue;
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
    if (!arrow) return;
    const previous = between(arrow.start, arrow.end, arrow.age / arrow.travel);
    arrow.age = Math.min(arrow.travel, arrow.age + dt);
    const next = between(arrow.start, arrow.end, arrow.age / arrow.travel);
    const monster = this.monster;
    const enemyHit = monster ? contact(previous, next, monster, .82) : Infinity;
    const obstruction = Math.min(...this.obstacles.map(item => contact(previous, next, item, item.radius)));
    const hit = enemyHit <= 1 && enemyHit < obstruction;
    if (hit) this.resetMonster();
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
