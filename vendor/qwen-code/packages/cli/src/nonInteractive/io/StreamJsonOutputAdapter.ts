/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted for CodeWave from:
 * QwenLM/qwen-code
 * packages/cli/src/nonInteractive/io/StreamJsonOutputAdapter.ts
 * commit 92f7549bdc684f264ae09dc4a6f8e7398363f53e
 *
 * CodeWave only needs the host-side JSON-line writer, not the full CLI output
 * adapter inheritance chain used inside qwen-code.
 */

import type {
  CLIControlRequest,
  CLIControlResponse,
  CLIMessage,
  ControlCancelRequest,
} from '../types.js';

export type StreamJsonWritableMessage =
  | CLIControlRequest
  | CLIControlResponse
  | CLIMessage
  | ControlCancelRequest
  | Record<string, unknown>;

type WritableJsonStream = NodeJS.WritableStream & {
  destroyed?: boolean;
  writableEnded?: boolean;
};

export class StreamJsonOutputAdapter {
  constructor(private readonly writable: WritableJsonStream) {}

  async send(message: StreamJsonWritableMessage): Promise<void> {
    if (
      !this.writable ||
      this.writable.destroyed ||
      this.writable.writableEnded
    ) {
      throw new Error('Qwen stdin is not writable.');
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.writable.off('error', onError);
        reject(error);
      };

      this.writable.once('error', onError);
      this.writable.write(`${JSON.stringify(message)}\n`, (error) => {
        this.writable.off('error', onError);
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}
