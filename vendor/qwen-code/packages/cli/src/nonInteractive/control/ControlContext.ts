/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted for CodeWave from:
 * QwenLM/qwen-code
 * packages/cli/src/nonInteractive/control/ControlContext.ts
 * commit 92f7549bdc684f264ae09dc4a6f8e7398363f53e
 *
 * CodeWave keeps the session-scoped control state that the dispatcher needs,
 * without importing qwen-code-core config or MCP client dependencies.
 */

import type { StreamJsonOutputAdapter } from '../io/StreamJsonOutputAdapter.js';

export interface IControlContext {
  readonly streamJson: StreamJsonOutputAdapter;
  readonly sessionId: string;
  readonly abortSignal: AbortSignal;

  inputClosed: boolean;
  onInterrupt?: () => void;
}

export class ControlContext implements IControlContext {
  readonly streamJson: StreamJsonOutputAdapter;
  readonly sessionId: string;
  readonly abortSignal: AbortSignal;

  inputClosed: boolean;
  onInterrupt?: () => void;

  constructor(options: {
    streamJson: StreamJsonOutputAdapter;
    sessionId: string;
    abortSignal: AbortSignal;
    onInterrupt?: () => void;
  }) {
    this.streamJson = options.streamJson;
    this.sessionId = options.sessionId;
    this.abortSignal = options.abortSignal;
    this.inputClosed = false;
    this.onInterrupt = options.onInterrupt;
  }
}
