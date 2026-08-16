const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');

const repositoryRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(
  repositoryRoot,
  'apps',
  'web',
  'public',
  'codewave-mark.svg',
);
const outputDirectory = path.join(repositoryRoot, 'apps', 'desktop', 'assets');

function createWindowsIcon(source) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) =>
    source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  );
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index];
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([directory, ...images]);
}

app.whenReady().then(async () => {
  const svg = readFileSync(sourcePath, 'utf8');
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const html = `<!doctype html><style>html,body{margin:0;width:512px;height:512px;overflow:hidden;background:transparent}img{display:block;width:512px;height:512px}</style><img src="${svgUrl}" alt="">`;
  const renderer = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await renderer.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  } catch (error) {
    throw new Error(`Icon renderer failed to load: ${String(error)}`);
  }
  let pngDataUrl;
  try {
    pngDataUrl = await renderer.webContents.executeJavaScript(`(async () => {
      const image = document.querySelector('img');
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      canvas.getContext('2d').drawImage(image, 0, 0, 512, 512);
      return canvas.toDataURL('image/png');
    })()`);
  } catch (error) {
    throw new Error(`Icon image failed to render: ${String(error)}`);
  }
  renderer.destroy();
  const icon = nativeImage.createFromDataURL(pngDataUrl);
  if (icon.isEmpty()) throw new Error('Electron captured an empty CodeWave icon.');
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(path.join(outputDirectory, 'codewave.png'), icon.toPNG());
  if (process.platform === 'win32') {
    writeFileSync(path.join(outputDirectory, 'codewave.ico'), createWindowsIcon(icon));
  }
  console.log(`Desktop icon assets generated from ${path.relative(repositoryRoot, sourcePath)}.`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
