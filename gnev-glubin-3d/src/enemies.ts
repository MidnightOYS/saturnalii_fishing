import type { LocationSlot, Point } from './location-navigation';

export const enemyLineup = {
  pond: ['hippocamp', 'karkinos'],
  temple: ['charybdis', 'cretan-bull'],
} as const satisfies Record<LocationSlot, readonly string[]>;

export type EnemyKind = (typeof enemyLineup)[LocationSlot][number];

export const enemyNames: Record<EnemyKind, string> = {
  hippocamp: 'Гиппокамп',
  karkinos: 'Каркинос',
  charybdis: 'Харибда',
  'cretan-bull': 'Критский бык',
};

export const enemyTiming = { emerge: .78, windup: .74 };
export const enemyHitRadius = .82;

export type EnemyEncounter = Point & {
  kind: EnemyKind;
  age: number;
  windup: number;
  steering: number;
  heading: number;
  moving: boolean;
};

export type EnemyExit = { monster: EnemyEncounter; clip: 'attack' | 'defeat' };
