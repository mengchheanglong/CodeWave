import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CODEWAVE_APP_URL,
  DESKTOP_BOOTSTRAP_HEADER,
  DESKTOP_CONTENT_SECURITY_POLICY,
  canGrantDesktopPermission,
  createDaemonRequestHeaders,
  createRendererResponseHeaders,
  isDaemonApiPath,
  isTrustedRendererUrl,
  normalizeAssetPath,
  resolveContainedAsset,
} from '../apps/desktop/src/protocol-policy.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
let checks = 0;

function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  checks += 1;
  assert.equal(actual, expected, message);
}

equal(CODEWAVE_APP_URL, 'codewave://app/', 'The desktop uses a stable secure origin.');
check(isTrustedRendererUrl('codewave://app/'), 'The shell root is trusted.');
check(isTrustedRendererUrl('codewave://app/settings'), 'Shell routes remain trusted.');
check(!isTrustedRendererUrl('https://app/'), 'An HTTPS lookalike is not trusted.');
check(!isTrustedRendererUrl('codewave://app.evil/'), 'A hostname suffix is not trusted.');
check(!isTrustedRendererUrl('codewave://user@app/'), 'Credential-bearing URLs are not trusted.');
check(!isTrustedRendererUrl('codewave://app:4312/'), 'Port-bearing origins are not trusted.');

check(
  canGrantDesktopPermission('notifications', 'codewave://app/', 'codewave://app/'),
  'The trusted shell may request local notifications.',
);
check(
  !canGrantDesktopPermission('geolocation', 'codewave://app/', 'codewave://app/'),
  'Unneeded permissions remain denied.',
);
check(
  !canGrantDesktopPermission('notifications', 'https://app/', 'codewave://app/'),
  'Lookalike request origins cannot request notifications.',
);
check(
  !canGrantDesktopPermission('notifications', 'codewave://app/', 'https://app/'),
  'Untrusted renderers cannot request notifications.',
);

check(isDaemonApiPath('/api'), 'The API root is proxied.');
check(isDaemonApiPath('/api/runs?active=1'), 'Nested API paths are proxied.');
check(!isDaemonApiPath('/apiary'), 'Prefix lookalikes are renderer assets.');

equal(normalizeAssetPath('/'), 'index.html', 'The shell root resolves to the entrypoint.');
equal(normalizeAssetPath('/assets/index-ABC.js'), 'assets/index-ABC.js', 'Hashed assets resolve.');
equal(normalizeAssetPath('/../secret'), null, 'Plain traversal is rejected.');
equal(normalizeAssetPath('/%2e%2e/secret'), null, 'Encoded traversal is rejected.');
equal(normalizeAssetPath('/%252e%252e/secret'), null, 'Double-encoded traversal is rejected.');
equal(normalizeAssetPath('/%5c..%5csecret'), null, 'Encoded backslash traversal is rejected.');
equal(normalizeAssetPath('/%00secret'), null, 'NUL bytes are rejected.');
equal(normalizeAssetPath('/%E0%A4%A'), null, 'Malformed escapes are rejected.');

const assetRoot = path.join(repositoryRoot, 'apps', 'desktop', 'assets');
equal(
  resolveContainedAsset(assetRoot, 'shell/index.html'),
  path.join(assetRoot, 'shell', 'index.html'),
  'A normal asset remains inside the renderer root.',
);
equal(resolveContainedAsset(assetRoot, '../secret'), null, 'Resolved traversal is rejected.');
equal(resolveContainedAsset(assetRoot, path.resolve(repositoryRoot)), null, 'Absolute escape is rejected.');

const incoming = new Headers({
  accept: 'application/json',
  authorization: 'Bearer should-not-cross',
  cookie: 'session=should-not-cross',
  host: 'attacker.invalid',
  'idempotency-key': 'desktop-check-0001',
  [DESKTOP_BOOTSTRAP_HEADER]: 'attacker-controlled',
  'x-codewave-connection': 'connection-1',
});
const daemonHeaders = createDaemonRequestHeaders(incoming, 'owned-secret');
equal(daemonHeaders.get('accept'), 'application/json', 'Accept is forwarded.');
equal(daemonHeaders.get('idempotency-key'), 'desktop-check-0001', 'Idempotency is forwarded.');
equal(daemonHeaders.get('authorization'), null, 'Authorization is not forwarded.');
equal(daemonHeaders.get('cookie'), null, 'Cookies are not forwarded.');
equal(daemonHeaders.get('host'), null, 'Host is not forwarded.');
equal(
  daemonHeaders.get(DESKTOP_BOOTSTRAP_HEADER),
  'owned-secret',
  'Only the main process can inject the per-launch secret.',
);

const daemonResponseHeaders = new Headers({
  'content-type': 'application/json',
  server: 'private-runtime-detail',
  'set-cookie': 'never=renderer',
  'x-codewave-protocol-version': '1',
});
const rendererHeaders = createRendererResponseHeaders(daemonResponseHeaders);
equal(rendererHeaders.get('content-type'), 'application/json', 'Content type is preserved.');
equal(rendererHeaders.get('server'), null, 'Server details do not cross the proxy.');
equal(rendererHeaders.get('set-cookie'), null, 'Daemon cookies cannot reach the renderer.');
equal(rendererHeaders.get('x-frame-options'), 'DENY', 'Framing is denied.');
equal(
  rendererHeaders.get('content-security-policy'),
  DESKTOP_CONTENT_SECURITY_POLICY,
  'Every response gets the product CSP.',
);
check(DESKTOP_CONTENT_SECURITY_POLICY.includes("object-src 'none'"), 'Plugins are blocked by CSP.');
check(DESKTOP_CONTENT_SECURITY_POLICY.includes("frame-ancestors 'none'"), 'Embedding is blocked by CSP.');

const mainSource = await readFile(
  path.join(repositoryRoot, 'apps', 'desktop', 'src', 'main.ts'),
  'utf8',
);
for (const requiredSetting of [
  'contextIsolation: true',
  'nodeIntegration: false',
  'sandbox: true',
  'webSecurity: true',
  'setPermissionRequestHandler',
  "on('will-attach-webview'",
  "on('will-download'",
  "on('certificate-error'",
]) {
  check(mainSource.includes(requiredSetting), `Desktop security config includes ${requiredSetting}.`);
}
check(!mainSource.includes('webviewTag: true'), 'The desktop never enables the webview tag.');
check(!mainSource.includes('allowRunningInsecureContent: true'), 'Insecure content is never enabled.');

const supervisorSource = await readFile(
  path.join(repositoryRoot, 'apps', 'desktop', 'src', 'daemon-supervisor.ts'),
  'utf8',
);
check(
  !supervisorSource.includes('this.#restartHistory = [];'),
  'A successful restart does not erase the rolling crash budget.',
);

const forgeSource = await readFile(
  path.join(repositoryRoot, 'apps', 'desktop', 'forge.config.mjs'),
  'utf8',
);
for (const requiredFuse of [
  '[FuseV1Options.RunAsNode]: false',
  '[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false',
  '[FuseV1Options.EnableNodeCliInspectArguments]: false',
  '[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true',
  '[FuseV1Options.OnlyLoadAppFromAsar]: true',
  '[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false',
  '[FuseV1Options.GrantFileProtocolExtraPrivileges]: false',
]) {
  check(forgeSource.includes(requiredFuse), `Packaged builds pin ${requiredFuse}.`);
}
check(forgeSource.includes('strictlyRequireAllFuses: true'), 'Electron upgrades cannot silently add an unreviewed fuse.');
check(forgeSource.includes("'assets', 'codewave.ico'"), 'Windows packages use the CodeWave native icon.');

const pngIcon = await readFile(
  path.join(repositoryRoot, 'apps', 'desktop', 'assets', 'codewave.png'),
);
const windowsIcon = await readFile(
  path.join(repositoryRoot, 'apps', 'desktop', 'assets', 'codewave.ico'),
);
equal(
  pngIcon.subarray(0, 8).toString('hex'),
  '89504e470d0a1a0a',
  'The generated desktop PNG has a valid signature.',
);
equal(
  windowsIcon.subarray(0, 4).toString('hex'),
  '00000100',
  'The generated Windows ICO has a valid icon-directory header.',
);

console.log(`Desktop security validation passed (${checks}/${checks} checks).`);
