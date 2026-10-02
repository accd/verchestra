// invariant: requalification of the Claude Code driver for how its provider
// ends when no one stopped it (ADP-4, follow-up). The production
// ClaudeCodeDriver ends a provider whose stream failed, that exceeded its
// output limit, or that closed its input through the same one tree
// termination as a stop. The provider is the DETERMINISTIC FAKE `claude`
// executable (fake-claude.mjs) with FAKE_CLAUDE_FORK=1, in its `garbled`,
// `flood` and `deaf` modes. No model is invoked, and every process started
// here is the fake or one of its two idle descendants.
import { test } from "node:test";

import { ProviderProcesses } from "../../../apps/vestra-cli/src/task/task-process-tree.ts";
import { ClaudeCodeDriver } from "../../../packages/drivers/src/index.ts";
import { claudeFixture } from "../../../tests/helpers/claude-driver-fixture.mjs";
import { providerEndSuite } from "../../../tests/helpers/process-tree-fixture.mjs";

// invariant: the terminator is the one `vestra task` hands this driver, and a
// tree it could not confirm stopped would be named in `reported`.
const reported = [];
const providers = new ProviderProcesses({ stderr: (text) => reported.push(text) });

providerEndSuite(test, {
  label: "claude-code",
  terminator: providers.session("Claude Code").terminateTree,
  reported,
  build: (dependencies, mode, { fork = false, ...execution } = {}) => {
    const environment = { FAKE_CLAUDE_MODE: mode, ...(fork ? { FAKE_CLAUDE_FORK: "1" } : {}) };
    const fixture = claudeFixture({ environment, ...execution });
    return { driver: new ClaudeCodeDriver(fixture.dependencies(dependencies)), request: fixture.request() };
  },
  ends: [
    { name: "writes a line that is not JSON", mode: "garbled", errors: ["VES_CLAUDE_STREAM_INVALID"], outcome: "failed" },
    {
      name: "exceeds its output limit",
      mode: "flood",
      execution: { maxOutputBytes: 1024 },
      errors: ["VES_CLAUDE_OUTPUT_LIMIT"],
      outcome: "failed"
    },
    {
      // why: a prompt larger than any pipe buffer, so the write is still
      // pending when the provider closes its input.
      // hazard: on win32 the fake cannot close its input, so no write fails
      // there and nothing ends the session but a stop. That is what the case
      // asserts on win32, under the name it has there.
      name: "closes its input",
      mode: "deaf",
      execution: { prompt: "x".repeat(2 * 1024 * 1024) },
      errors: ["VES_CLAUDE_STDIN_FAILED"],
      outcome: "failed",
      win32Name: "does not read its input, once it is stopped,",
      win32: { errors: ["VES_CLAUDE_ABORTED"], outcome: "cancelled" }
    }
  ]
});
