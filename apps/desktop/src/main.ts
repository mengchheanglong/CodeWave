import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import startedBySquirrel from 'electron-squirrel-startup';
import { registerCodeWaveProtocol } from './app-protocol.js';
import { DaemonSupervisor } from './daemon-supervisor.js';
import { ensureDemoWorkspace } from './demo-workspace.js';
import { DESKTOP_IPC, type DesktopStatus } from './ipc-contract.js';
import {
  CODEWAVE_APP_URL,
  canGrantDesktopPermission,
  isTrustedRendererUrl,
} from './protocol-policy.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'codewave',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

if (startedBySquirrel) app.quit();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let supervisor: DaemonSupervisor | null = null;
let quitAfterShutdown = false;

function assertTrustedIpc(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame !== frame.top || !isTrustedRendererUrl(frame.url)) {
    throw new Error('Desktop IPC is available only to the CodeWave top-level frame.');
  }
}

function workspaceArgument(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--workspace') return argv[index + 1] ?? '';
    if (value.startsWith('--workspace=')) return value.slice('--workspace='.length);
  }
  return null;
}

async function resolveInitialWorkspace(): Promise<string> {
  const requested = workspaceArgument(process.argv);
  if (requested === null) return ensureDemoWorkspace(app.getPath('userData'));
  if (!requested.trim()) throw new Error('--workspace requires a folder path.');
  const canonical = await realpath(path.resolve(requested));
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error(`The requested workspace is not a directory: ${requested}`);
  }
  return canonical;
}

function installSessionSecurity(): void {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      canGrantDesktopPermission(
        permission,
        requestingOrigin,
        webContents?.getURL() ?? '',
      ),
  );
  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      canGrantDesktopPermission(
        permission,
        details.requestingUrl,
        webContents.getURL(),
      ),
    );
  });
  defaultSession.setDevicePermissionHandler(() => false);
  defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  defaultSession.on('will-download', (event) => event.preventDefault());
  app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(false);
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_440,
    height: 920,
    minWidth: 320,
    minHeight: 568,
    show: false,
    backgroundColor: '#061019',
    title: 'CodeWave',
    webPreferences: {
      contextIsolation: true,
      devTools: process.env.CODEWAVE_DESKTOP_DEVTOOLS === '1',
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL(CODEWAVE_APP_URL);
  return window;
}

function registerDesktopIpc(): void {
  ipcMain.handle(DESKTOP_IPC.getStatus, (event): DesktopStatus => {
    assertTrustedIpc(event);
    if (!supervisor) throw new Error('The CodeWave daemon supervisor is unavailable.');
    return supervisor.getStatus();
  });
  ipcMain.handle(DESKTOP_IPC.chooseWorkspace, async (event): Promise<string | null> => {
    assertTrustedIpc(event);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choose a CodeWave workspace',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    };
    const selection = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    return realpath(selection.filePaths[0]);
  });
}

async function boot(): Promise<void> {
  const workspacePath = await resolveInitialWorkspace();
  const bootstrapSecret = randomBytes(32).toString('base64url');
  const userDataPath = app.getPath('userData');
  supervisor = new DaemonSupervisor({
    bootstrapSecret,
    daemonEntryPath: app.isPackaged
      ? path.join(
          `${app.getAppPath()}.unpacked`,
          '.vite',
          'build',
          'daemon-entry.mjs',
        )
      : path.join(__dirname, 'daemon-entry.mjs'),
    dataDirectory: path.join(userDataPath, 'daemon-data'),
    logDirectory: path.join(userDataPath, 'logs'),
    workspacePath,
  });
  supervisor.onStatus((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DESKTOP_IPC.statusChanged, status);
    }
  });

  installSessionSecurity();
  registerDesktopIpc();
  registerCodeWaveProtocol({
    assetRoot: path.join(__dirname, '../renderer/main_window'),
    bootstrapSecret,
    developmentServerUrl:
      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
        ? MAIN_WINDOW_VITE_DEV_SERVER_URL
        : undefined,
    getDaemonBaseUrl: () => {
      if (!supervisor) throw new Error('The CodeWave daemon supervisor is unavailable.');
      return supervisor.getBaseUrl();
    },
  });
  await supervisor.start();
  mainWindow = createMainWindow();
}

app.setName('CodeWave');
app.setAppUserModelId('dev.codewave.workspace');
crashReporter.start({
  uploadToServer: false,
  compress: false,
});

app.whenReady().then(boot).catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await dialog.showMessageBox({
    type: 'error',
    title: 'CodeWave could not start',
    message: 'CodeWave could not start its local workspace.',
    detail: message,
  });
  app.quit();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('activate', () => {
  if (!mainWindow && supervisor?.getStatus().phase === 'ready') {
    mainWindow = createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitAfterShutdown) return;
  event.preventDefault();
  quitAfterShutdown = true;
  void (async () => {
    if (supervisor) await supervisor.stop();
    app.quit();
  })();
});
