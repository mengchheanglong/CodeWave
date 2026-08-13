import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDaemonApi,
  resetDaemonConnection,
} from './daemon-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetDaemonConnection();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('daemon provider-policy conflicts', () => {
  it('refreshes policy state and preserves the typed authoritative conflict', async () => {
    const currentProviderRevision = `sha256:${'b'.repeat(64)}`;
    const refresh = vi.fn(async () => {
      throw new Error('refresh unavailable');
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === '/api/handshake') {
        return handshakeResponse('connection-a');
      }
      return new Response(
        JSON.stringify({
          error: 'Provider configuration changed after this view loaded.',
          code: 'provider_revision_conflict',
          currentProviderRevision,
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const api = createDaemonApi({ onProviderRevisionConflict: refresh });
    const request = api.createSession({
      workspacePath: 'C:/workspace',
      providerId: 'freebuff',
      expectedProviderRevision: `sha256:${'a'.repeat(64)}`,
    });

    await expect(request).rejects.toMatchObject({
      name: 'DaemonRequestError',
      status: 409,
      code: 'provider_revision_conflict',
      currentProviderRevision,
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(currentProviderRevision);
  });

  it('renegotiates once when a daemon restart invalidates the connection', async () => {
    let handshakeCount = 0;
    const providerRequests: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input) === '/api/handshake') {
        handshakeCount += 1;
        return handshakeResponse(`connection-${handshakeCount}`);
      }
      providerRequests.push(init ?? {});
      if (providerRequests.length === 1) {
        return new Response(
          JSON.stringify({
            error: 'Connection invalid after restart.',
            code: 'client_connection_invalid',
            requiredScope: 'providers:read',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          version: 1,
          revision: `sha256:${'c'.repeat(64)}`,
          defaultProviderId: 'freebuff',
          configPath: 'C:/workspace/.codewave/providers.json',
          providers: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const providers = await createDaemonApi().getProviders();

    expect(providers.defaultProviderId).toBe('freebuff');
    expect(handshakeCount).toBe(2);
    expect(
      new Headers(providerRequests[0]?.headers).get('X-CodeWave-Connection'),
    ).toBe('connection-1');
    expect(
      new Headers(providerRequests[1]?.headers).get('X-CodeWave-Connection'),
    ).toBe('connection-2');
  });
});

function handshakeResponse(connectionId: string): Response {
  return new Response(
    JSON.stringify({
      connectionId,
      protocolVersion: 1,
      serverName: 'CodeWave daemon',
      serverVersion: 'test',
      capabilities: ['scoped-handshake'],
      availableScopes: ['runtime:read', 'providers:read'],
      grantedScopes: ['runtime:read', 'providers:read'],
      limits: {
        maxRequestBytes: 2 * 1024 * 1024,
        maxSseReplayEvents: 500,
        maxSteeringPromptChars: 20_000,
        defaultTranscriptMessages: 100,
        maxTranscriptMessages: 200,
        idempotencyKeyMinLength: 8,
        idempotencyKeyMaxLength: 128,
        connectionTtlSeconds: 43_200,
        maxClientConnections: 256,
      },
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
}
