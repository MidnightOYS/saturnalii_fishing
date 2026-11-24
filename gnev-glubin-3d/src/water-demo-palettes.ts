import type { WaterSettings } from './water';

type WaterPalette = Pick<WaterSettings, 'shallow' | 'deep' | 'crest'> & { name: string };

export const palettes = {
  harbor: { name: 'Оливковая гавань', shallow: '#6d784b', deep: '#153e48', crest: '#64ac9b' },
  aegean: { name: 'Эгейская лазурь', shallow: '#52ad9c', deep: '#175784', crest: '#6bdbcc' },
  malachite: { name: 'Малахитовый берег', shallow: '#7d9c66', deep: '#12484b', crest: '#65d2a1' },
  amber: { name: 'Янтарное мелководье', shallow: '#b6a668', deep: '#194554', crest: '#8bbbaa' },
  slate: { name: 'Свинцовый залив', shallow: '#727b72', deep: '#253b53', crest: '#8eaec4' },
  night: { name: 'Лунная ночь', shallow: '#426d70', deep: '#172943', crest: '#7cbac1' },
} satisfies Record<string, WaterPalette>;
