import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(desktopRoot, '../web'),
  base: './',
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: path.join(desktopRoot, '.vite/renderer/main_window'),
  },
  server: {
    hmr: false,
  },
});
