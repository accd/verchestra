// invariant: command arguments are parsed against the installed manifest, and
// the first invalid token decides the refusal: its argument and message.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCliArguments } from "../../apps/vestra-cli/src/index.ts";

const manifest = {
  schemaVersion: 1,
  semanticVersion: "1.0.0",
  releaseDigest: null,
  minimumCliVersion: "1.0.0",
  commands: [
    { name: "task", summary: "Task root", supportsJson: true, mutating: false, options: [] },
    {
      name: "task plan",
      summary: "Plan a task",
      supportsJson: true,
      mutating: false,
      options: [
        { name: "request", kind: "string" },
        { name: "mode", kind: "string", values: ["fast", "safe"] },
        { name: "dry-run", kind: "boolean" }
      ]
    },
    { name: "doctor", summary: "Check the host", supportsJson: false, mutating: false, options: [] }
  ]
};

function refusal(argv) {
  try {
    parseCliArguments(argv, manifest);
  } catch (error) {
    return {
      code: error.envelope.code,
      argument: error.envelope.safeDetails.argument,
      message: error.message
    };
  }
  assert.fail(`expected ${argv.join(" ")} to be refused`);
}

test("the longest installed command name wins and its options are parsed", () => {
  const parsed = parseCliArguments(["task", "plan", "--request", "req.md", "--dry-run", "--mode", "safe"], manifest);
  assert.equal(parsed.mode, "command");
  assert.equal(parsed.output, "human");
  assert.deepEqual(parsed.command, {
    name: "task plan",
    options: { request: "req.md", "dry-run": true, mode: "safe" }
  });
  assert.ok(Object.isFrozen(parsed.command.options));
});

test("a command with no options parses to an empty option set", () => {
  assert.deepEqual(parseCliArguments(["task", "--output", "json"], manifest), {
    mode: "command",
    output: "json",
    command: { name: "task", options: {} }
  });
});

test("an uninstalled command is refused with its first word as the argument", () => {
  assert.deepEqual(refusal(["deploy", "--now"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "deploy",
    message: "Command is not installed"
  });
});

test("command help is returned before the JSON-support check and option parsing", () => {
  const parsed = parseCliArguments(["doctor", "--output", "json", "--bogus", "--help"], manifest);
  assert.equal(parsed.mode, "command-help");
  assert.equal(parsed.help.name, "doctor");
});

test("JSON output is refused for a command that does not support it", () => {
  assert.deepEqual(refusal(["doctor", "--output", "json"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "--output",
    message: "Command does not support JSON output"
  });
});

test("a positional argument after the command is refused", () => {
  assert.deepEqual(refusal(["task", "plan", "extra"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "extra",
    message: "Unexpected positional argument"
  });
});

test("an unknown option and a repeated option are both refused as unknown or duplicated", () => {
  assert.deepEqual(refusal(["task", "plan", "--force"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "--force",
    message: "Option is unknown or duplicated"
  });
  assert.deepEqual(refusal(["task", "plan", "--dry-run", "--dry-run"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "--dry-run",
    message: "Option is unknown or duplicated"
  });
});

test("a string option without a value is refused, whether at the end or before another flag", () => {
  for (const argv of [
    ["task", "plan", "--request"],
    ["task", "plan", "--request", "--dry-run"]
  ]) {
    assert.deepEqual(refusal(argv), {
      code: "VES_CLI_ARGUMENT_INVALID",
      argument: "--request",
      message: "Option value is missing"
    });
  }
});

test("a value outside an option's declared values is refused", () => {
  assert.deepEqual(refusal(["task", "plan", "--mode", "reckless"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "--mode",
    message: "Option value is invalid"
  });
});

test("the first invalid token decides the refusal", () => {
  assert.deepEqual(refusal(["task", "plan", "--mode", "reckless", "stray"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "--mode",
    message: "Option value is invalid"
  });
  assert.deepEqual(refusal(["task", "plan", "stray", "--mode", "reckless"]), {
    code: "VES_CLI_ARGUMENT_INVALID",
    argument: "stray",
    message: "Unexpected positional argument"
  });
});
