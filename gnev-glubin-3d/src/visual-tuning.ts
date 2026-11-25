const gains = [
  'sun', 'fill', 'fog', 'skyGlow', 'waterGrade', 'caustics', 'foam', 'landmarks', 'lamps', 'signals', 'vignette'
] as const;

export type VisualTuning = Record<(typeof gains)[number], number> & {
  stage: 'auto' | 0 | 1 | 2;
  skyTint: string;
  skyTintMix: number;
};

export const defaultVisualTuning: VisualTuning = {
  stage: 'auto', sun: 1, fill: 1, fog: 1, skyGlow: 1, skyTint: '#ffffff', skyTintMix: 0,
  waterGrade: 1, caustics: 1, foam: 1, landmarks: 1, lamps: 1, signals: 1, vignette: 1
};

export function readVisualTuning(input: unknown): VisualTuning {
  const result = { ...defaultVisualTuning };
  if (!input || typeof input !== 'object') return result;
  const saved = input as Record<string, unknown>;
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
