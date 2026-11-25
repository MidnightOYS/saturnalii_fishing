import { defineConfig } from 'vite';

const waterEntries: Record<string, string> = {
  'water-demo': 'water',
  'watercolor-demo': 'watercolor',
  'water-lab': 'water-lab',
  'water-layers': 'water-layers',
  'water-collection': 'water-collection',
};

export default defineConfig(({ mode }) => {
  const demo = waterEntries[mode];
  return {
    base: './',
    server: { fs: { allow: ['..'] } },
    build: {
      license: { fileName: 'third-party-licenses.md' },
      chunkSizeWarningLimit: 600,
      ...(demo && { outDir: `dist/${demo}`, rolldownOptions: { input: `${mode}.html` } }),
    },
  };
});
