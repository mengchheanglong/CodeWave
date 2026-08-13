import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_IPC, type DesktopBridge, type DesktopStatus } from './ipc-contract.js';

const bridge: DesktopBridge = Object.freeze({
  getStatus: () => ipcRenderer.invoke(DESKTOP_IPC.getStatus) as Promise<DesktopStatus>,
  chooseWorkspace: () =>
    ipcRenderer.invoke(DESKTOP_IPC.chooseWorkspace) as Promise<string | null>,
  onStatusChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopStatus): void => {
      listener(status);
    };
    ipcRenderer.on(DESKTOP_IPC.statusChanged, handler);
    return () => ipcRenderer.removeListener(DESKTOP_IPC.statusChanged, handler);
  },
});

contextBridge.exposeInMainWorld('codewaveDesktop', bridge);
