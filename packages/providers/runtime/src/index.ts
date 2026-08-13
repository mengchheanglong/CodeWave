import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import path from 'node:path';

export type ProviderCommandSpec = {
  command: string;
  baseArgs?: string[];
};

type ProviderSpawnOptions = Omit<SpawnOptions, 'shell'>;

const windowsCommandCache = new Map<string, string>();

export function parseProviderCommand(
  value: string,
  label = 'provider command',
): Required<ProviderCommandSpec> {
  const tokens: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value.trim())) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }

  const [command, ...baseArgs] = tokens;
  if (!command) {
    throw new Error(`The configured ${label} is empty.`);
  }

  return { command, baseArgs };
}

function isNodeScript(command: string): boolean {
  return /\.(?:[cm]?js)$/i.test(command);
}

function resolveWindowsCommand(command: string): string {
  if (process.platform !== 'win32' || path.isAbsolute(command)) {
    return command;
  }

  const cached = windowsCommandCache.get(command);
  if (cached) return cached;

  const lookup = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const candidates = (lookup.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const resolved =
    candidates.find((candidate) => /\.exe$/i.test(candidate)) ??
    candidates.find((candidate) => /\.(?:cmd|bat)$/i.test(candidate)) ??
    candidates[0] ??
    command;
  if (resolved !== command) windowsCommandCache.set(command, resolved);
  return resolved;
}

function quoteWindowsArgument(value: string): string {
  let quoted = '"';
  let backslashes = 0;

  for (const character of value.replace(/%/g, '%%')) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }

    if (character === '"') {
      quoted += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }

    quoted += `${'\\'.repeat(backslashes)}${character}`;
    backslashes = 0;
  }

  quoted += `${'\\'.repeat(backslashes * 2)}"`;
  return quoted;
}

export function spawnProviderCommand(
  spec: ProviderCommandSpec,
  args: string[],
  options: ProviderSpawnOptions = {},
): ChildProcess {
  const baseArgs = spec.baseArgs ?? [];
  if (isNodeScript(spec.command)) {
    return spawn(process.execPath, [spec.command, ...baseArgs, ...args], {
      ...options,
      shell: false,
      windowsHide: true,
    });
  }

  const executable = resolveWindowsCommand(spec.command);
  const allArgs = [...baseArgs, ...args];
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    const commandLine = [executable, ...allArgs]
      .map((value) => quoteWindowsArgument(value))
      .join(' ');
    return spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `"${commandLine}"`],
      {
        ...options,
        shell: false,
        windowsVerbatimArguments: true,
        windowsHide: true,
      },
    );
  }

  return spawn(executable, allArgs, {
    ...options,
    shell: false,
    windowsHide: true,
  });
}
