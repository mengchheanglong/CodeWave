import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import {
  createDaemonRequestHeaders,
  createRendererResponseHeaders,
  isDaemonApiPath,
  isTrustedRendererUrl,
  normalizeAssetPath,
  resolveContainedAsset,
} from './protocol-policy.js';

export type CodeWaveProtocolOptions = {
  assetRoot: string;
  bootstrapSecret: string;
  developmentServerUrl?: string;
  getDaemonBaseUrl(): string;
};

const MAX_DESKTOP_PROXY_BODY_BYTES = 2 * 1024 * 1024;

function withRendererHeaders(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: createRendererResponseHeaders(response.headers),
  });
}

async function resolveStaticAsset(
  assetRoot: string,
  pathname: string,
): Promise<string | null> {
  const normalized = normalizeAssetPath(pathname);
  if (!normalized) return null;
  const candidate = resolveContainedAsset(assetRoot, normalized);
  if (!candidate) return null;
  try {
    const metadata = await stat(candidate);
    if (metadata.isFile()) return candidate;
  } catch {
    // The product shell is a single-page app; extensionless routes fall back below.
  }
  if (path.extname(normalized)) return null;
  const indexPath = resolveContainedAsset(assetRoot, 'index.html');
  if (!indexPath) return null;
  try {
    await access(indexPath);
    return indexPath;
  } catch {
    return null;
  }
}

async function proxyDaemonRequest(
  request: Request,
  options: CodeWaveProtocolOptions,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(
    `${sourceUrl.pathname}${sourceUrl.search}`,
    options.getDaemonBaseUrl(),
  );
  const headers = createDaemonRequestHeaders(
    request.headers,
    options.bootstrapSecret,
  );
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_DESKTOP_PROXY_BODY_BYTES
    ) {
      return withRendererHeaders(
        Response.json({ error: 'Desktop request body is too large.' }, { status: 413 }),
      );
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_DESKTOP_PROXY_BODY_BYTES) {
      return withRendererHeaders(
        Response.json({ error: 'Desktop request body is too large.' }, { status: 413 }),
      );
    }
    body = bytes;
  }
  const response = await net.fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body,
    redirect: 'error',
  });
  return withRendererHeaders(response);
}

async function serveRendererAsset(
  request: Request,
  options: CodeWaveProtocolOptions,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withRendererHeaders(new Response('Method not allowed.', { status: 405 }));
  }

  const normalized = normalizeAssetPath(sourceUrl.pathname);
  if (!normalized) {
    return withRendererHeaders(new Response('Not found.', { status: 404 }));
  }

  if (options.developmentServerUrl) {
    const target = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, options.developmentServerUrl);
    return withRendererHeaders(await net.fetch(target.toString()));
  }

  const assetPath = await resolveStaticAsset(options.assetRoot, sourceUrl.pathname);
  if (!assetPath) {
    return withRendererHeaders(new Response('Not found.', { status: 404 }));
  }
  return withRendererHeaders(await net.fetch(pathToFileURL(assetPath).toString()));
}

export function registerCodeWaveProtocol(options: CodeWaveProtocolOptions): void {
  protocol.handle('codewave', async (request) => {
    const url = new URL(request.url);
    if (!isTrustedRendererUrl(request.url)) {
      return withRendererHeaders(new Response('Not found.', { status: 404 }));
    }
    try {
      return isDaemonApiPath(url.pathname)
        ? await proxyDaemonRequest(request, options)
        : await serveRendererAsset(request, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown desktop proxy failure.';
      return withRendererHeaders(
        Response.json(
          { error: `CodeWave desktop could not reach its local daemon: ${message}` },
          { status: 503 },
        ),
      );
    }
  });
}
