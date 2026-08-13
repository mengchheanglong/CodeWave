import path from 'node:path';

export const CODEWAVE_APP_ORIGIN = 'codewave://app';
export const CODEWAVE_APP_URL = `${CODEWAVE_APP_ORIGIN}/`;
export const DESKTOP_BOOTSTRAP_HEADER = 'x-codewave-desktop-bootstrap';

export const DESKTOP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "child-src 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join('; ');

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'content-type',
  'idempotency-key',
  'last-event-id',
  'x-codewave-connection',
  'x-codewave-provider-policy-revision',
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'idempotency-key',
  'last-modified',
  'retry-after',
  'x-codewave-protocol-version',
]);

export function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'codewave:' &&
      url.host === 'app' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export function canGrantDesktopPermission(
  permission: string,
  requestingOrigin: string,
  rendererUrl: string,
): boolean {
  return (
    permission === 'notifications' &&
    isTrustedRendererUrl(requestingOrigin) &&
    isTrustedRendererUrl(rendererUrl)
  );
}

export function isDaemonApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function normalizeAssetPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    /%[0-9a-f]{2}/i.test(decoded)
  ) {
    return null;
  }

  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/') || 'index.html';
}

export function resolveContainedAsset(
  assetRoot: string,
  normalizedPath: string,
): string | null {
  const root = path.resolve(assetRoot);
  const candidate = path.resolve(root, normalizedPath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

export function createDaemonRequestHeaders(
  input: Headers,
  bootstrapSecret: string,
): Headers {
  const output = new Headers();
  for (const [name, value] of input.entries()) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) output.set(name, value);
  }
  output.set(DESKTOP_BOOTSTRAP_HEADER, bootstrapSecret);
  return output;
}

export function createRendererResponseHeaders(input: Headers): Headers {
  const output = new Headers();
  for (const [name, value] of input.entries()) {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) output.set(name, value);
  }
  output.set('content-security-policy', DESKTOP_CONTENT_SECURITY_POLICY);
  output.set('cross-origin-opener-policy', 'same-origin');
  output.set('referrer-policy', 'no-referrer');
  output.set('x-content-type-options', 'nosniff');
  output.set('x-frame-options', 'DENY');
  return output;
}
