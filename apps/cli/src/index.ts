#!/usr/bin/env node
import { CW_DUEL_VERSION, USAGE_LINE, CliUsageError, parseArgs } from "./args.js";
import { DaemonClient } from "./daemon.js";
import { collectLaneResults, startDuel } from "./duel.js";

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
    const client = new DaemonClient(parsed.daemonUrl);
    await client.connect();

    if (!parsed.json) {
      console.log(`Dueling ${parsed.providers.join(" vs ")} — "${parsed.prompt.slice(0, 80)}"`);
    }

    const lanes = await startDuel(client, parsed);
    const results = await collectLaneResults(client, lanes, parsed.workspace);

    if (parsed.json) {
      console.log(JSON.stringify({ prompt: parsed.prompt, lanes: results }, null, 2));
    } else {
      for (const result of results) {
        const duration = result.durationMs !== null ? `${Math.round(result.durationMs / 100) / 10}s` : "?";
        const files = result.changedFilesSummary ? ` | ${result.changedFilesSummary.split("\n")[0]}` : "";
        console.log(`${result.providerId.padEnd(12)} ${result.finalStatus.padEnd(18)} ${duration}${files}`);
        if (result.finalStatus === "failed" && result.errorMessage) {
          console.log(`  error: ${result.errorMessage.slice(0, 200)}`);
        }
        if (result.assistantOutput) {
          const firstLine = result.assistantOutput.trim().split("\n")[0] ?? "";
          console.log(`  said: ${firstLine.slice(0, 140)}`);
        }
      }
    }
    process.exitCode = 0;
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
