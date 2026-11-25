// Game rules adapted from poseidons-pond/game.js.
import { defaults } from './balance.js';

const zones = [
  { id: 'pond', name: 'Запретный пруд', number: 'I', map: [0.43, 0.38], description: 'Тихая вода за межевыми камнями. Пузырьки выдают рыбу у старого алтаря.' },
  { id: 'temple', name: 'Затопленный храм', number: 'II', map: [0.75, 0.46], description: 'Колонны уходят под воду. Здесь быстрее растёт гнев и чаще попадается редкий улов.' }
];

const fish = {
  mullet: { name: 'Серебряная кефаль', tier: 'Обычная', color: '#b8d2bd' },
  perch: { name: 'Каменный окунь', tier: 'Обычная', color: '#e4bd78' },
  oracle: { name: 'Оракульская рыба', tier: 'Редкая', color: '#76e0cb' },
  viper: { name: 'Рыба с проклятым жалом', tier: 'Редкая', color: '#e29486' },
  crown: { name: 'Венец глубин', tier: 'Мифическая', color: '#efd084' }
};

const counter = { left: 'right', right: 'left' };
const directionX = { left: -1, right: 1 };
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
const lerp = (a, b, p) => a + (b - a) * p;
const pingpong = (time, duration) => 1 - Math.abs((time / duration % 2 + 2) % 2 - 1);

/**
 * @typedef {{ angle: number, depth: number }} Hotspot
 * @typedef {Hotspot & { hotspot: boolean, hasBite: boolean, biteIn: number }} Cast
 * @typedef {{ side: number, grace: number, total: number }} Attack
 * @typedef {{ id: keyof typeof fish, key: number, count: number, x: number, y: number, turned: boolean, size: [number, number] }} Cargo
 */

class Pond {
  constructor(meta, random = Math.random, balance = defaults()) {
    this.balance = balance;
    this.meta = {
      gold: balance.economy.gold, xp: 0, boat: false, line: false, offerings: balance.economy.offerings, quotaMet: false,
      sales: {}, visitedTemple: false, ...meta
    };
    this.random = random;
    this.run = null;
    this.result = null;
    this.inputs = new Set();
    this.events = [];
  }

  emit(name, data = {}) {
    this.events.push({ name, ...data });
  }

  start(id) {
    if (this.run || this.result || (id === 'temple' && !this.meta.boat)) return false;
    const zone = zones.find(item => item.id === id);
    if (!zone) return false;
    this.inputs.clear();
    this.run = {
      zone, time: 0, phase: 'ready', age: 0, wrath: 0, health: this.balance.wrath.health,
      grid: { columns: this.balance.economy.columns, rows: this.balance.economy.rows },
      dog: this.balance.wrath.dogRescues,
      /** @type {Attack | null} */
      attack: null,
      nextAttack: this.balance.wrath.firstAttack,
      aimAngle: -0.72,
      /** @type {Hotspot[]} */
      hotspots: [],
      hotspotAge: 0,
      /** @type {Cast | null} */
      cast: null,
      selected: /** @type {keyof typeof fish | null} */ (null), rod: 0,
      /** @type {Cargo[]} */
      cargo: [],
      /** @type {Cargo | null} */
      pending: null,
      tension: 0, fatigue: 0, distance: 0,
      rounds: 0, turns: 0, direction: 'left', turnAge: 0, turnTime: 0,
      fishX: 0, notice: '', noticeFor: 0, serial: 1
    };
    this.spawnHotspots();
    if (id === 'temple') this.meta.visitedTemple = true;
    this.emit('start');
    return true;
  }

  get stage() {
    const wrath = this.run?.wrath ?? 0;
    const config = this.balance.wrath;
    return wrath >= config.wrath ? 3 : wrath >= config.rising ? 2 : 1;
  }

  get score() {
    return this.run?.cargo.reduce((total, item) => total + this.balance[item.id].points * item.count, 0) ?? 0;
  }

  get firstPerson() {
    return ['cast', 'wait', 'hook', 'struggle', 'reel'].includes(this.run?.phase);
  }

  get marker() {
    return 1 - pingpong(this.run?.age ?? 0, this.balance.bite.markerSweep);
  }

  setPhase(phase) {
    const r = this.run;
    r.phase = phase;
    r.age = 0;
    this.emit('phase', { phase });
  }

  tell(message, duration = 3.3) {
    const r = this.run;
    r.notice = message;
    r.noticeFor = duration;
  }

  spawnHotspots() {
    const r = this.run;
    const side = this.random() < 0.5 ? -1 : 1;
    const { range, spots } = this.balance.aim;
    r.hotspots = Array.from({ length: spots }, (_, index) => ({
      angle: side * (index % 2 === 0 ? 1 : -1) * range * (0.38 + this.random() * 0.45),
      depth: index % 2 === 0 ? 0.48 + this.random() * 0.14 : 0.75 + this.random() * 0.13
    }));
    r.hotspotAge = 0;
  }

  aimHit(point) {
    return Math.abs(point.angle - this.run.aimAngle) <= this.balance.aim.width * this.balance.aim.precision;
  }

  primary() {
    const r = this.run;
    if (!r) return;
    switch (r.phase) {
      case 'ready':
        r.aimAngle = -this.balance.aim.range;
        this.setPhase('aim');
        break;
      case 'aim':
        this.cast();
        break;
      case 'hook':
        this.hook();
        break;
    }
  }

  /** @param {Hotspot | undefined} target */
  cast(target = this.run.hotspots.find(point => this.aimHit(point))) {
    const r = this.run;
    const temple = r.zone.id === 'temple';
    const { aim, bite, loot } = this.balance;
    const hasBite = this.random() < bite.normalChance + (target ? bite.spotChance : 0) + (temple ? bite.templeChance : 0);
    const rare = this.random() < [0, loot.rareCalm, loot.rareRising, loot.rareWrath][this.stage] + (target ? loot.spotRare : 0) + (temple ? loot.templeRare : 0);
    let id = this.random() < loot.mulletShare ? 'mullet' : 'perch';
    if (rare) {
      id = this.stage === 3 ? 'crown' : this.stage === 2 && this.random() < loot.viperShare ? 'viper' : 'oracle';
    }
    r.selected = id;
    r.cast = {
      angle: target?.angle ?? r.aimAngle, depth: target?.depth ?? aim.flatDepth,
      hotspot: !!target, hasBite, biteIn: (target ? bite.spotWait : bite.normalWait) + this.random() * bite.waitSpread
    };
    r.distance = Math.min(this.balance.fight.maxDistance, aim.distance + r.cast.depth * aim.depthDistance);
    r.fishX = 0;
    r.tension = 0;
    r.rounds = 0;
    r.turns = 0;
    this.setPhase('cast');
    this.emit('cast');
    if (target) this.tell('Попадание в рыбное место');
  }

  hook() {
    const hit = this.marker >= this.balance.bite.bandStart && this.marker <= this.balance.bite.bandEnd;
    if (!hit) {
      this.miss('Рано или поздно. Рыба ушла.');
      return;
    }
    this.run.tension = this.balance.bite.startTension;
    this.beginFight();
    this.emit('hook');
  }

  cancel() {
    const r = this.run;
    if (!r || !['aim', 'cast', 'wait', 'hook', 'struggle', 'reel'].includes(r.phase)) return;
    this.miss(r.phase === 'aim' ? 'Заброс отменён.' : 'Снасть убрана. Рыба ушла.');
  }

  miss(message, sound = 'miss') {
    const r = this.run;
    r.cast = null;
    r.selected = null;
    this.setPhase('ready');
    this.tell(message);
    this.emit(sound);
  }

  chooseDirection() {
    const r = this.run;
    r.direction = r.turns ? counter[r.direction] : this.random() < .5 ? 'left' : 'right';
    r.turns += 1;
    r.turnAge = 0;
    r.turnTime = this.balance.fight.turnTime + this.random() * this.balance.fight.turnSpread;
    this.emit('tug', { direction: r.direction });
  }

  beginFight() {
    const r = this.run;
    r.rounds += 1;
    r.fatigue = 0;
    this.chooseDirection();
    this.setPhase('struggle');
  }

  updateFight(dt) {
    const r = this.run;
    const config = this.balance.fight;
    const pull = this.balance[r.selected].pull;
    const steering = Object.values(counter).filter(action => this.inputs.has(action));
    const correct = steering.length === 1 && steering[0] === counter[r.direction];
    const grace = r.turnAge < config.grace;
    const wrong = steering.length > 0 && !correct;
    const winding = this.inputs.has('reel');
    const gain = correct ? -config.correctEase : grace ? config.graceGain : wrong ? config.wrongGain : config.neutralGain;
    const strength = this.meta.line ? config.upgradedLine : 1;
    r.tension = clamp(r.tension + dt * (gain * pull + (winding ? config.earlyReelGain : 0)) * strength, 0, 100);
    r.fatigue += dt * (correct ? config.fatigue / pull : config.passiveFatigue);
    if (!correct && !grace) r.distance = Math.min(config.maxDistance, r.distance + dt * (wrong ? config.wrongDistance : config.neutralDistance));
    r.fishX = lerp(r.fishX, directionX[r.direction], Math.min(1, dt * (correct ? 2.1 : 4.8)));
    r.turnAge += dt;
    if (r.tension >= 100) this.miss('Леска оборвалась.', 'snap');
    else if (r.fatigue >= 1) {
      this.setPhase('reel');
      this.emit('slack');
    } else if (r.turnAge >= r.turnTime) this.chooseDirection();
  }

  land() {
    const r = this.run;
    const f = this.balance[r.selected];
    r.pending = {
      id: r.selected, key: r.serial++, count: 1, x: 0, y: 0, turned: false,
      size: [f.width, f.height]
    };
    r.wrath = Math.min(100, r.wrath + f.wrath);
    if (f.damage > 0) {
      r.health -= f.damage;
      this.tell(fish[r.selected].name + ' ранит Одиссея.');
      this.emit('sting');
    }
    r.cast = null;
    this.setPhase('pack');
    this.emit('catch', { id: r.pending.id });
    if (r.health <= 0) this.finish('health');
  }

  dimensions(item) {
    const [w, h] = item.size;
    return item.turned ? [h, w] : [w, h];
  }

  fits(item, x, y, ignored) {
    const [w, h] = this.dimensions(item);
    if (x < 0 || y < 0 || x + w > this.run.grid.columns || y + h > this.run.grid.rows) return false;
    return this.run.cargo.every(other => {
      if (other.key === ignored) return true;
      const [ow, oh] = this.dimensions(other);
      return x >= other.x + ow || x + w <= other.x || y >= other.y + oh || y + h <= other.y;
    });
  }

  pack(x, y) {
    const r = this.run;
    if (!r?.pending || !this.fits(r.pending, x, y)) return false;
    r.cargo.push({ ...r.pending, x, y });
    this.closePack('Улов в трюме.');
    return true;
  }

  rotate() {
    const pending = this.run?.pending;
    if (pending) pending.turned = !pending.turned;
  }

  stack() {
    const r = this.run;
    const first = r?.cargo.find(item => item.id === r.pending?.id && item.count < this.balance.economy.stackLimit);
    if (!first) return false;
    first.count += 1;
    this.closePack('Одинаковая рыба уложена вместе.');
    return true;
  }

  release(key) {
    const r = this.run;
    if (!r) return;
    if (key === undefined && r.pending) {
      this.closePack('Рыба выпущена.');
      return;
    }
    const index = r.cargo.findIndex(item => item.key === key);
    if (index >= 0) {
      r.cargo.splice(index, 1);
      this.emit('cargo');
    }
  }

  closePack(message) {
    this.run.pending = null;
    this.setPhase('ready');
    this.tell(message);
    this.emit('pack');
  }

  offering() {
    if (!this.run || !this.meta.offerings) return;
    const config = this.balance.wrath;
    const reduction = [0, config.offeringCalm, config.offeringRising, config.offeringWrath][this.stage];
    if (reduction === 0) {
      this.tell('При ярости Посейдон уже не принимает подношения.');
      return;
    }
    if (this.run.wrath < config.offeringMinimum) {
      this.tell('Вода ещё спокойна.');
      return;
    }
    this.meta.offerings -= 1;
    this.run.wrath = Math.max(0, this.run.wrath - reduction);
    this.tell('Посейдон принял подношение.');
    this.emit('offering');
  }

  repel() {
    const r = this.run;
    if (!r?.attack || r.attack.grace <= 0) return;
    r.attack = null;
    r.nextAttack = this.balance.wrath.attackInterval + this.random() * this.balance.wrath.attackSpread;
    this.tell('Прислужник ушёл под воду.');
    this.emit('repel');
  }

  advanceWrath(dt) {
    const r = this.run;
    if (r.phase === 'surge') {
      if (r.age >= this.balance.wrath.finalPause) this.finish('wrath');
      return true;
    }
    const oldStage = this.stage;
    r.wrath = Math.min(100, r.wrath + dt * (r.zone.id === 'temple' ? this.balance.wrath.templeRate : this.balance.wrath.pondRate));
    if (this.stage > oldStage) {
      this.tell(this.stage === 2 ? 'Под водой шевельнулась тень.' : 'Прислужники Посейдона поднялись к лодке.', 4);
      this.emit('wrath', { stage: this.stage });
    }
    if (r.wrath >= 100) {
      r.attack = null;
      this.setPhase('surge');
      this.emit('surge');
      return true;
    }
    return false;
  }

  updateThreat(dt) {
    if (this.advanceWrath(dt)) return true;
    const r = this.run;
    if (r.attack) {
      r.attack.grace -= dt;
      if (r.attack.grace <= 0) {
        r.attack = null;
        r.nextAttack = this.balance.wrath.attackInterval + this.random() * this.balance.wrath.attackSpread;
        if (r.dog) {
          r.dog -= 1;
          this.tell(r.dog ? 'Аргос отогнал прислужника.' : 'Аргос отогнал прислужника. Защита исчерпана.', 5);
          this.emit('dog');
        } else {
          r.health -= this.balance.wrath.attackDamage;
          this.tell('Прислужник ранил Одиссея.');
          this.emit('injury');
        }
        if (r.health <= 0) this.finish('health');
      }
    } else if (this.stage === 3) {
      r.nextAttack -= dt;
      if (r.nextAttack <= 0) {
        r.attack = { side: this.random() < 0.5 ? -1 : 1, grace: this.balance.wrath.attackWindow, total: this.balance.wrath.attackWindow };
        this.emit('warning', { dog: r.dog });
      }
    }
    return !this.run;
  }

  step(dt) {
    const r = this.run;
    if (!r) return;
    r.age += dt;
    r.time += dt;
    r.noticeFor = Math.max(0, r.noticeFor - dt);
    const bend = Number(this.inputs.has('right')) - Number(this.inputs.has('left'));
    r.rod = lerp(r.rod, bend || (r.phase === 'struggle' ? r.fishX * 0.36 : 0), Math.min(1, dt * 9));
    if (this.updateThreat(dt)) return;
    if (r.phase === 'ready') {
      r.hotspotAge += dt;
      if (r.hotspotAge > this.balance.aim.spotRefresh) this.spawnHotspots();
    } else if (r.phase === 'aim') {
      r.aimAngle = lerp(-this.balance.aim.range, this.balance.aim.range, pingpong(r.age, this.balance.aim.sweep));
    } else if (r.phase === 'cast' && r.age >= this.balance.aim.flight) {
      this.setPhase('wait');
      this.emit('splash');
    } else if (r.phase === 'wait' && r.age >= r.cast.biteIn) {
      if (!r.cast.hasBite) this.miss('Поплавок тих. Попробуйте другое место.');
      else {
        this.setPhase('hook');
        this.emit('bite');
      }
    } else if (r.phase === 'hook' && r.age >= this.balance.bite.window) {
      this.miss('Поклёвка пропущена.');
    } else if (r.phase === 'struggle') {
      this.updateFight(dt);
    } else if (r.phase === 'reel') {
      r.tension = Math.max(0, r.tension - dt * this.balance.fight.slackEase);
      r.fishX = lerp(r.fishX, 0, Math.min(1, dt * 3.2));
      if (this.inputs.has('reel')) r.distance = Math.max(0, r.distance - dt * this.balance.fight.reelSpeed / this.balance[r.selected].pull);
      if (r.distance <= this.balance.fight.landingDistance) this.land();
      else if (r.age >= this.balance.fight.reelWindow) this.beginFight();
    }
  }

  finish(reason = 'return') {
    const r = this.run;
    if (!r || (reason === 'return' && r.phase === 'surge')) return;
    const success = reason === 'return' && this.score >= this.balance.economy.quota;
    const value = r.cargo.reduce((sum, item) => sum + this.balance[item.id].value * item.count, 0);
    const xp = r.cargo.reduce((sum, item) => sum + this.balance[item.id].xp * item.count, 0);
    const count = r.cargo.reduce((sum, item) => sum + item.count, 0);
    if (success) {
      this.meta.xp += xp;
      this.meta.quotaMet = true;
      for (const item of r.cargo) this.meta.sales[item.id] = (this.meta.sales[item.id] || 0) + item.count;
    }
    this.result = { reason: reason === 'return' && !success ? 'quota' : reason, success, value, xp, count, score: this.score, lostPending: !!r.pending, stage: this.stage, zone: r.zone.id };
    this.run = null;
    this.inputs.clear();
    this.emit('finish', { success });
  }

  sell() {
    const amount = Object.entries(this.meta.sales).reduce((total, [id, count]) => total + this.balance[id].value * count, 0);
    this.meta.gold += amount;
    this.meta.sales = {};
    return amount;
  }

  buy(id) {
    if (!this.meta.quotaMet || !['boat', 'line', 'offering'].includes(id) || this.meta.gold < this.balance.economy[id]) return false;
    if ((id === 'line' && this.meta.line) || (id === 'boat' && this.meta.boat)) return false;
    this.meta.gold -= this.balance.economy[id];
    if (id === 'offering') this.meta.offerings += 1;
    else this.meta[id] = true;
    this.emit('purchase');
    return true;
  }
}

export { Pond, zones, fish, counter, clamp, lerp };
