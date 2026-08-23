export const CW_DUEL_VERSION = "0.0.1";

export const USAGE_LINE =
  'Usage: cw-duel "<prompt>" --providers <id,id[,id]> [--workspace <path>] [--daemon <url>] [--json]';

const MAX_PROMPT_CHARS = 10_000;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/i;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ParsedArgs {
  prompt: string;
  providers: string[];
  workspace: string;
  json: boolean;
  daemonUrl: string;
}

/**
 * Parse and validate cw-duel command-line arguments.
 * Throws CliUsageError (rendered as a single-line usage error, exit code 2).
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let prompt: string | null = null;
  let providersValue: string | null = null;
  let workspaceValue: string | null = null;
  let daemonValue: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const [flag, inlineValue] = splitFlag(token);

    if (flag === "--json") {
      if (inlineValue !== null) {
        throw new CliUsageError(`Flag --json does not take a value`);
      }
      json = true;
      continue;
    }

    if (
      flag === "--providers" ||
      flag === "--workspace" ||
      flag === "--daemon"
    ) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value === "") {
        throw new CliUsageError(`Flag ${flag} requires a value`);
      }
      if (inlineValue === null) index += 1;
      if (flag === "--providers") providersValue = value;
      else if (flag === "--workspace") workspaceValue = value;
      else daemonValue = value;
      continue;
    }

    if (token.startsWith("--")) {
      throw new CliUsageError(`Unknown option '${token}'`);
    }
    if (prompt !== null) {
      throw new CliUsageError("Exactly one prompt argument is allowed");
    }
    prompt = token;
  }

  if (prompt === null) {
    throw new CliUsageError("A prompt is required");
  }
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0) {
    throw new CliUsageError("A non-empty prompt is required");
  }
  if (trimmedPrompt.length > MAX_PROMPT_CHARS) {
    throw new CliUsageError(
      `The prompt exceeds the maximum of ${MAX_PROMPT_CHARS} characters`,
    );
  }

  if (providersValue === null) {
    throw new CliUsageError("Flag --providers is required");
  }
  const providers = parseProviders(providersValue);

  return {
    prompt: trimmedPrompt,
    providers,
    workspace: workspaceValue ?? process.cwd(),
    json,
    daemonUrl: daemonValue ?? "http://127.0.0.1:4120",
  };
}

function parseProviders(value: string): string[] {
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (ids.length < 2) {
    throw new CliUsageError(
      "At least two provider ids are required, e.g. --providers freebuff,opencode",
    );
  }
  for (const id of ids) {
    if (!PROVIDER_ID_PATTERN.test(id)) {
      throw new CliUsageError(`Invalid provider id '${id}'`);
    }
  }
  const unique = new Set(ids.map((id) => id.toLowerCase()));
  if (unique.size !== ids.length) {
    throw new CliUsageError("Provider ids must be unique");
  }
  return ids;
}

function splitFlag(token: string): [string, string | null] {
  const equalsIndex = token.indexOf("=");
  if (!token.startsWith("--") || equalsIndex < 0) {
    return [token, null];
  }
  const flag = token.slice(0, equalsIndex);
  const value = token.slice(equalsIndex + 1);
  return [flag, value.length > 0 ? value : null];
}
