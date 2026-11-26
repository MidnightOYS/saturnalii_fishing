import { fish } from '../rules/game.js';

export type FishId = keyof typeof fish;
type Stock = Partial<Record<FishId, number>>;
export type Condition = 0 | 1 | 2;
export type FishStake = { id: FishId; condition: Condition };
type DamagedStock = { 1: Stock; 2: Stock };

export type PolyphemusSave = {
  damagedCatch: DamagedStock;
  polyphemusStake: FishStake | null;
};

type Ledger = PolyphemusSave & { gold: number; sales: Stock };

export const fishIds = Object.keys(fish) as FishId[];
export const conditions = [0, 1, 2] as const;
export const conditionNames = ['Целая', 'Покусанная', 'Объеденная'];
const conditionValue = [100, 40, 10];
export const entryFee = 3;
const openingTime = 450;
const roundMin = 4900;
const roundSpread = 2550;
const jackpotChance = .001;
const jackpotCrestWindow = 245;
const jackpotHalfWindow = 95;
const low = 50;
const waves = [[106, 24], [131, 40], [172, 86]];

export function readPolyphemusSave(raw: unknown): PolyphemusSave {
  const saved = raw as { damagedCatch?: Record<number, Stock>; polyphemusStake?: FishStake } | null;
  const damagedCatch: DamagedStock = { 1: {}, 2: {} };
  for (const condition of [1, 2] as const) {
    for (const id of fishIds) {
      const count = saved?.damagedCatch?.[condition]?.[id];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0) {
        damagedCatch[condition][id] = count;
      }
    }
  }

  const stake = saved?.polyphemusStake;
  const polyphemusStake = stake && fishIds.includes(stake.id) && conditions.includes(stake.condition)
    ? { id: stake.id, condition: stake.condition }
    : null;
  return { damagedCatch, polyphemusStake };
}

type Round = {
  stake: FishStake;
  basePrice: number;
  begins: number;
  duration: number;
  period: number;
  peaks: number[];
  jackpot: boolean;
};

type Quote = {
  height: number;
  jaw: number;
  multiplier: number;
  payout: number;
  opening: boolean;
  expired: boolean;
  jackpot: boolean;
};

export type Outcome =
  | { kind: 'paid'; stake: FishStake; quote: Quote; basePrice: number }
  | { kind: 'bitten'; stake: FishStake; returned: FishStake; quote: Quote | null };

export const stakeKey = ({ id, condition }: FishStake) => id + '/' + condition;

export class Polyphemus {
  round: Round | null = null;
  outcome: Outcome | null = null;

  constructor(
    private readonly ledger: Ledger,
    private readonly marketPrice: (id: FishId) => number,
    private readonly random = Math.random,
    private readonly onRemove: (stake: FishStake) => void = () => {},
  ) {}

  recover() {
    const stake = this.ledger.polyphemusStake;
    if (!stake) return false;
    this.damage(stake, null);
    return true;
  }

  private stock(condition: Condition) {
    return condition === 0 ? this.ledger.sales : this.ledger.damagedCatch[condition];
  }

  price({ id, condition }: FishStake) {
    return Math.floor(this.marketPrice(id) * conditionValue[condition] / 100);
  }

  inventory() {
    return conditions.flatMap(condition => fishIds.flatMap(id => {
      const count = this.stock(condition)[id] ?? 0;
      const stake = { id, condition };
      return count > 0 ? [{ ...stake, count, price: this.price(stake) }] : [];
    }));
  }

  private remove(stake: FishStake) {
    const stock = this.stock(stake.condition);
    const count = stock[stake.id] ?? 0;
    if (count <= 0) return false;
    if (count === 1) delete stock[stake.id];
    else stock[stake.id] = count - 1;
    this.onRemove(stake);
    return true;
  }

  sell(stake?: FishStake) {
    if (this.round) return 0;
    let amount: number;
    if (stake) {
      if (!this.remove(stake)) return 0;
      amount = this.price(stake);
    } else {
      amount = this.inventory().reduce((sum, item) => sum + item.count * item.price, 0);
      this.ledger.sales = {};
      this.ledger.damagedCatch = { 1: {}, 2: {} };
    }
    this.ledger.gold += amount;
    return amount;
  }

  start(stake: FishStake, now: number) {
    if (this.round || this.ledger.polyphemusStake || this.ledger.gold < entryFee || !this.remove(stake)) return false;
    this.ledger.gold -= entryFee;
    this.ledger.polyphemusStake = { ...stake };
    this.outcome = null;
    const duration = roundMin + this.random() * roundSpread;
    const period = 1940 + this.random() * 380;
    const peaks = waves.map(([base, spread]) => base + this.random() * spread);
    const jackpot = this.random() < jackpotChance;
    this.round = {
      stake: this.ledger.polyphemusStake,
      basePrice: this.price(stake),
      begins: now + openingTime,
      duration: jackpot ? Math.max(duration, period * 2.5 + jackpotCrestWindow) : duration,
      period,
      peaks,
      jackpot
    };
    return true;
  }

  quote(now: number): Quote | null {
    const round = this.round;
    if (!round) return null;

    const elapsed = now - round.begins;
    const opening = elapsed < 0;
    const expired = elapsed >= round.duration;
    const time = Math.max(0, Math.min(elapsed, round.duration));
    const wave = Math.floor(time / round.period);
    const phase = time / round.period - wave;
    const height = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    const peak = round.peaks[Math.min(wave, round.peaks.length - 1)];
    const jackpot = round.jackpot && wave === 2 && height >= .87;
    const distanceToCrest = Math.abs(phase - .5) * round.period;
    const crest = jackpot
      ? Math.max(0, Math.min(1, (jackpotCrestWindow - distanceToCrest) / (jackpotCrestWindow - jackpotHalfWindow)))
      : 0;
    const regular = low + (peak - low) * height ** 2.5;
    const multiplier = Math.round(regular + (10000 - regular) * crest ** 4);
    const jaw = opening ? Math.min(1, -elapsed / openingTime) : (time / round.duration) ** 1.45;

    return {
      height, jaw, multiplier, payout: Math.floor(round.basePrice * multiplier / 100), opening, expired, jackpot
    };
  }

  settle(now: number, cashOut = false): Outcome | null {
    const round = this.round;
    const quote = this.quote(now);
    if (!round || !quote) return null;
    if (quote.expired) return this.damage(round.stake, quote);
    if (!cashOut || quote.opening) return null;

    this.round = null;
    this.ledger.polyphemusStake = null;
    this.ledger.gold += quote.payout;
    return this.outcome = { kind: 'paid', stake: round.stake, quote, basePrice: round.basePrice };
  }

  private damage(stake: FishStake, quote: Quote | null): Outcome {
    const condition = stake.condition === 0 ? 1 : 2;
    const stock = this.stock(condition);
    stock[stake.id] = (stock[stake.id] ?? 0) + 1;
    this.round = null;
    this.ledger.polyphemusStake = null;
    return this.outcome = { kind: 'bitten', stake, returned: { id: stake.id, condition }, quote };
  }
}
