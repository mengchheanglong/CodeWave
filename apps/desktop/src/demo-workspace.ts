import { execFile } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEMO_FILES = new Map<string, string>([
  [
    '.gitignore',
    `.codewave/
node_modules/
`,
  ],
  [
    'README.md',
    `# CodeWave demo workspace

Welcome to a small, local workspace for exploring CodeWave safely.

Try asking an agent to explain \`src/wave.ts\`, then review every proposed change before accepting it.
`,
  ],
  [
    'src/wave.ts',
    `export type Wave = {
  amplitude: number;
  phase: number;
};

export function sampleWave(wave: Wave): number {
  return Math.sin(wave.phase) * wave.amplitude;
}
`,
  ],
  [
    'TASKS.md',
    `# Gentle first tasks

- Add tests for \`sampleWave\`.
- Document the accepted amplitude range.
- Refactor only after reviewing the worktree diff.
`,
  ],
]);

function isolatedGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GCM_INTERACTIVE: 'Never',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

async function runGit(
  workspacePath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['-C', workspacePath, ...args], {
    encoding: 'utf8',
    env: isolatedGitEnvironment(),
    maxBuffer: 512 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
}

async function initializeDemoRepository(demoRoot: string): Promise<void> {
  try {
    const { stdout } = await runGit(demoRoot, ['rev-parse', '--show-toplevel']);
    const canonicalDemoRoot = await realpath(demoRoot);
    const canonicalTopLevel = await realpath(stdout.trim());
    const sameRepository =
      process.platform === 'win32'
        ? canonicalTopLevel.toLowerCase() === canonicalDemoRoot.toLowerCase()
        : canonicalTopLevel === canonicalDemoRoot;
    if (sameRepository) return;
  } catch {
    // Only a product-created demo reaches this path; user workspaces are never initialized.
  }

  await runGit(demoRoot, ['init', '--initial-branch=main']);
  await runGit(demoRoot, ['add', '--all']);
  await runGit(demoRoot, [
    '-c',
    'user.name=CodeWave Demo',
    '-c',
    'user.email=demo@codewave.local',
    '-c',
    'commit.gpgSign=false',
    '-c',
    `core.hooksPath=${path.join(path.dirname(demoRoot), '.codewave-disabled-hooks')}`,
    'commit',
    '--no-verify',
    '-m',
    'Start CodeWave demo',
  ]);
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export async function ensureDemoWorkspace(userDataPath: string): Promise<string> {
  const demoRoot = path.join(userDataPath, 'demo-workspace-v1');
  await mkdir(demoRoot, { recursive: true });
  for (const [relativePath, content] of DEMO_FILES) {
    const filePath = path.join(demoRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeIfMissing(filePath, content);
  }
  try {
    await initializeDemoRepository(demoRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Git availability is reported by the project UI; the file demo still remains useful.
  }
  return realpath(demoRoot);
}
