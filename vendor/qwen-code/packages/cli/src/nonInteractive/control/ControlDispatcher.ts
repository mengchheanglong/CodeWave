/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted for CodeWave from:
 * QwenLM/qwen-code
 * packages/cli/src/nonInteractive/control/ControlDispatcher.ts
 * commit 92f7549bdc684f264ae09dc4a6f8e7398363f53e
 *
 * CodeWave uses a trimmed host-side dispatcher that preserves the control-plane
 * shape while avoiding qwen-code's internal controller graph.
 */

import { randomUUID } from 'node:crypto';
import type {
  CLIControlPermissionRequest,
  CLIControlRequest,
  CLIControlResponse,
  ControlRequestPayload,
  ControlResponse,
} from '../types.js';
import type { IControlContext } from './ControlContext.js';

type ControlRequestHandler = (
  payload: ControlRequestPayload,
  requestId: string,
) => Promise<Record<string, unknown>>;

export type ControlDispatcherHandlers = {
  handleRequest: ControlRequestHandler;
};

type PendingOutgoingRequest = {
  reject: (error: Error) => void;
  resolve: (response: ControlResponse) => void;
  timeoutId: NodeJS.Timeout;
};

export class ControlDispatcher {
  private readonly pendingIncomingRequests = new Set<Promise<void>>();
  private readonly pendingOutgoingRequests = new Map<
    string,
    PendingOutgoingRequest
  >();

  constructor(
    private readonly context: IControlContext,
    private readonly handlers: ControlDispatcherHandlers,
  ) {}

  async dispatch(request: CLIControlRequest): Promise<void> {
    const pending = (async () => {
      try {
        const response = await this.handlers.handleRequest(
          request.request,
          request.request_id,
        );
        if (this.context.inputClosed || this.context.abortSignal.aborted) {
          return;
        }

        await this.sendSuccessResponse(request.request_id, response);
      } catch (error) {
        if (this.context.inputClosed || this.context.abortSignal.aborted) {
          return;
        }

        try {
          await this.sendErrorResponse(
            request.request_id,
            error instanceof Error ? error.message : String(error),
          );
        } catch {
          // Ignore response-write failures after the provider side has already gone away.
        }
      }
    })();

    this.pendingIncomingRequests.add(pending);
    try {
      await pending;
    } finally {
      this.pendingIncomingRequests.delete(pending);
    }
  }

  handleControlResponse(response: CLIControlResponse): void {
    const responsePayload = response.response;
    const requestId = responsePayload.request_id;
    const pending = this.pendingOutgoingRequests.get(requestId);
    if (!pending) {
      return;
    }

    this.deregisterOutgoingRequest(requestId);

    if (responsePayload.subtype === 'success') {
      pending.resolve(responsePayload);
      return;
    }

    const errorMessage =
      typeof responsePayload.error === 'string'
        ? responsePayload.error
        : (responsePayload.error?.message ?? 'Unknown control error');
    pending.reject(new Error(errorMessage));
  }

  handleCancel(requestId?: string): void {
    if (requestId) {
      this.rejectPendingRequest(requestId, 'Control request cancelled.');
      return;
    }

    for (const pendingRequestId of [...this.pendingOutgoingRequests.keys()]) {
      this.rejectPendingRequest(
        pendingRequestId,
        'All control requests cancelled.',
      );
    }
  }

  async sendControlRequest(
    payload: ControlRequestPayload,
    timeoutMs: number = 5000,
    signal?: AbortSignal,
  ): Promise<ControlResponse> {
    if (this.context.inputClosed) {
      throw new Error('Input closed');
    }

    if (signal?.aborted || this.context.abortSignal.aborted) {
      throw new Error('Request aborted');
    }

    const requestId = randomUUID();
    const request: CLIControlRequest = {
      type: 'control_request',
      request_id: requestId,
      request: payload,
    };

    const responsePromise = new Promise<ControlResponse>((resolve, reject) => {
      const abortHandler = () => {
        this.rejectPendingRequest(requestId, 'Request aborted.');
      };
      const timeoutId = setTimeout(() => {
        this.rejectPendingRequest(
          requestId,
          `Control request timed out after ${timeoutMs}ms.`,
        );
      }, timeoutMs);

      this.pendingOutgoingRequests.set(requestId, {
        resolve: (response) => {
          signal?.removeEventListener('abort', abortHandler);
          this.context.abortSignal.removeEventListener('abort', abortHandler);
          resolve(response);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abortHandler);
          this.context.abortSignal.removeEventListener('abort', abortHandler);
          reject(error);
        },
        timeoutId,
      });

      signal?.addEventListener('abort', abortHandler, { once: true });
      this.context.abortSignal.addEventListener('abort', abortHandler, {
        once: true,
      });
    });

    try {
      await this.context.streamJson.send(request);
    } catch (error) {
      this.rejectPendingRequest(
        requestId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    return responsePromise;
  }

  async sendCanUseToolDecision(
    requestId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    await this.sendSuccessResponse(requestId, response);
  }

  shutdown(reason: string = 'Control dispatcher shutdown.'): void {
    for (const requestId of [...this.pendingOutgoingRequests.keys()]) {
      this.rejectPendingRequest(requestId, reason);
    }
  }

  markInputClosed(): void {
    if (this.context.inputClosed) {
      return;
    }

    this.context.inputClosed = true;
    for (const requestId of [...this.pendingOutgoingRequests.keys()]) {
      this.rejectPendingRequest(requestId, 'Input closed');
    }
  }

  getPendingIncomingRequestCount(): number {
    return this.pendingIncomingRequests.size;
  }

  private async sendSuccessResponse(
    requestId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    await this.context.streamJson.send({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response,
      },
    });
  }

  private async sendErrorResponse(
    requestId: string,
    error: string,
  ): Promise<void> {
    await this.context.streamJson.send({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error,
      },
    });
  }

  private rejectPendingRequest(requestId: string, message: string): void {
    const pending = this.pendingOutgoingRequests.get(requestId);
    if (!pending) {
      return;
    }

    this.deregisterOutgoingRequest(requestId);
    pending.reject(new Error(message));
  }

  private deregisterOutgoingRequest(requestId: string): void {
    const pending = this.pendingOutgoingRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingOutgoingRequests.delete(requestId);
  }
}

export function isCanUseToolRequest(
  payload: ControlRequestPayload,
): payload is CLIControlPermissionRequest {
  return payload.subtype === 'can_use_tool';
}
