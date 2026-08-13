import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'main.cjs',
      },
    },
  },
});
