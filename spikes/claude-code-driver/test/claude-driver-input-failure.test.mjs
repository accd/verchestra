// invariant: requalification of the Claude Code driver for an input that
// fails after its provider has already finished. A provider that reports its
// result and exits cleanly before the run's first write ends as completed;
// the write that finds its input gone neither fails the session nor asks for
// the provider's termination. The provider is the DETERMINISTIC FAKE `claude`
// (fake-claude.mjs) in its `hasty` mode, and the order is made certain by the
// spawn observer, which blocks the run until the provider has exited, before
// the driver writes its prompt. No model is invoked.
import { test } from "node:test";

import { ClaudeCodeDriver } from "../../../packages/drivers/src/index.ts";
import { claudeFixture } from "../../../tests/helpers/claude-driver-fixture.mjs";
import { childRunSuite } from "../../../tests/helpers/driver-child-run-fixture.mjs";
import { blockUntilExited } from "../../../tests/helpers/process-liveness.mjs";

childRunSuite(test, "claude-code", [
  {
    name: "reports its result and exits before the driver writes its prompt",
    build: (onSpawn) => {
      const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: "hasty" } });
      const dependencies = fixture.dependencies();
      const driver = new ClaudeCodeDriver({
        ...dependencies,
        onSpawn: (pid) => {
          dependencies.onSpawn(pid);
          onSpawn(pid);
          blockUntilExited(pid);
        }
      });
      return { driver, request: fixture.request(), calls: fixture.calls };
    },
    sequence: ["session.started", "model.resolved", "usage.updated", "session.closed:completed"],
    outcome: "completed",
    terminations: 0
  }
]);
