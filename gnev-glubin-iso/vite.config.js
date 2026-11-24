import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { assetsInlineLimit: Infinity, modulePreload: false, chunkSizeWarningLimit: 2000 }
});
