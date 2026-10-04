import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../packages/agent-runtime/src/index.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/index.ts";

const fakeClaude = fileURLToPath(
  new URL("../../spikes/claude-code-driver/test/fake-claude-mediated.mjs", import.meta.url)
);

// invariant: the cases that call this drive the mediated bridge over its
// default Unix socket, which Windows does not have. On Windows the mediated
// profiles run only over the named pipe the composition hands the bridge and
// only with an owner-only proof of their isolation directory (T7, AD-074);
// that path is exercised for real by the `win32:` cases in
// tests/security/windows-pipe-bridge-security.test.mjs and by
// tests/e2e/task-windows-e2e.test.mjs. Following the platform-conditional
// qualification in spikes/os-secret-store, every such case on win32 asserts
// the Windows path instead of skipping, so the sealed gate counters never
// record a skip and no case passes there without asserting.
export const WIN32_HOST = process.platform === "win32";

const NO_PROOF = () => assert.fail("no isolation directory is created at construction");

export async function windowsMediationPath(t) {
  t.diagnostic("win32: asserting the Windows mediation path instead of the Unix socket");
  const socketRoot = await mkdtemp(join(tmpdir(), "verchestra-mediation-windows-"));
  try {
    await assert.rejects(
      McpToolBridgeController.open({
        worktreePath: socketRoot,
        readScope: ["src"],
        protectedPaths: [".git"],
        taskId: "T405.4",
        capabilityGrantRef: "grant:writer:1",
        payloads: new InMemoryExecutionPayloadStore(),
        invokeTool: () => assert.fail("no tool is reachable"),
        socketRoot
      }),
      { code: "VES_BRIDGE_TRANSPORT_REQUIRED" }
    );
    assert.deepEqual(await readdir(socketRoot), [], "no bridge socket directory was created");
    for (const kind of ["mediated-mcp", "mediated-mcp-subscription"]) {
      const options = {
        command: [process.execPath, fakeClaude],
        resolveExecution: () => assert.fail("not reached")
      };
      assert.throws(
        () => new ClaudeCodeDriver({ ...options, profile: { kind } }),
        { code: "VES_CLAUDE_MEDIATION_INVALID" },
        `${kind} without an owner-only proof`
      );
      assert.ok(new ClaudeCodeDriver({ ...options, profile: { kind, ownerOnlyProof: NO_PROOF } }), kind);
    }
  } finally {
    await rm(socketRoot, { recursive: true, force: true });
  }
}
