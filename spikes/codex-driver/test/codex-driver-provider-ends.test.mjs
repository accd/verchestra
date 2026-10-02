// invariant: requalification of the Codex driver for how its provider ends
// when no one stopped it (ADP-4, follow-up). The production CodexDriver ends
// a provider whose stream failed, that exceeded its output limit, or whose
// turn completed while it was still running through the same one tree
// termination as a stop. The provider is the DETERMINISTIC FAKE
// `codex app-server` (fake-codex-app-server.mjs) with FAKE_CODEX_FORK=1, in its
// `garbled`, `large` and `linger` modes. No model is invoked, and every
// process started here is the fake or one of its two idle descendants.
import { test } from "node:test";

import { ProviderProcesses } from "../../../apps/vestra-cli/src/task/task-process-tree.ts";
import { CodexDriver } from "../../../packages/drivers/src/index.ts";
import { codexFixture } from "../../../tests/helpers/codex-driver-fixture.mjs";
import { providerEndSuite } from "../../../tests/helpers/process-tree-fixture.mjs";

// invariant: the terminator is the one `vestra task` hands this driver, and a
// tree it could not confirm stopped would be named in `reported`.
const reported = [];
const providers = new ProviderProcesses({ stderr: (text) => reported.push(text) });

providerEndSuite(test, {
  label: "codex",
  terminator: providers.session("Codex").terminateTree,
  reported,
  build: (dependencies, mode, { fork = false, ...execution } = {}) => {
    const environment = { FAKE_CODEX_MODE: mode, ...(fork ? { FAKE_CODEX_FORK: "1" } : {}) };
    const fixture = codexFixture({ environment, ...execution });
    return { driver: new CodexDriver(fixture.dependencies(dependencies)), request: fixture.request() };
  },
  ends: [
    { name: "writes a line that is not JSON", mode: "garbled", errors: ["VES_CODEX_STREAM_INVALID"], outcome: "failed" },
    {
      name: "exceeds its output limit",
      mode: "large",
      execution: { maxOutputBytes: 2048 },
      errors: ["VES_CODEX_OUTPUT_LIMIT"],
      outcome: "failed"
    },
    { name: "completes its turn without exiting", mode: "linger", errors: [], outcome: "completed" }
  ]
});
