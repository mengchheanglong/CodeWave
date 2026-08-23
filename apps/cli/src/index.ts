#!/usr/bin/env node
import { CW_DUEL_VERSION, USAGE_LINE, CliUsageError, parseArgs } from "./args.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`cw-duel ${CW_DUEL_VERSION}`);
    return;
  }

  if (argv.length === 0) {
    console.error(USAGE_LINE);
    process.exitCode = 1;
    return;
  }

  try {
    const parsed = parseArgs(argv);
    // Slice B wires the duel loop here; for now confirm parsing works.
    if (!parsed.json) {
      console.error(
        `Parsed OK — prompt: ${parsed.prompt.slice(0, 60)}${parsed.prompt.length > 60 ? "…" : ""}, providers: ${parsed.providers.join(", ")}, workspace: ${parsed.workspace}, daemon: ${parsed.daemonUrl}`,
      );
      console.error("Duel execution lands in the next slice.");
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
