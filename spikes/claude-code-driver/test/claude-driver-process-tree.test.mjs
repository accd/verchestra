// invariant: requalification of the Claude Code driver for process-tree
// termination (ADP-4, C4-4). The production ClaudeCodeDriver starts its
// provider in a process group of its own, and the terminator the task
// composition injects kills that group and every descendant that left it. The
// provider is the DETERMINISTIC FAKE `claude` executable (fake-claude.mjs) in
// its `fork` mode. No model is invoked, and every process started here is the
// fake or one of its two idle descendants.
import { test } from "node:test";

import { ProviderProcesses } from "../../../apps/vestra-cli/src/task/task-process-tree.ts";
import { ClaudeCodeDriver } from "../../../packages/drivers/src/index.ts";
import { claudeFixture } from "../../../tests/helpers/claude-driver-fixture.mjs";
import { processTreeSuite } from "../../../tests/helpers/process-tree-fixture.mjs";

// invariant: the terminator is the one `vestra task` hands this driver, and a
// tree it could not confirm stopped would be named in `reported`.
const reported = [];
const providers = new ProviderProcesses({ stderr: (text) => reported.push(text) });

processTreeSuite(test, {
  label: "claude-code",
  terminator: providers.session("Claude Code").terminateTree,
  reported,
  build: (dependencies, mode) => {
    const fixture = claudeFixture({ environment: { FAKE_CLAUDE_MODE: mode } });
    return { driver: new ClaudeCodeDriver(fixture.dependencies(dependencies)), request: fixture.request() };
  }
});
