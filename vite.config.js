import { defineConfig } from 'vite';

// base relativo: funciona no GitHub Pages (subpasta) e dentro do APK
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 }
});
