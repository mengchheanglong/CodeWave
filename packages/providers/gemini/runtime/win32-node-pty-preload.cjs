'use strict';

const Module = require('node:module');

const originalLoad = Module._load;

function normalizeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function patchConsoleListModule(request, loaded) {
  if (
    typeof request !== 'string' ||
    !/^@lydell\/node-pty-win32-/i.test(request) ||
    !/\/conpty_console_list\.node$/i.test(request)
  ) {
    return loaded;
  }

  if (
    !loaded ||
    typeof loaded.getConsoleProcessList !== 'function' ||
    loaded.__codewaveConsoleListPatched
  ) {
    return loaded;
  }

  const originalGetConsoleProcessList = loaded.getConsoleProcessList;
  const shellPid = Number.parseInt(process.argv[2] || '', 10);

  loaded.getConsoleProcessList = function patchedGetConsoleProcessList(...args) {
    try {
      return originalGetConsoleProcessList.apply(this, args);
    } catch (error) {
      const fallbackPid =
        Number.isInteger(shellPid) && shellPid > 0 ? shellPid : null;

      if (!process.env.CODEWAVE_GEMINI_WINDOWS_PATCH_SILENT) {
        process.emitWarning(
          `CodeWave Gemini Windows patch suppressed console list failure: ${normalizeErrorMessage(error)}`,
        );
      }

      return fallbackPid === null ? [] : [fallbackPid];
    }
  };

  loaded.__codewaveConsoleListPatched = true;
  return loaded;
}

function patchWindowsPtyAgent(request, loaded) {
  if (
    typeof request !== 'string' ||
    !/windowsPtyAgent(?:\.js)?$/i.test(request)
  ) {
    return loaded;
  }

  const WindowsPtyAgent = loaded?.WindowsPtyAgent;
  if (
    !WindowsPtyAgent ||
    !WindowsPtyAgent.prototype ||
    typeof WindowsPtyAgent.prototype.resize !== 'function' ||
    WindowsPtyAgent.prototype.__codewaveResizePatched
  ) {
    return loaded;
  }

  const originalResize = WindowsPtyAgent.prototype.resize;
  WindowsPtyAgent.prototype.resize = function patchedResize(cols, rows) {
    if (this && this._exitCode !== undefined) {
      return;
    }

    try {
      return originalResize.call(this, cols, rows);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (/Cannot resize a pty that has already exited/i.test(message)) {
        return;
      }

      throw error;
    }
  };
  WindowsPtyAgent.prototype.__codewaveResizePatched = true;
  return loaded;
}

Module._load = function patchedLoad(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  patchConsoleListModule(request, loaded);
  patchWindowsPtyAgent(request, loaded);
  return loaded;
};
