import { microEffects, screenFilters, type MicroEffectId, type ScreenFilterId } from './visual-effects/presets';

const gains = [
  'sun', 'fill', 'fog', 'skyGlow', 'waterGrade', 'caustics', 'foam', 'landmarks', 'lamps', 'signals', 'vignette'
] as const;

export type VisualGain = typeof gains[number] | 'skyTintMix';

export type VisualTuning = Record<(typeof gains)[number], number> & {
  stage: 'auto' | 0 | 1 | 2;
  skyTint: string;
  skyTintMix: number;
  micro: Record<MicroEffectId, number>;
  filter: 'none' | ScreenFilterId;
  filterStrengths: Record<ScreenFilterId, number>;
};

export const defaultVisualTuning: VisualTuning = {
  stage: 'auto', sun: 1, fill: 1, fog: 1, skyGlow: 1, skyTint: '#ffffff', skyTintMix: 0,
  waterGrade: 1, caustics: 1, foam: 1, landmarks: 1, lamps: 1, signals: 1, vignette: 1,
  micro: Object.fromEntries(microEffects.map(({ id }) => [id, 0])) as VisualTuning['micro'],
  filter: 'none',
  filterStrengths: Object.fromEntries(screenFilters.map(({ id, strength }) => [id, strength])) as VisualTuning['filterStrengths'],
};

function readLevels<Key extends string>(input: unknown, defaults: Record<Key, number>) {
  const result = { ...defaults };
  if (!input || typeof input !== 'object') return result;
  const saved = input as Record<string, unknown>;
  for (const key of Object.keys(defaults) as Key[]) {
    const value = saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.min(1, Math.max(0, value));
  }
  return result;
}

export function readVisualTuning(input?: unknown): VisualTuning {
  const saved = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const result = {
    ...defaultVisualTuning,
    micro: readLevels(saved.micro, defaultVisualTuning.micro),
    filterStrengths: readLevels(saved.filterStrengths, defaultVisualTuning.filterStrengths),
  };
  const filter = screenFilters.find(({id}) => id === saved.filter);
  if (filter) result.filter = filter.id;
  for (const key of gains) {
    const value = saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.min(2, Math.max(0, value));
  }
  const { stage, skyTint, skyTintMix } = saved;
  if (stage === 0 || stage === 1 || stage === 2) result.stage = stage;
  if (typeof skyTint === 'string' && /^#[\da-f]{6}$/i.test(skyTint)) result.skyTint = skyTint;
  if (typeof skyTintMix === 'number' && Number.isFinite(skyTintMix)) {
    result.skyTintMix = Math.min(1, Math.max(0, skyTintMix));
  }
  return result;
}
