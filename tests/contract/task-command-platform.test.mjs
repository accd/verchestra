import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { executeTaskCommand } from "../../apps/vestra-cli/src/task/task-command.ts";

// invariant: on Windows every task command is refused as not configured
// before it reads a request, opens state, or reaches a credential store.
test("every task command refuses Windows as an unqualified platform before any effect", async () => {
  const controlRoot = await mkdtemp(join(tmpdir(), "verchestra-task-platform-"));
  try {
    for (const name of [
      "task plan",
      "task approve",
      "task start",
      "task resume",
      "task status",
      "task cancel",
      "task review"
    ]) {
      await assert.rejects(
        executeTaskCommand(
          { name, options: { request: join(controlRoot, "missing.json"), "run-id": "run_x", "binding-digest": "x" } },
          {
            controlRoot,
            platform: "win32",
            env: {},
            stdin: { isTTY: false, read: async () => assert.fail("stdin must not be read") },
            stderr: () => assert.fail("nothing is written"),
            pid: 1
          }
        ),
        (error) => {
          assert.equal(error.code, "VES_TASK_NOT_CONFIGURED");
          assert.equal(error.envelope.safeDetails.requirement, "platform");
          return true;
        }
      );
    }
    assert.deepEqual(await readdir(controlRoot), []);
  } finally {
    await rm(controlRoot, { recursive: true, force: true });
  }
});
