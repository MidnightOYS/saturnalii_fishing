import { fish } from './rules/game.js';
import type { FishId } from './polyphemus/rules';
import type { LocationSlot } from './location-navigation';

export const artelBuildings = {
  shrine: { prices: [18, 42, 76] },
  market: { prices: [0, 25, 55] },
  station: { prices: [0, 30, 65] },
  observatory: { prices: [20] },
} as const;

export type ArtelBuilding = keyof typeof artelBuildings;
export type Stock = Partial<Record<FishId, number>>;
export type LandedCatch = { bonus: number; stock: Stock };

export const holdPrices = [20, 40];
export const rodPrices = [20, 40];
export const harborResearch = 28;
export const artelObjectives = {
  land: { title: 'Привези рыбу на Итаку', target: 3, reward: 15 },
  defend: { title: 'Одолей морское чудовище', target: 1, reward: 20 },
  explore: { title: 'Вернись из Гавани затонувшего лика', target: 1, reward: 25 },
} as const;

export type ArtelTask = keyof typeof artelObjectives;
export type ArtelSave = {
  buildings: Record<ArtelBuilding, number>;
  rod: number;
  holdLevel: number;
  hull: number | null;
  repairDebt: number;
  unlocked: LocationSlot[];
  progress: Record<ArtelTask, number>;
  claimed: ArtelTask[];
  landedCatch: LandedCatch[];
};

const fishIds = Object.keys(fish) as FishId[];
export const countFish = (stock: Stock) => Object.values(stock).reduce((sum, count) => sum + count, 0);
export const catchBonus = (count: number) => Math.max(0, Math.min(4, count - 1)) * 12;
export const withBonus = (value: number, bonus: number) => Math.floor(value * (100 + bonus) / 100);

function count(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;
}

export function readArtelSave(raw: unknown): ArtelSave {
  const saved = raw as { artel?: Partial<ArtelSave>; boat?: boolean } | null | undefined;
  const artel = saved?.artel;
  const landedCatch: LandedCatch[] = [];
  if (Array.isArray(artel?.landedCatch)) {
    for (const lot of artel.landedCatch) {
      const stock: Stock = {};
      for (const id of fishIds) {
        const amount = count(lot?.stock?.[id]);
        if (amount) stock[id] = amount;
      }
      if (countFish(stock) && [12, 24, 36, 48].includes(lot?.bonus)) landedCatch.push({ stock, bonus: lot.bonus });
    }
  }
  return {
    buildings: {
      shrine: count(artel?.buildings?.shrine, artelBuildings.shrine.prices.length),
      market: Math.max(1, count(artel?.buildings?.market, artelBuildings.market.prices.length)),
      station: Math.max(1, count(artel?.buildings?.station, artelBuildings.station.prices.length)),
      observatory: count(artel?.buildings?.observatory, artelBuildings.observatory.prices.length),
    },
    rod: count(artel?.rod, rodPrices.length),
    holdLevel: count(artel?.holdLevel, holdPrices.length),
    hull: typeof artel?.hull === 'number' && Number.isFinite(artel.hull) && artel.hull >= 0 ? artel.hull : null,
    repairDebt: count(artel?.repairDebt),
    unlocked: saved?.boat === true || (Array.isArray(artel?.unlocked) && artel.unlocked.includes('temple'))
      ? ['pond', 'temple'] : ['pond'],
    progress: {
      land: count(artel?.progress?.land, artelObjectives.land.target),
      defend: count(artel?.progress?.defend, artelObjectives.defend.target),
      explore: count(artel?.progress?.explore, artelObjectives.explore.target),
    },
    claimed: Array.isArray(artel?.claimed)
      ? (Object.keys(artelObjectives) as ArtelTask[]).filter(id => artel.claimed!.includes(id))
      : [],
    landedCatch,
  };
}
