import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureDemoWorkspace } from '../apps/desktop/src/demo-workspace.js';

const execFileAsync = promisify(execFile);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'codewave-desktop-demo-'));

try {
  const demoRoot = await ensureDemoWorkspace(temporaryRoot);
  const expectedFiles = ['.gitignore', 'README.md', 'TASKS.md', 'src/wave.ts'];
  for (const relativePath of expectedFiles) {
    assert.ok((await readFile(path.join(demoRoot, relativePath), 'utf8')).length > 0);
  }

  const { stdout: branch } = await execFileAsync(
    'git',
    ['-C', demoRoot, 'branch', '--show-current'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(branch.trim(), 'main');
  const { stdout: status } = await execFileAsync(
    'git',
    ['-C', demoRoot, 'status', '--porcelain'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(status, '');

  const userEdit = 'export const userEdit = true;\n';
  await writeFile(path.join(demoRoot, 'src/wave.ts'), userEdit, 'utf8');
  assert.equal(await ensureDemoWorkspace(temporaryRoot), demoRoot);
  assert.equal(await readFile(path.join(demoRoot, 'src/wave.ts'), 'utf8'), userEdit);
  const { stdout: editedStatus } = await execFileAsync(
    'git',
    ['-C', demoRoot, 'status', '--porcelain'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.match(editedStatus, /M src\/wave\.ts/);

  const nestedProfile = path.join(temporaryRoot, 'outer-repository', 'profile');
  await execFileAsync('git', ['init', '--initial-branch=outer', path.dirname(nestedProfile)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const nestedDemo = await ensureDemoWorkspace(nestedProfile);
  const { stdout: nestedTopLevel } = await execFileAsync(
    'git',
    ['-C', nestedDemo, 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(path.resolve(nestedTopLevel.trim()).toLowerCase(), nestedDemo.toLowerCase());
  const { stdout: nestedBranch } = await execFileAsync(
    'git',
    ['-C', nestedDemo, 'branch', '--show-current'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(nestedBranch.trim(), 'main');

  console.log('Desktop demo validation passed: clean isolated Git baseline, nested-root fencing, and non-destructive reruns.');
} finally {
  const resolvedTempRoot = path.resolve(temporaryRoot);
  const resolvedOsTemp = path.resolve(os.tmpdir());
  assert.ok(resolvedTempRoot.startsWith(`${resolvedOsTemp}${path.sep}`));
  await rm(resolvedTempRoot, { recursive: true, force: true });
}
