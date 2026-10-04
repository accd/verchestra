import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { executeTaskCommand } from "../../apps/vestra-cli/src/task/task-command.ts";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const COMMANDS = [
  "task plan",
  "task approve",
  "task start",
  "task resume",
  "task status",
  "task cancel",
  "task review"
];
const DIGEST = `sha256:${"0".repeat(64)}`;
const RUN_ID = `run_${randomUUID()}`;

async function outcome(name, platform, controlRoot) {
  try {
    await executeTaskCommand(
      {
        name,
        options: {
          request: join(controlRoot, "missing.json"),
          "run-id": RUN_ID,
          "binding-digest": DIGEST,
          outcome: "accepted",
          "surface-digest": DIGEST
        }
      },
      {
        controlRoot,
        platform,
        env: {},
        stdin: { isTTY: false, read: async () => assert.fail("stdin must not be read") },
        stderr: () => assert.fail("nothing is written"),
        pid: 1
      }
    );
  } catch (error) {
    return { code: error.code, safeDetails: error.envelope?.safeDetails };
  }
  return assert.fail(`${name} on ${platform} succeeded in an empty directory`);
}

// invariant: since the named-pipe transport qualified on a Windows runner
// (SSI-77), Windows is no longer refused as a platform. Every task command
// there reaches the same first check as on macOS, here a request file or a
// Workspace that does not exist, and nothing is written. What a Windows run
// needs from the machine is `not configured` with the prerequisite named
// (tests/unit/task-windows.test.mjs).
test("every task command treats Windows as a qualified platform and reaches its own first check", async (t) => {
  const controlRoot = await temporaryDirectory(t, "verchestra-task-platform-");
  for (const name of COMMANDS) {
    const windows = await outcome(name, "win32", controlRoot);
    const expected =
      name === "task plan"
        ? { code: "VES_TASK_REQUEST_REJECTED", safeDetails: { reason: "VES_TASK_REQUEST_UNREADABLE" } }
        : { code: "VES_INIT_WORKSPACE_MISSING", safeDetails: {} };
    assert.deepEqual(windows, expected, name);
    assert.deepEqual(await outcome(name, "darwin", controlRoot), expected, name);
  }
  assert.deepEqual(await readdir(controlRoot), []);
});
