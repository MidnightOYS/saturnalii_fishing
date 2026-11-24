import { Pond } from '../../packages/fishing/game.js';
import { at, distance, dock, maps, navigable, tile } from './maps.js';

export const castRange = 8;
const pierRange = 2.4;
export const schoolRadius = 1.12;

export class Expedition extends Pond {
  position = { ...dock };
  travel = { x: 0, y: 0 };
  movement = 0;
  facing = 1;
  castPoint = null;
  activeSchool = null;
  schools = [];
  visit = 0;

  get map() { return maps[this.run?.zone.id ?? this.visitZone ?? 'pond']; }
  get nearDock() { return distance(this.position, dock) <= pierRange; }

  start(id) {
    if (!super.start(id)) return false;
    this.visitZone = id;
    this.visit += 1;
    this.position = { ...dock };
    this.travel = { x: 0, y: 0 };
    this.movement = 0;
    this.facing = 1;
    this.castPoint = null;
    this.activeSchool = null;
    this.schools = this.map.schools.map(([x, y]) => ({ ...at(x, y), availableAt: 0 }));
    return true;
  }

  spawnHotspots() {
    this.run.hotspotAge = 0;
  }

  inspect(point) {
    const range = distance(this.position, point);
    const clear = navigable(this.map, point);
    const school = this.schools.find(item => item.availableAt <= this.run.time && distance(item, point) < schoolRadius);
    return { range, clear, school };
  }

  throwAt(point) {
    if (this.run?.phase !== 'ready') return;
    const { range, clear, school } = this.inspect(point);
    if (!clear || range > castRange || range < .5) {
      this.tell(!clear ? 'Целься в открытую воду.' : range > castRange ? 'Подойди ближе к рыбному месту.' : 'Забрось подальше от лодки.');
      return;
    }
    this.facing = point.x - point.y < this.position.x - this.position.y ? -1 : 1;
    this.travel = { x: 0, y: 0 };
    this.movement = 0;
    this.castPoint = point;
    this.activeSchool = school ?? null;
    this.cast(school ? { angle: 0, depth: .55 } : undefined);
    this.run.distance = Math.max(4, range);
  }

  miss(message, sound) {
    this.castPoint = null;
    this.activeSchool = null;
    super.miss(message, sound);
  }

  land() {
    if (this.activeSchool) this.activeSchool.availableAt = this.run.time + 12;
    this.castPoint = null;
    this.activeSchool = null;
    super.land();
  }

  returnToPier() {
    if (!this.run) return;
    if (!this.nearDock) { this.tell('Подплыви к освещённому концу причала.'); return; }
    this.finish();
  }

  step(dt) {
    const r = this.run;
    super.step(dt);
    if (!this.run || this.run.phase !== 'ready' || r !== this.run) return;
    const { x, y } = this.travel;
    if (!x && !y) { this.movement = Math.max(0, this.movement - dt * 5); return; }
    const a = x / tile.x;
    const b = y / tile.y;
    const u = (a + b) / 2;
    const v = (b - a) / 2;
    const meters = (this.meta.boat ? 6.2 : 5.3) * dt / Math.hypot(u, v);
    const next = { x: this.position.x + u * meters, y: this.position.y + v * meters };
    if (x) this.facing = Math.sign(x);
    if (navigable(this.map, next, .42)) {
      this.position = next;
      this.movement = Math.min(1, this.movement + dt * 5);
    } else this.movement = Math.max(0, this.movement - dt * 5);
  }
}
