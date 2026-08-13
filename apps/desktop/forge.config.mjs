import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const packageOutputId =
  process.env.CODEWAVE_DESKTOP_OUTPUT_ID ??
  `package-${new Date().toISOString().replace(/[^0-9A-Za-z._-]/g, '-')}`;
if (!/^[0-9A-Za-z._-]+$/.test(packageOutputId)) {
  throw new Error('CODEWAVE_DESKTOP_OUTPUT_ID must be a filename-safe identifier.');
}
const nativeIconPath = path.join(
  desktopRoot,
  'assets',
  process.platform === 'win32' ? 'codewave.ico' : 'codewave.png',
);

function electronBinaryFor(outputPath, platform) {
  if (platform === 'darwin') {
    return path.join(outputPath, 'CodeWave.app', 'Contents', 'MacOS', 'CodeWave');
  }
  return path.join(outputPath, platform === 'win32' ? 'CodeWave.exe' : 'CodeWave');
}

export default {
  // Treat packaged builds as immutable. Windows may retain an app.asar handle after
  // a fatal launch, so overwriting a previously executed package is not reliable.
  outDir: path.join(desktopRoot, 'out', packageOutputId),
  packagerConfig: {
    appBundleId: 'dev.codewave.workspace',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: `Copyright © ${new Date().getUTCFullYear()} CodeWave contributors`,
    asar: {
      unpackDir: '.vite/build',
    },
    executableName: 'CodeWave',
    icon: process.platform === 'darwin' ? undefined : nativeIconPath,
    name: 'CodeWave',
    osxSign: process.env.CODEWAVE_MAC_SIGN_IDENTITY
      ? { identity: process.env.CODEWAVE_MAC_SIGN_IDENTITY }
      : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      authors: 'CodeWave contributors',
      description: 'The visual workspace for AI coding agents',
      name: 'CodeWave',
      setupIcon: path.join(desktopRoot, 'assets', 'codewave.ico'),
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerDMG({}, ['darwin']),
    new MakerDeb({}, ['linux']),
    new MakerRpm({}, ['linux']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: path.join(desktopRoot, 'src/main.ts'),
          config: path.join(desktopRoot, 'vite.main.config.ts'),
          target: 'main',
        },
        {
          entry: path.join(desktopRoot, 'src/preload.ts'),
          config: path.join(desktopRoot, 'vite.preload.config.ts'),
          target: 'preload',
        },
        {
          entry: path.join(desktopRoot, 'src/daemon-entry.ts'),
          config: path.join(desktopRoot, 'vite.daemon.config.ts'),
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: path.join(desktopRoot, 'vite.renderer.config.ts'),
        },
      ],
      concurrent: 1,
    }),
  ],
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      for (const outputPath of packageResult.outputPaths) {
        await flipFuses(electronBinaryFor(outputPath, packageResult.platform), {
          version: FuseVersion.V1,
          resetAdHocDarwinSignature:
            packageResult.platform === 'darwin' && packageResult.arch === 'arm64',
          strictlyRequireAllFuses: true,
          [FuseV1Options.RunAsNode]: false,
          [FuseV1Options.EnableCookieEncryption]: true,
          [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
          [FuseV1Options.EnableNodeCliInspectArguments]: false,
          [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
          [FuseV1Options.OnlyLoadAppFromAsar]: true,
          [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
          [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
          [FuseV1Options.WasmTrapHandlers]: true,
        });
      }
    },
  },
};
