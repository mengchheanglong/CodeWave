import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const geminiWindowsPreloadPath = path.resolve(
  desktopRoot,
  '../../packages/providers/gemini/runtime/win32-node-pty-preload.cjs',
);

function preserveGeminiWindowsPreload(): Plugin {
  const fileName = 'assets/win32-node-pty-preload.cjs';
  return {
    name: 'codewave-preserve-gemini-windows-preload',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.code) continue;
        output.code = output.code.replace(
          /new URL\("data:application\/node;base64,[^"]+", import\.meta\.url\)/,
          `new URL('./${fileName}', import.meta.url)`,
        );
      }
      this.emitFile({
        type: 'asset',
        fileName,
        source: readFileSync(geminiWindowsPreloadPath),
      });
    },
  };
}

export default defineConfig((environment) => {
  const forgeEnvironment = environment as typeof environment & {
    forgeConfigSelf: { entry: string };
  };
  return {
    root: desktopRoot,
    plugins: [preserveGeminiWindowsPreload()],
    build: {
      target: 'node22',
      assetsInlineLimit: 0,
      emptyOutDir: false,
      minify: false,
      outDir: path.join(desktopRoot, '.vite/build'),
      sourcemap: true,
      lib: {
        entry: forgeEnvironment.forgeConfigSelf.entry,
        formats: ['es'],
        fileName: () => 'daemon-entry.mjs',
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  };
});
