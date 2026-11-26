import { artelBuildings, artelObjectives, catchBonus, countFish, harborResearch, holdPrices, readArtelSave, rodPrices, withBonus, type ArtelBuilding, type ArtelSave, type ArtelTask, type Stock } from './artel';
import { Pond } from './rules/game.js';
import { cargoCells, rotateCargo, type Cargo } from './cargo';
import { enemyHitRadius, enemyLineup, enemyNames, enemyTiming, type EnemyEncounter, type EnemyExit } from './enemies';
import { Polyphemus, readPolyphemusSave, type FishStake, type PolyphemusSave } from './polyphemus/rules';
import { LocationNavigation, worldHeading, worldPoint, type LocationLayout, type LocationSlot, type Point } from './location-navigation';
import { SeaWaves } from './sea-waves';

export type { Point } from './location-navigation';
type School = Point & { id: number; expiresAt?: number };
type Arrow = { start: Point; end: Point; age: number; travel: number };
type MissedCast = { start: Point; end: Point; age: number };
type Impact = Point & { hit: boolean; age: number };

export const waterCamera = { x: 11, y: 19, z: 19 };
export const schoolRadius = 1.15;
export const scareRadius = 2.55;
export const dockRadius = 3.2;
export const actionCost = 40;
const staminaRecovery = 16;
const dashDuration = .46;
const dashMultiplier = 2.55;
const ordinarySchoolLimit = 4;
export const schoolLimit = ordinarySchoolLimit + 1;
const specialSchool = { firstAt: 28, lifetime: 16, cooldown: 28, spawnRetry: 3, enemyChance: .4 };
const baseCastReach = 10;
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

type ExpeditionMeta = PolyphemusSave & {
  artel: ArtelSave;
  gold: number;
  xp: number;
  sales: Stock;
  boat: boolean;
  line: boolean;
  offerings: number;
  quotaMet: boolean;
  visitedTemple: boolean;
};

export class Expedition extends Pond {
  declare meta: ExpeditionMeta;
  readonly polyphemus: Polyphemus;
  readonly recoveredStake: boolean;

  constructor(meta?: Partial<ExpeditionMeta>, random = Math.random) {
    super({ ...meta, ...readPolyphemusSave(meta), artel: readArtelSave(meta) }, random);
    this.balance.wrath.rising = 50;
    this.balance.wrath.wrath = 90;
    this.polyphemus = new Polyphemus(this.meta, id => this.balance[id].value, random, stake => {
      if (stake.condition !== 0) return;
      const { landedCatch } = this.meta.artel;
      const index = landedCatch.findIndex(lot => (lot.stock[stake.id] ?? 0) > 0);
      if (index < 0) return;
      const lot = landedCatch[index];
      const remaining = (lot.stock[stake.id] ?? 0) - 1;
      if (remaining > 0) lot.stock[stake.id] = remaining;
      else delete lot.stock[stake.id];
      if (!countFish(lot.stock)) landedCatch.splice(index, 1);
    });
    this.recoveredStake = this.polyphemus.recover();
  }

  private baseValue(stock: Stock) {
    return (Object.keys(stock) as FishStake['id'][]).reduce((sum, id) => sum + this.balance[id].value * (stock[id] ?? 0), 0);
  }

  get saleValue() {
    const base = this.polyphemus.inventory().reduce((sum, item) => sum + item.price * item.count, 0);
    return base + this.meta.artel.landedCatch.reduce((sum, lot) => {
      const value = this.baseValue(lot.stock);
      return sum + withBonus(value, lot.bonus) - value;
    }, 0);
  }

  salePrice(stake: FishStake) {
    const { id, condition } = stake;
    const price = this.polyphemus.price(stake);
    const lot = condition === 0 ? this.meta.artel.landedCatch.find(item => (item.stock[id] ?? 0) > 0) : undefined;
    if (!lot) return price;
    const value = this.baseValue(lot.stock);
    return withBonus(value, lot.bonus) - withBonus(value - price, lot.bonus);
  }

  private settleSale(base: number, price: number) {
    const repayment = Math.min(this.meta.artel.repairDebt, price);
    this.meta.artel.repairDebt -= repayment;
    this.meta.gold += price - base - repayment;
    return price - repayment;
  }

  override sell() {
    if (this.run || this.polyphemus.round) return 0;
    const price = this.saleValue;
    const base = this.polyphemus.sell();
    this.meta.artel.landedCatch = [];
    return this.settleSale(base, price);
  }

  sellStake(stake: FishStake) {
    if (this.run || this.polyphemus.round
      || !this.polyphemus.inventory().some(item => item.id === stake.id && item.condition === stake.condition)) return 0;
    const price = this.salePrice(stake);
    return this.settleSale(this.polyphemus.sell(stake), price);
  }

  get maxHull() {
    return this.balance.wrath.health + this.meta.artel.buildings.station - 1;
  }

  get hull() {
    return Math.min(this.maxHull, this.meta.artel.hull ?? this.maxHull);
  }

  get repairPrice() {
    return Math.ceil(this.maxHull - this.hull) * 5;
  }

  get rodPrice() {
    const { rod, buildings } = this.meta.artel;
    return rod + 1 < buildings.market ? rodPrices[rod] ?? null : null;
  }

  get holdPrice() {
    const { holdLevel, buildings } = this.meta.artel;
    return holdLevel < buildings.station ? holdPrices[holdLevel] ?? null : null;
  }

  get artelTasks() {
    const { progress, claimed } = this.meta.artel;
    return (Object.keys(artelObjectives) as ArtelTask[]).map(id => ({
      id, ...artelObjectives[id], progress: progress[id], claimed: claimed.includes(id),
    }));
  }

  artelUpgradePrice(id: ArtelBuilding) {
    return artelBuildings[id].prices[this.meta.artel.buildings[id]] ?? null;
  }

  researchPrice(id: LocationSlot) {
    return id === 'temple' && this.meta.artel.buildings.observatory > 0 && !this.unlocked(id) ? harborResearch : null;
  }

  unlocked(id: LocationSlot) {
    return this.meta.artel.unlocked.includes(id);
  }

  override canStart(id: string) {
    return this.unlocked(id as LocationSlot) && this.hull > 0;
  }

  private pay(price: number | null) {
    if (price === null || this.run || this.polyphemus.round || this.meta.gold < price) return false;
    this.meta.gold -= price;
    return true;
  }

  buildArtel(id: ArtelBuilding) {
    return this.meta.artel.buildings[id] === 0 && this.upgradeArtel(id);
  }

  upgradeArtel(id: ArtelBuilding) {
    if (!Object.hasOwn(artelBuildings, id)) return false;
    const hull = this.hull;
    const max = this.maxHull;
    if (!this.pay(this.artelUpgradePrice(id))) return false;
    this.meta.artel.buildings[id] += 1;
    if (id === 'station') this.meta.artel.hull = hull + this.maxHull - max;
    return true;
  }

  repairHull() {
    const price = this.repairPrice;
    if (!price || this.run || this.polyphemus.round) return false;
    if (!this.pay(price)) {
      if (this.hull > 0) return false;
      this.meta.artel.repairDebt += price - this.meta.gold;
      this.meta.gold = 0;
    }
    this.meta.artel.hull = this.maxHull;
    return true;
  }

  buyRod() {
    if (!this.pay(this.rodPrice)) return false;
    this.meta.artel.rod += 1;
    return true;
  }

  expandHold() {
    if (!this.pay(this.holdPrice)) return false;
    this.meta.artel.holdLevel += 1;
    return true;
  }

  researchLocation(id: LocationSlot) {
    if (!this.pay(this.researchPrice(id))) return false;
    this.meta.artel.unlocked.push(id);
    return true;
  }

  claimTask(id: string) {
    const task = this.artelTasks.find(item => item.id === id);
    if (!task || task.claimed || task.progress < task.target || this.run || this.polyphemus.round) return false;
    this.meta.artel.claimed.push(task.id);
    this.meta.gold += task.reward;
    return true;
  }

  recordArtelTask(id: ArtelTask, amount = 1) {
    const progress = this.meta.artel.progress;
    progress[id] = Math.min(artelObjectives[id].target, progress[id] + amount);
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
  stamina = 100;
  private recoveryDelay = 0;
  private dashTime = 0;
  private dashDirection: Point = { x: 0, z: -1 };
  target: Point | null = null;
  arrow: Arrow | null = null;
  impact: Impact | null = null;
  private moveTarget: Point | null = null;
  private schoolTimer = 0;
  private nextSpecialSchoolAt = specialSchool.firstAt;
  private monsterTimer = 0;
  private monsterIndex = 0;
  private readonly seaWaves = new SeaWaves(this.random);
  private schoolId = 1;
  private castChargeAge = 0;
  private returnPose: { position: Point; heading: number } | null = null;
  private navigation: LocationNavigation | null = null;
  private schoolSites: Point[] = [];

  get waves() {
    return this.seaWaves.active;
  }

  get returnPoint() {
    return this.returnPose?.position ?? null;
  }

  get atReturnPoint() {
    const point = this.returnPoint;
    return Boolean(point && distance(this.position, point) <= dockRadius
      && this.navigation?.clear(this.position, point));
  }

  get castReach() {
    return baseCastReach + this.meta.artel.rod * 1.5;
  }

  private hasStamina() {
    if (this.stamina >= actionCost) return true;
    this.tell('Нужно 40% выносливости.');
    return false;
  }

  private spendStamina() {
    if (!this.hasStamina()) return false;
    this.stamina -= actionCost;
    this.recoveryDelay = .45;
    return true;
  }

  dash() {
    if (this.run?.phase !== 'ready' || this.drawing || this.aiming || this.dashTime > 0 || !this.spendStamina()) return false;
    const { x, z } = this.velocity;
    const length = Math.hypot(x, z);
    this.dashDirection = length > .25 ? { x: x / length, z: z / length }
      : { x: -Math.sin(this.heading), z: -Math.cos(this.heading) };
    this.dashTime = dashDuration;
    return true;
  }

  damageHull(amount: number, message: string) {
    const run = this.run;
    if (!run || amount <= 0) return false;
    run.health = Math.max(0, run.health - amount);
    this.meta.artel.hull = run.health;
    this.tell(message);
    this.emit('injury');
    if (run.health <= 0) this.finish('health');
    return !this.run;
  }

  override step(dt: number) {
    if (!this.run || this.run.phase === 'pack') return;
    this.stamina = Math.min(100, this.stamina + Math.max(0, dt - this.recoveryDelay) * staminaRecovery);
    this.recoveryDelay = Math.max(0, this.recoveryDelay - dt);
    super.step(dt);
  }

  override advanceWrath(dt: number) {
    const before = this.stage;
    const ended = super.advanceWrath(dt * (1 - this.meta.artel.buildings.shrine * .1));
    if (!ended && this.stage !== before) {
      this.tell(this.stage === 2 ? 'Из воды поднимаются морские чудовища.' : 'Гнев достиг 90%. Пора к причалу.', 4);
    }
    return ended;
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
    const point = this.chargedPoint(castMinimum, this.castReach);
    return point ? this.previewCastAt(point) : null;
  }

  private previewCastAt(point: Point) {
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

  setMoveTarget(point: Point): boolean {
    if (this.run?.phase !== 'ready' || this.aiming || this.drawing
      || !Number.isFinite(point.x) || !Number.isFinite(point.z) || !this.navigation?.clear(point, point)) return false;
    this.moveTarget = { ...point };
    return true;
  }

  clearMoveTarget(): void {
    if (!this.moveTarget) return;
    this.moveTarget = null;
    this.velocity = { x: 0, z: 0 };
  }

  beginCast() {
    if (this.run?.phase !== 'ready' || this.aiming || this.drawing || this.dashTime > 0 || !this.hasStamina()) return false;
    this.clearMoveTarget();
    this.drawing = true;
    this.charge = 0;
    this.castChargeAge = 0;
    this.velocity = { x: 0, z: 0 };
    return true;
  }

  releaseCast() {
    if (!this.drawing || this.aiming || this.run?.phase !== 'ready') return;
    const point = this.chargedPoint(castMinimum, this.castReach);
    this.abortDraw();
    if (point) this.launchCast(point);
  }

  castAt(point: Point): boolean {
    if (this.run?.phase !== 'ready' || this.aiming || this.drawing) return false;
    const range = distance(this.position, point);
    if (!Number.isFinite(range)) return false;
    if (range >= castMinimum && range <= this.castReach) return this.launchCast({ ...point });

    // Tapping the edge of a reachable school can fall just outside the rod's range.
    const { school } = this.previewCastAt(point);
    if (school) {
      const schoolRange = distance(this.position, school);
      if (schoolRange >= castMinimum && schoolRange <= this.castReach) {
        return this.launchCast({ x: school.x, z: school.z });
      }
    }
    this.tell(range < castMinimum ? 'Цель слишком близко для заброса.' : 'Цель вне дальности заброса.');
    return false;
  }

  private launchCast(point: Point): boolean {
    const run = this.run;
    if (run?.phase !== 'ready' || this.dashTime > 0) return false;
    if (this.missedCast && this.missedCast.age < this.balance.aim.flight) return false;
    const { open, school } = this.previewCastAt(point);
    if (!open) {
      this.tell('Заброс перекрыт. Выбери открытый участок воды.');
      return false;
    }
    if (!this.spendStamina()) return false;
    this.clearMoveTarget();
    this.velocity = { x: 0, z: 0 };
    if (!school) {
      this.missedCast = { start: { ...this.position }, end: point, age: 0 };
      this.tell('Заброс мимо рыбного места.');
      return true;
    }
    this.missedCast = null;
    this.castPoint = point;
    this.fishingSpot = school;
    this.turnBoatTowards(Math.atan2(this.position.x - point.x, this.position.z - point.z), 1);
    this.cast({ angle: 0, depth: .52 });
    if (run.cast) run.cast.hasBite = true;
    if (school.expiresAt !== undefined) {
      run.selected = 'crown';
      this.tell(this.stage >= 2 ? 'Особый косяк может привлечь чудовище.' : 'Попадание в особый косяк.');
    } else if (run.selected === 'crown') {
      run.selected = this.random() < this.balance.loot.viperShare ? 'viper' : 'oracle';
    }
    run.distance = distance(this.position, point);
    return true;
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
      || !(castRange >= castMinimum && castRange <= this.castReach) || !navigation.clear(spawn.position, firstSchool)) {
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
    this.stamina = 100;
    this.recoveryDelay = 0;
    this.dashTime = 0;
    const run = this.run!;
    run.health = this.hull;
    run.grid.columns += this.meta.artel.holdLevel;
    this.heading = spawn.heading;
    this.helm.clear();
    this.clearMoveTarget();
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
    this.nextSpecialSchoolAt = specialSchool.firstAt;
    this.monsterTimer = this.balance.wrath.firstAttack;
    this.seaWaves.reset(id as LocationSlot);
    this.replenishSchool();
    this.replenishSchool();
    return true;
  }

  override finish(reason = 'return') {
    const run = this.run;
    if (!run || (reason === 'return' && (run.phase !== 'ready' || run.wrath >= 100 || !this.atReturnPoint))) return;
    const stock: Stock = {};
    for (const item of run.cargo) stock[item.id] = (stock[item.id] ?? 0) + item.count;
    const count = countFish(stock);
    const baseValue = this.baseValue(stock);
    const bonus = catchBonus(count);
    const xp = run.cargo.reduce((sum, item) => sum + this.balance[item.id].xp * item.count, 0);
    const success = reason === 'return';
    this.meta.artel.hull = run.health;
    if (success) {
      this.meta.xp += xp;
      for (const id of Object.keys(stock) as FishStake['id'][]) {
        this.meta.sales[id] = (this.meta.sales[id] ?? 0) + (stock[id] ?? 0);
      }
      if (bonus) this.meta.artel.landedCatch.push({ stock, bonus });
      this.recordArtelTask('land', count);
      if (run.zone.id === 'temple') this.recordArtelTask('explore');
      if (this.returnPose) {
        this.position = this.returnPose.position;
        this.heading = this.returnPose.heading;
      }
    }
    this.result = {
      reason, success, value: withBonus(baseValue, bonus), xp, count, score: this.score,
      lostPending: Boolean(run.pending), stage: this.stage, zone: run.zone.id,
    };
    this.run = null;
    this.seaWaves.clear();
    this.inputs.clear();
    this.helm.clear();
    this.clearMoveTarget();
    this.abortDraw();
    this.returnPose = null;
    this.navigation = null;
    this.schoolSites = [];
    this.emit('finish', { success });
  }

  override spawnHotspots() {
    // The 3D expedition owns persistent schools in world space.
  }

  private replenishSchool(expiresAt?: number, avoid?: Point): boolean {
    const navigation = this.navigation;
    if (!navigation) return false;
    const available = this.schoolSites.filter(site => distance(this.position, site) > scareRadius + .15
      && (!avoid || distance(avoid, site) > scareRadius)
      && this.schools.every(school => distance(site, school) > schoolRadius * 2));
    const nearby = available.filter(site => {
      const range = distance(this.position, site);
      return range >= castMinimum && range <= this.castReach && navigation.clear(this.position, site);
    });
    const options = nearby.length || expiresAt !== undefined ? nearby : available;
    if (!options.length) return false;
    const site = options[Math.floor(this.random() * options.length)];
    this.schools.push({ ...site, id: this.schoolId++, expiresAt });
    return true;
  }

  private relocateSchool(school: School) {
    const index = this.schools.indexOf(school);
    if (index < 0 || school === this.fishingSpot) return false;
    this.schools.splice(index, 1);
    if (this.replenishSchool(school.expiresAt, school)) return true;
    this.schools.splice(index, 0, school);
    return false;
  }

  private scareNearbySchools() {
    let moved = false;
    for (const school of [...this.schools]) {
      if (distance(this.position, school) <= scareRadius) moved = this.relocateSchool(school) || moved;
    }
    if (moved) this.tell('Лодка спугнула косяк.');
  }

  private updateSpecialSchool() {
    const run = this.run;
    if (!run) return;
    const expired = this.schools.findIndex(school => school.expiresAt !== undefined && run.time >= school.expiresAt);
    if (expired >= 0) this.schools.splice(expired, 1);
    if (run.time < this.nextSpecialSchoolAt || run.phase !== 'ready') return;

    const expiresAt = run.time + specialSchool.lifetime;
    if (!this.replenishSchool(expiresAt)) {
      this.nextSpecialSchoolAt = run.time + specialSchool.spawnRetry;
      return;
    }
    this.nextSpecialSchoolAt = expiresAt + specialSchool.cooldown;
    this.tell(this.stage >= 2
      ? 'Фиолетовый косяк: редкий улов может привлечь чудовище.'
      : 'В фиолетовом косяке можно выловить Венец глубин.', 5);
  }

  override primary() {
    if (this.run?.phase === 'hook' && !this.aiming) super.primary();
  }

  override hook() {
    super.hook();
    if (this.run?.phase === 'struggle' && this.stage >= 2 && this.fishingSpot?.expiresAt !== undefined
      && !this.monster && this.random() < specialSchool.enemyChance) {
      this.spawnMonster(true);
    }
  }

  override miss(message: string, sound?: string) {
    this.fishingSpot = null;
    this.castPoint = null;
    super.miss(message, sound);
  }

  override applyCatchEffects() {
    // The expedition's hull damage and wrath come from time and sea hazards.
  }

  override land() {
    const school = this.fishingSpot;
    this.fishingSpot = null;
    this.castPoint = null;
    if (school) this.relocateSchool(school);
    super.land();
  }

  get cargoLoad() {
    const run = this.run;
    if (!run) return 0;
    const occupied = run.cargo.reduce((sum, item) => sum + cargoCells(item).length, 0);
    return occupied / (run.grid.columns * run.grid.rows);
  }

  override fits(item: Cargo, x: number, y: number, ignored?: number) {
    const run = this.run;
    if (!run || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    const cells = cargoCells(item, x, y);
    const { columns, rows } = run.grid;
    if (cells.some(cell => cell.x < 0 || cell.y < 0 || cell.x >= columns || cell.y >= rows)) return false;
    return !run.cargo.some(other => other.key !== ignored && cargoCells(other).some(
      occupied => cells.some(cell => cell.x === occupied.x && cell.y === occupied.y),
    ));
  }

  override rotate() {
    const pending = this.run?.pending;
    if (pending) Object.assign(pending, rotateCargo(pending));
  }

  moveCargo(key: number, rotation: number, x: number, y: number) {
    const current = this.run?.cargo.find(item => item.key === key);
    if (!current || !Number.isInteger(rotation) || rotation < 0 || rotation > 3) return false;
    const draft = { ...current, x, y, turned: rotation % 2 === 1, rotation };
    if (!this.fits(draft, x, y, key)) return false;
    Object.assign(current, draft);
    this.emit('cargo');
    return true;
  }

  toggleBow() {
    if (!this.run || ['surge', 'pack'].includes(this.run.phase)) return;
    this.clearMoveTarget();
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

  beginBow() {
    if (!this.run || ['pack', 'surge'].includes(this.run.phase) || this.drawing || this.arrow || this.dashTime > 0
      || !this.hasStamina()) return false;
    if (!this.aiming) this.toggleBow();
    return this.beginDraw();
  }

  beginDraw() {
    if (!this.aiming || this.drawing || this.arrow || !this.run || this.run.phase === 'surge'
      || this.run.phase === 'pack' || !this.hasStamina()) return false;
    this.drawing = true;
    this.charge = 0;
    return true;
  }

  releaseArrow() {
    if (!this.drawing) return;
    const end = this.shotEnd;
    if (end && this.charge >= .12) {
      this.launchArrow(end);
    } else {
      this.tell('Удерживай ПКМ, чтобы натянуть лук.');
    }
    const pointer = this.target;
    this.abortDraw();
    this.target = pointer;
  }

  shootAt(point: Point): boolean {
    if (!this.aiming || this.drawing || this.arrow || !this.run || this.run.phase === 'surge'
      || this.run.phase === 'pack' || !this.hasStamina()) return false;
    const range = distance(this.position, point);
    if (!Number.isFinite(range)) return false;
    if (range > reach) {
      this.tell('Цель вне дальности лука.');
      return false;
    }
    if (!this.navigation?.clear(point, point)) {
      this.tell('Выбери цель на воде.');
      return false;
    }
    return this.launchArrow({ ...point });
  }

  private launchArrow(end: Point) {
    if (!this.spendStamina()) return false;
    this.arrow = { start: { ...this.position }, end, age: 0, travel: .15 + distance(this.position, end) * .026 };
    return true;
  }

  private moveBoat(dt: number) {
    if (this.run?.phase !== 'ready') return;
    const navigation = this.navigation;
    if (!navigation || (this.drawing && !this.aiming)) return;
    const side = Number(this.helm.has('east')) - Number(this.helm.has('west'));
    const north = Number(this.helm.has('north')) - Number(this.helm.has('south'));
    const stationSpeed = 1 + (this.meta.artel.buildings.station - 1) * .12;
    const speed = (this.drawing ? 2 : 4.65) * stationSpeed * (1 - this.cargoLoad * .3);
    if (this.dashTime > 0) {
      const { x, z } = this.dashDirection;
      const boost = speed * dashMultiplier;
      this.dashTime = Math.max(0, this.dashTime - dt);
      const moved = this.shiftBoat({ x: this.position.x + x * boost * dt, z: this.position.z + z * boost * dt }, navigation);
      this.velocity = moved ? { x: x * boost, z: z * boost } : { x: 0, z: 0 };
      if (!moved) this.dashTime = 0;
      this.turnBoatTowards(Math.atan2(-x, -z), Math.min(1, dt * 10));
      return;
    }
    if (side || north) this.clearMoveTarget();
    const ease = 1 - Math.exp(-dt * 9);
    if (this.moveTarget) {
      const target = this.moveTarget;
      const range = distance(this.position, target);
      if (range <= .08) {
        this.clearMoveTarget();
        return;
      }
      const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const nextSpeed = currentSpeed + (speed - currentSpeed) * ease;
      const direction = { x: (target.x - this.position.x) / range, z: (target.z - this.position.z) / range };
      const next = between(this.position, target, Math.min(1, nextSpeed * dt / range));
      if (!this.shiftBoat(next, navigation)) {
        this.clearMoveTarget();
        return;
      }
      this.velocity = { x: direction.x * nextSpeed, z: direction.z * nextSpeed };
      this.turnBoatTowards(Math.atan2(-direction.x, -direction.z), Math.min(1, dt * 10));
      return;
    }

    const scale = speed / (Math.hypot(side, north) || 1) / Math.hypot(waterCamera.x, waterCamera.z);
    this.velocity.x += ((side * waterCamera.z - north * waterCamera.x) * scale - this.velocity.x) * ease;
    this.velocity.z += ((-side * waterCamera.x - north * waterCamera.z) * scale - this.velocity.z) * ease;
    for (const axis of ['x', 'z'] as const) {
      const next = { ...this.position, [axis]: this.position[axis] + this.velocity[axis] * dt };
      if (!this.velocity[axis]) continue;
      if (!this.shiftBoat(next, navigation)) this.velocity[axis] = 0;
    }
    if (Math.hypot(this.velocity.x, this.velocity.z) > .25) {
      this.turnBoatTowards(Math.atan2(-this.velocity.x, -this.velocity.z), Math.min(1, dt * 10));
    }
  }

  private shiftBoat(next: Point, navigation: LocationNavigation): boolean {
    const [bow, stern] = hullSpine(this.position, this.heading);
    const [nextBow, nextStern] = hullSpine(next, this.heading);
    // The frame's sweep is checked at the two ends and across the destination hull.
    if (!navigation.clear(bow, nextBow, boatClearance) || !navigation.clear(stern, nextStern, boatClearance)
      || !navigation.clear(nextBow, nextStern, boatClearance)) return false;
    this.position = next;
    return true;
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

  private spawnMonster(fromSpecialSchool = false) {
    const navigation = this.navigation;
    const run = this.run;
    if (!navigation || !run) return;
    const lineup = enemyLineup[run.zone.id as keyof typeof enemyLineup];
    const offset = this.random() * Math.PI * 2;
    for (const range of fromSpecialSchool ? [8.5, 6] : [8.5]) {
      for (let i = 0; i < 12; i += 1) {
        const angle = offset + i * Math.PI / 6;
        const point = { x: this.position.x + Math.cos(angle) * range, z: this.position.z + Math.sin(angle) * range };
        if (!navigation.clear(point, point, .45) || !navigation.clear(point, this.position, .3)) continue;
        const kind = lineup[this.monsterIndex % lineup.length];
        this.monsterIndex += 1;
        this.monster = {
          ...point, kind, age: 0, windup: 0, steering: 0, moving: false,
          heading: Math.atan2(this.position.x - point.x, this.position.z - point.z),
        };
        this.tell(fromSpecialSchool
          ? `Особый косяк привлёк прислужника — ${enemyNames[kind]}.`
          : `Из воды поднялся прислужник Посейдона — ${enemyNames[kind]}.`);
        return;
      }
    }
    if (!fromSpecialSchool) this.monsterTimer = 1;
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
        this.resetMonster(monster, 'attack');
        this.cancel();
        this.damageHull(this.balance.wrath.attackDamage, 'Прислужник ударил по лодке.');
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
    if (hit && monster) {
      this.resetMonster(monster, 'defeat');
      this.recordArtelTask('defend');
      this.emit('artel-progress');
    }
    const at = Math.min(enemyHit, obstruction, 1);
    if (hit || obstruction <= 1 || arrow.age >= arrow.travel) {
      this.impact = { ...between(previous, next, at), age: 0, hit };
      this.arrow = null;
      this.tell(hit ? 'Попадание. Прислужник утонул.' : 'Промах.');
    }
  }

  override updateThreat(dt: number) {
    if (this.advanceWrath(dt)) {
      this.seaWaves.clear();
      this.clearMoveTarget();
      this.aiming = false;
      this.abortDraw();
      this.arrow = null;
      this.missedCast = null;
      this.monster = null;
      this.monsterExit = null;
      return true;
    }
    if (this.missedCast) {
      const { age, end } = this.missedCast;
      this.missedCast.age += dt;
      if (age < this.balance.aim.flight && this.missedCast.age >= this.balance.aim.flight) {
        let moved = false;
        for (const school of [...this.schools]) {
          if (distance(end, school) <= scareRadius) moved = this.relocateSchool(school) || moved;
        }
        if (moved) this.tell('Поплавок упал рядом и спугнул косяк.');
      }
      if (this.missedCast.age >= this.balance.aim.flight + .4) this.missedCast = null;
    }
    if (this.drawing) {
      if (this.aiming) this.charge = Math.min(1, this.charge + dt / .78);
      else {
        this.castChargeAge = (this.castChargeAge + dt) % (2 * castChargeTime);
        this.charge = 1 - Math.abs(1 - this.castChargeAge / castChargeTime);
      }
    }
    const positionBeforeMove = this.position;
    this.moveBoat(dt);
    const run = this.run;
    if (!run) return true;
    if (this.navigation) {
      this.seaWaves.step(dt, run.wrath, run.zone.id as LocationSlot, this.navigation, positionBeforeMove, {
        position: this.position, heading: this.heading, radius: boatClearance, halfLength: boatSpineHalfLength,
      }, () => this.damageHull(1, 'Волна пробила борт лодки.'));
      if (!this.run) return true;
    }
    if (positionBeforeMove !== this.position) this.scareNearbySchools();
    this.updateSpecialSchool();
    this.schoolTimer -= dt;
    if (this.schoolTimer <= 0) {
      if (this.schools.filter(school => school.expiresAt === undefined).length < ordinarySchoolLimit) this.replenishSchool();
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
