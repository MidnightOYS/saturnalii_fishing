import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  server: { fs: { allow: ['..'] } },

  build: {
    license: { fileName: 'third-party-licenses.md' },
    chunkSizeWarningLimit: 600,
    ...(mode === 'water-demo' && {
      outDir: 'dist/water',
      rolldownOptions: { input: 'water-demo.html' },
    }),
  },
}));
