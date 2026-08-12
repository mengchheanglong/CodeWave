import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import {
  parseProviderCommand,
  spawnProviderCommand,
  type ProviderCommandSpec,
} from '@codewave/provider-runtime';

async function runCommand(spec: ProviderCommandSpec, args: string[]) {
  const child = spawnProviderCommand(spec, args, {
    cwd: process.cwd(),
    env: process.env,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = (await once(child, 'close')) as [number | null];
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

const parsed = parseProviderCommand(
  '"C:\\Program Files\\CodeWave\\bridge.exe" "bridge entry.mjs" --jsonl',
  'test command',
);
assert.deepEqual(parsed, {
  command: 'C:\\Program Files\\CodeWave\\bridge.exe',
  baseArgs: ['bridge entry.mjs', '--jsonl'],
});

const argumentProbe = await runCommand(
  {
    command: process.execPath,
    baseArgs: [
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
    ],
  },
  ['wave prompt with spaces', 'quoted "detail"'],
);
assert.equal(argumentProbe.code, 0, argumentProbe.stderr);
assert.deepEqual(JSON.parse(argumentProbe.stdout), [
  'wave prompt with spaces',
  'quoted "detail"',
]);

const warnings: string[] = [];
const warningHandler = (warning: Error & { code?: string }) => {
  if (warning.code === 'DEP0190') warnings.push(warning.message);
};
process.on('warning', warningHandler);
try {
  if (process.platform === 'win32') {
    const tsxShim = path.join(process.cwd(), 'node_modules', '.bin', 'tsx.cmd');
    const shimProbe = await runCommand({ command: tsxShim }, ['--version']);
    assert.equal(shimProbe.code, 0, shimProbe.stderr);
    assert.match(shimProbe.stdout, /tsx v/i);
  }
} finally {
  process.off('warning', warningHandler);
}
assert.deepEqual(warnings, []);

process.stdout.write(
  'Provider runtime validation passed: quoted overrides, lossless arguments, and safe Windows shim launching.\n',
);
