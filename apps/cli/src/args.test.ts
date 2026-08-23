import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CliUsageError, parseArgs } from "./args.js";

interface ValidOverrides {
  prompt?: string;
  providers?: string;
  workspace?: string;
  daemonUrl?: string;
}

function validArgs(overrides: ValidOverrides = {}): string[] {
  return [
    overrides.prompt ?? "add input validation to X",
    "--providers",
    overrides.providers ?? "freebuff,opencode",
    ...(overrides.workspace === undefined
      ? []
      : ["--workspace", overrides.workspace]),
    ...(overrides.daemonUrl === undefined
      ? []
      : ["--daemon", overrides.daemonUrl]),
  ];
}

describe("parseArgs", () => {
  it("accepts a valid minimal invocation", () => {
    const parsed = parseArgs(validArgs());
    assert.equal(parsed.prompt, "add input validation to X");
    assert.deepEqual(parsed.providers, ["freebuff", "opencode"]);
    assert.equal(parsed.json, false);
    assert.equal(parsed.daemonUrl, "http://127.0.0.1:4120");
  });

  it("trims the prompt and accepts three providers", () => {
    const parsed = parseArgs([
      "  fix the flaky test  ",
      "--providers=freebuff,opencode,qwen",
    ]);
    assert.equal(parsed.prompt, "fix the flaky test");
    assert.deepEqual(parsed.providers, ["freebuff", "opencode", "qwen"]);
  });

  it("defaults workspace to the current working directory", () => {
    const parsed = parseArgs(validArgs());
    assert.equal(parsed.workspace, process.cwd());
  });

  it("honors --workspace and --daemon overrides including = syntax", () => {
    const parsed = parseArgs(
      validArgs({ workspace: "/tmp/ws", daemonUrl: "http://127.0.0.1:5000" }),
    );
    assert.equal(parsed.workspace, "/tmp/ws");
    assert.equal(parsed.daemonUrl, "http://127.0.0.1:5000");

    const inline = parseArgs([
      "do it",
      "--providers=a,b",
      "--workspace=/tmp/inline",
      "--daemon=http://127.0.0.1:6000",
      "--json",
    ]);
    assert.equal(inline.workspace, "/tmp/inline");
    assert.equal(inline.daemonUrl, "http://127.0.0.1:6000");
    assert.equal(inline.json, true);
  });

  const invalidCases: Array<{ name: string; argv: string[] }> = [
    { name: "missing prompt", argv: ["--providers", "freebuff,opencode"] },
    { name: "empty prompt", argv: ["   ", "--providers", "freebuff,opencode"] },
    {
      name: "prompt too long",
      argv: ["x".repeat(10_001), "--providers", "freebuff,opencode"],
    },
    { name: "missing --providers", argv: ["some prompt"] },
    { name: "one provider", argv: validArgs({ providers: "freebuff" }) },
    {
      name: "empty providers value",
      argv: validArgs({ providers: "freebuff," }),
    },
    {
      name: "duplicate providers",
      argv: validArgs({ providers: "freebuff,freebuff" }),
    },
    {
      name: "case-insensitive duplicates",
      argv: validArgs({ providers: "Freebuff,freebuff" }),
    },
    {
      name: "invalid provider id (leading digit)",
      argv: validArgs({ providers: "freebuff,2fast" }),
    },
    {
      name: "invalid provider id (bad chars)",
      argv: validArgs({ providers: "freebuff,open_code" }),
    },
    { name: "unknown option", argv: [...validArgs(), "--wat"] },
    {
      name: "missing flag value",
      argv: ["some prompt", "--providers"],
    },
    { name: "duplicate prompt positional", argv: ["a b", "c d", "--providers", "a,b"] },
  ];

  for (const testCase of invalidCases) {
    it(`rejects: ${testCase.name}`, () => {
      assert.throws(() => parseArgs(testCase.argv), CliUsageError);
    });
  }
});
