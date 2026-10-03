// invariant: requalification of the Claude Code driver for the provider child
// run (ADR2-3). The production ClaudeCodeDriver now runs its provider through
// the module both drivers share, whose report changed for these runs: a
// failure that follows the first end of a run, a provider that dies or reports
// a result outside its protocol, and a line that is not a JSON object. The
// provider is the DETERMINISTIC FAKE `claude` (fake-claude.mjs). No model is
// invoked.
import { test } from "node:test";

import { ClaudeCodeDriver } from "../../../packages/drivers/src/index.ts";
import { claudeFixture } from "../../../tests/helpers/claude-driver-fixture.mjs";
import { childRunSuite, STOP_REASON } from "../../../tests/helpers/driver-child-run-fixture.mjs";

const STARTED = ["session.started", "model.resolved"];

function build(mode, { execution = {}, terminateTree } = {}) {
  return (onSpawn) => {
    const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: mode }, ...execution });
    const dependencies = fixture.dependencies();
    const driver = new ClaudeCodeDriver({
      ...dependencies,
      onSpawn: (pid) => {
        dependencies.onSpawn(pid);
        onSpawn(pid);
      },
      ...(terminateTree === undefined ? {} : { terminateTree: terminateTree(fixture.calls) })
    });
    return { driver, request: fixture.request(), calls: fixture.calls };
  };
}

// why: the provider outlives the stop long enough to break its stream after
// it, as a provider with a line still in its pipe does.
const slowTerminator = (calls) => async (pid) => {
  calls.terminate += 1;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  process.kill(pid);
};

childRunSuite(test, "claude-code", [
  {
    name: "ends with a failure before its result",
    build: build("crash"),
    sequence: [...STARTED, "error:VES_CLAUDE_PROCESS_FAILED", "session.closed:failed"],
    outcome: "failed",
    terminations: 0
  },
  {
    name: "reports a result before it announced its session",
    build: build("unannounced"),
    sequence: ["usage.updated", "error:VES_CLAUDE_STREAM_INCOMPLETE", "session.closed:failed"],
    outcome: "failed",
    terminations: 0
  },
  {
    name: "breaks its stream and then exceeds its output limit",
    build: build("broken-then-flood", { execution: { maxOutputBytes: 1024 } }),
    sequence: [...STARTED, "error:VES_CLAUDE_STREAM_INVALID", "session.closed:failed"],
    outcome: "failed",
    terminations: 1
  },
  {
    name: "breaks its stream after it was cancelled",
    build: build("late-garble", { terminateTree: slowTerminator }),
    stopOn: (event) => event.type === "content.delta",
    sequence: [...STARTED, "content.delta", "error:VES_CLAUDE_ABORTED", `session.closed:cancelled:${STOP_REASON}`],
    outcome: "cancelled",
    terminations: 1
  },
  {
    name: "writes lines that parse as JSON and are not objects",
    build: build("not-an-object"),
    sequence: [...STARTED, "error:VES_CLAUDE_STREAM_INVALID", "session.closed:failed"],
    outcome: "failed",
    terminations: 1
  },
  {
    name: "writes a line that parses to a string spelling an error code",
    build: build("code-line"),
    sequence: [...STARTED, "error:VES_CLAUDE_STREAM_INVALID", "session.closed:failed"],
    outcome: "failed",
    terminations: 1
  }
]);
