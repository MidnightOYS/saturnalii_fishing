import { waterEffects, waterVariants, type ReflectionQuality, type WaterEffects, type WaterSettings } from '../water';
import { palettes as coastPalettes } from '../water-demo-palettes';
import { palettes as paintedPalettes } from '../watercolor-inspector';

export const modeGroups = [
  { label: 'Море', modes: ['harbor', 'spectral', 'lagoon', 'slope', 'breaker'] },
  { label: 'Под водой', modes: ['refraction', 'meadow', 'wreck', 'night'] },
  { label: 'Живопись', modes: ['watercolor'] },
] as const;
export type Mode = typeof modeGroups[number]['modes'][number];
export const modeKeys = modeGroups.flatMap<Mode>(group => [...group.modes]);

export type LabSettings = {
  wrath: number; waves: number; light: number; feature: number; detail: number;
  layer: number; wind: number; deep: string; shallow: string;
  crest?: string; waveScale?: number; reflection?: number; foam?: number; wake?: number;
  clarity?: number; roughness?: number; scattering?: number; stormStrength?: number;
  reflectionQuality?: ReflectionQuality; effects?: WaterEffects;
  ink?: string; sun?: string; sky?: string; elevation?: number; glints?: number;
  caustics?: number; brush?: number; grain?: number; relief?: number; painted?: boolean;
  bottom?: boolean; wrathRate?: number; renderScale?: number;
};

type NumericKey = { [K in keyof LabSettings]-?: NonNullable<LabSettings[K]> extends number ? K : never }[keyof LabSettings];
type ColorKey = 'shallow' | 'deep' | 'crest' | 'ink' | 'sun' | 'sky';
export type Range = readonly [key: NumericKey, label: string, min: number, max: number];
type Preset = { name: string; settings: LabSettings; cameraElevation?: number };
type ModeDefinition = {
  tab: string; title: string; summary: string; group?: 'coast' | 'painted';
  ranges?: Range[]; extras?: Range[]; colors?: ColorKey[];
  feature?: string; detail?: string; wind?: string; layer?: string;
  presets: Preset[];
};

function preset(name: string, deep: string, shallow: string, values: Partial<LabSettings>): Preset {
  return { name, settings: { wrath: .05, waves: .8, light: 1, feature: 1, detail: 1, wind: .85, layer: 1, deep, shallow, ...values } };
}

function fromCoast({waveHeight, distortion, ...settings}: WaterSettings) {
  return { ...settings, waves: waveHeight, detail: distortion, effects: { ...waterEffects } };
}
const coast = (variant: keyof typeof waterVariants, recommended: string): Preset[] => {
  const base = fromCoast(waterVariants[variant]);
  return [
    preset(recommended, base.deep, base.shallow, base),
    ...Object.values(coastPalettes).map(({ name, deep, shallow, crest }) => preset(name, deep, shallow, { ...base, deep, shallow, crest })),
  ];
};
const nativeControls: Range[] = [
  ['waves', 'Высота волн', 0, 1.6], ['waveScale', 'Длина волн', .7, 1.8],
  ['reflection', 'Отражения', 0, 1.8], ['detail', 'Искажение отражений', 0, 3.5],
  ['foam', 'Пена', 0, 1.8], ['wake', 'След лодки', 0, 1.75],
  ['stormStrength', 'Сила шторма', 0, 1.5],
];
const scatteringControls: Range[] = [['roughness', 'Ширина бликов', .2, .82], ['scattering', 'Свет в воде', 0, 2]];
const waterColors = ['shallow', 'deep', 'crest'] as const;

export const definitions: Record<Mode, ModeDefinition> = {
  harbor: {
    tab: 'Герстнер', title: 'Волны Герстнера', group: 'coast',
    summary: 'Крупные волны, отражения скал и тёплый свет у причала.',
    ranges: nativeControls, colors: [...waterColors], presets: coast('A', 'Исходная гавань'),
  },
  spectral: {
    tab: 'Спектр', title: 'Спектральная зыбь', group: 'coast',
    summary: 'Волновой спектр, из которого складываются зыбь и ветровые гребни.',
    ranges: nativeControls, extras: scatteringControls,
    colors: [...waterColors], presets: coast('B', 'Исходный спектр'),
  },
  lagoon: {
    tab: 'Лагуна', title: 'Береговая лагуна', group: 'coast',
    summary: 'Волны меняют форму у берега, цвет и преломление зависят от глубины.',
    ranges: nativeControls, extras: [...scatteringControls, ['clarity', 'Прозрачность', .25, 2.35]],
    colors: [...waterColors], presets: coast('C', 'Исходная лагуна'),
  },
  watercolor: {
    tab: 'Акварель', title: 'Акварельная бухта', group: 'painted',
    summary: 'Вариант по референсу Dérive Ocean. Прозрачный слой воды и фильтр мазков поверх кадра.',
    ranges: [['waves', 'Высота волн', 0, 1.6], ['clarity', 'Прозрачность', .3, 3.4],
      ['glints', 'Световые штрихи', 0, 2], ['caustics', 'Свет на дне', 0, 1.8], ['foam', 'Пена и след', 0, 2]],
    extras: [['brush', 'Размер мазка', 0, 1], ['grain', 'Зерно бумаги', 0, 1],
      ['relief', 'Рельеф пигмента', 0, 1], ['elevation', 'Высота солнца', .15, 1.2],
      ['renderScale', 'Масштаб рендера', .6, 1], ['wrathRate', 'Прирост гнева, %/с', .3, 7]],
    colors: ['shallow', 'deep', 'ink', 'sun', 'sky'],
    presets: paintedPalettes.map(({ name, deep, shallow, ...paint }) => preset(name, deep, shallow, {
      ...paint, painted: true, bottom: true, waves: .81, foam: 1,
      wrathRate: 2.6, light: 1.16, renderScale: 1,
    })),
  },
  refraction: {
    tab: 'Преломление', title: 'Мраморное дно',
    summary: 'Свет проходит через зыбь и скользит по древней мозаике.',
    layer: 'Плотность воды',
    presets: [
      preset('Мрамор', '#185967', '#83d5b3', { feature: 1.3, detail: 1, light: 1.1, waves: .68 }),
      preset('Олива', '#254638', '#a3ad67', { feature: .78, detail: 1.5, light: .9, wind: .55, waves: .48 }),
      preset('Бирюза', '#0a4755', '#49d4ba', { feature: 1.65, detail: 1.35, light: 1.2, waves: 1.1, wind: 1.3, wrath: .18 }),
      { ...preset('Шторм из видео', '#185967', '#83d5b3', { feature: 1.30, detail: .30, waves: .94, wind: 1.85, light: 1.10, wrath: 1 }), cameraElevation: 34 },
    ],
  },
  meadow: {
    tab: 'Посидония', title: 'Луга посидонии',
    summary: 'Солнечные полосы пересекают листья и светлые просветы песка.',
    layer: 'Подводный свет',
    presets: [
      preset('Отмель', '#175859', '#9bcca1', { waves: .67, wind: .61, light: 1.13, layer: 1.05, detail: .92, feature: 1.20 }),
      preset('Полдень', '#13495b', '#56ccbb', { waves: .81, wind: 1.09, light: 1.36, layer: 1.50, detail: 1.08, feature: 1.40 }),
      preset('Оливковый', '#263e34', '#b6ba71', { waves: .47, wind: .45, light: .94, layer: .72, detail: .75, feature: .76 }),
    ],
  },
  wreck: {
    tab: 'Остов', title: 'Затонувший груз',
    summary: 'Рыбы проходят между лодкой и обломками корпуса, над амфорами висит взвесь.',
    layer: 'Взвесь над дном',
    presets: [
      preset('Амфоры', '#173f48', '#a7bfa1', { waves: .74, wind: .78, layer: .76, light: 1.02, detail: .93, feature: 1.03 }),
      preset('Течение', '#124555', '#62c1ba', { waves: 1.14, wind: 1.28, layer: .44, light: 1.16, detail: 1.16, feature: 1.34, wrath: .17 }),
      preset('Ил', '#344a42', '#c3ad7c', { waves: .65, wind: .53, layer: 1.55, light: .9, detail: .88, feature: .68 }),
    ],
  },
  night: {
    tab: 'Медузы', title: 'Ночная бухта',
    summary: 'Под тёмной поверхностью видны светящиеся колонии и дрейфующие медузы.',
    layer: 'Свечение планктона',
    presets: [
      preset('Полночь', '#10233e', '#287884', { layer: 1.26, waves: .66, wind: .65, feature: .67, detail: 1.03, light: .63 }),
      preset('Фосфор', '#0d3034', '#378d79', { layer: 1.80, waves: .81, wind: .94, feature: .55, detail: 1.12, light: .48 }),
      preset('Луна', '#252c51', '#79acbf', { layer: .84, waves: .48, wind: .52, feature: .95, detail: .80, light: 1.01 }),
    ],
  },
  slope: {
    tab: 'Блики', title: 'Свет на волнах', summary: 'Отдельные искры и широкая дорожка света на мелкой ряби.',
    feature: 'Направленность блика', detail: 'Мелкая рябь', wind: 'Ветер',
    presets: [
      preset('Серебро', '#193f56', '#70aeb3', { feature: 1.15, detail: 1.1, light: 1.2, waves: .86 }),
      preset('Стекло', '#173e48', '#78b5a9', { feature: .5, detail: .32, light: .96, wind: .26, waves: .39 }),
      preset('Шквал', '#152f48', '#547d91', { feature: 1.82, detail: 1.75, light: 1.34, wind: 1.8, waves: 1.27, wrath: .73 }),
    ],
  },
  breaker: {
    tab: 'Прибой', title: 'Объёмный прибой', summary: 'Заворот гребня, полость под волной и обрушение у скал.',
    feature: 'Сила обрушения', detail: 'Пена и брызги', wind: 'Темп наката',
    presets: [
      preset('Накат', '#124956', '#69bfae', { feature: 1.3, detail: 1.1, light: 1.07, wind: 1, waves: .9, wrath: .15 }),
      preset('Отлив', '#225665', '#a4bf92', { feature: .65, detail: .55, light: 1.12, wind: .5, waves: .55 }),
      preset('Шторм', '#173647', '#759d9b', { feature: 1.83, detail: 1.78, light: .94, wind: 1.62, waves: 1.32, wrath: .82 }),
    ],
  },
};

const expeditionRefraction: Preset = {
  name: 'Лунный водосбор',
  settings: {
    ...definitions.refraction.presets[0].settings, deep: '#074467', shallow: '#79cdb7', feature: .28, layer: 1.63,
  },
};

export function collectionPresets(mode: Mode, game = false): Preset[] {
  const presets = definitions[mode].presets;
  return game && mode === 'refraction' ? [expeditionRefraction, ...presets] : presets;
}

export const colorNames: Record<ColorKey, string> = {
  shallow: 'Мелководье', deep: 'Глубина', crest: 'Гребни', ink: 'Пигмент шторма', sun: 'Солнце', sky: 'Небо',
};
export const effectNames: Record<keyof WaterEffects, string> = {
  waves: 'Форма волн', capillary: 'Мелкая рябь', depth: 'Цвет по глубине',
  reflection: 'Зеркальные отражения', crestLight: 'Свет в гребнях', sunGlint: 'Солнечный блик',
  lamps: 'Свет у причала', shoreFoam: 'Береговая пена', crestFoam: 'Пена на гребнях',
  wake: 'След лодки', ripples: 'Рябь от поплавка',
};
export function switchesFor(mode: Mode): [key: 'bottom' | 'painted', label: string][] {
  return mode === 'watercolor' ? [['bottom', 'Дно и растительность'], ['painted', 'Акварельный фильтр']] : [];
}
export const wrathControl: Range = ['wrath', 'Гнев', 0, 1];

export function rangesFor(mode: Mode): Range[] {
  const { ranges, feature, detail, wind, layer } = definitions[mode];
  if (ranges) return ranges;
  const controls: Range[] = [
    ['feature', feature ?? 'Каустика', 0, 2], ['detail', detail ?? 'Преломление', 0, 2],
    ['waves', 'Высота волн', 0, 2], ['wind', wind ?? 'Ветер', 0, 2], ['light', 'Свет', 0, 2],
  ];
  if (layer) controls.unshift(['layer', layer, 0, 2]);
  return controls;
}

export const schema = 'gnev-glubin-water-collection';
export type CollectionSnapshot = {
  schema: typeof schema; version: 1; mode: Mode; modes: Record<Mode, LabSettings>;
  cameraElevation: number; autoWrath: boolean; paused: boolean;
};

export function defaultCollectionSettings(mode: Mode, game = false): LabSettings {
  const preset = collectionPresets(mode, game)[0].settings;
  return { ...preset, ...(preset.effects && { effects: { ...preset.effects } }) };
}

export function defaultCollection(game = false): CollectionSnapshot {
  return {
    schema, version: 1, mode: 'refraction', cameraElevation: 32, autoWrath: false, paused: false,
    modes: Object.fromEntries(modeKeys.map(mode => [mode, defaultCollectionSettings(mode, game)])) as Record<Mode, LabSettings>,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isMode = (value: unknown): value is Mode => modeKeys.some(key => key === value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readMode(mode: Mode, patch: unknown, defaults: LabSettings): LabSettings {
  if (!isRecord(patch)) throw new Error('В файле нет настроек выбранного режима.');
  const next = { ...defaults };
  const ranges = [...rangesFor(mode), ...(definitions[mode].extras ?? []), wrathControl];
  for (const [key, , min, max] of ranges) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!isNumber(value)) throw new Error('Настройка «' + key + '» должна быть числом.');
    next[key] = clamp(value, min, max);
  }
  for (const key of definitions[mode].colors ?? ['shallow', 'deep']) {
    const value = patch[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw new Error('Цвет «' + key + '» должен быть в формате #RRGGBB.');
    next[key] = value.toLowerCase();
  }
  for (const [key] of switchesFor(mode)) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  if (defaults.reflectionQuality && (patch.reflectionQuality === 'off' || patch.reflectionQuality === 'balanced' || patch.reflectionQuality === 'full'))
    next.reflectionQuality = patch.reflectionQuality;
  if (defaults.effects && isRecord(patch.effects)) {
    const effects = { ...defaults.effects };
    for (const key of Object.keys(effects) as (keyof WaterEffects)[]) {
      const value = patch.effects[key];
      if (typeof value === 'boolean') effects[key] = value;
    }
    next.effects = effects;
  }
  return next;
}

function readScene(snapshot: CollectionSnapshot, source: Record<string, unknown>) {
  if (isNumber(source.cameraElevation)) snapshot.cameraElevation = Math.round(clamp(source.cameraElevation, 24, 48));
  if (typeof source.autoWrath === 'boolean') snapshot.autoWrath = source.autoWrath;
  if (typeof source.paused === 'boolean') snapshot.paused = source.paused;
}

const legacyMode = (key: unknown): Mode | undefined => key === 'slopes' ? 'slope' : key === 'breakers' ? 'breaker' : isMode(key) ? key : undefined;

export function readCollection(data: unknown, baseline = defaultCollection()): CollectionSnapshot {
  if (!isRecord(data) || data.version !== 1) throw new Error('Выбери JSON настроек одной из водных демок «Гнева глубин».');
  const next = { ...baseline, modes: { ...baseline.modes } };
  if (data.schema === schema || data.demo === 'gnev-glubin-water-layers' || (data.schema === undefined && data.demo === undefined && legacyMode(data.mode))) {
    const selected = legacyMode(data.mode);
    if (!selected) throw new Error('В файле указан неизвестный режим воды.');
    next.mode = selected;
    if (isRecord(data.modes)) {
      for (const [key, settings] of Object.entries(data.modes)) {
        const mode = legacyMode(key);
        if (mode) next.modes[mode] = readMode(mode, settings, baseline.modes[mode]);
      }
    } else {
      next.modes[selected] = readMode(selected, data.settings, baseline.modes[selected]);
    }
    readScene(next, data);
    return next;
  }
  if (data.schema === 'gnev-glubin-water') {
    const modeByVariant = { A: 'harbor', B: 'spectral', C: 'lagoon' } as const;
    if ((data.activeVariant !== 'A' && data.activeVariant !== 'B' && data.activeVariant !== 'C') || !isRecord(data.variants))
      throw new Error('В файле нет активного варианта A, B или C.');
    const scene = isRecord(data.scene) ? data.scene : {};
    for (const variant of ['A', 'B', 'C'] as const) {
      const profile = data.variants[variant];
      if (!isRecord(profile) || !isRecord(profile.settings)) continue;
      const mode = modeByVariant[variant];
      const { waveHeight, distortion, ...settings } = profile.settings;
      next.modes[mode] = readMode(mode, { ...settings, effects: profile.effects, waves: waveHeight,
        detail: distortion, wrath: scene.targetWrath ?? scene.wrath }, baseline.modes[mode]);
    }
    next.mode = modeByVariant[data.activeVariant];
    readScene(next, scene);
    return next;
  }
  if (data.schema === 'gnev-glubin-watercolor') {
    if (!isRecord(data.palette) || !isRecord(data.settings)) throw new Error('В файле нет палитры или настроек акварели.');
    const wrath = isRecord(data.wrath) ? data.wrath : {};
    next.mode = 'watercolor';
    next.modes.watercolor = readMode('watercolor', { ...data.palette, ...data.settings,
      waves: data.settings.waveHeight, wrath: isNumber(wrath.value) ? wrath.value / 100 : undefined,
    }, baseline.modes.watercolor);
    readScene(next, { ...data, autoWrath: wrath.auto });
    return next;
  }
  throw new Error('Этот файл не относится к водным демкам «Гнева глубин».');
}
