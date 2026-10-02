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

// invariant: the mediated bridge reaches its controller over a Unix socket, so
// Windows refuses both the bridge and every mediated Claude Code profile by
// design. Following the platform-conditional qualification in
// spikes/os-secret-store, every mediated case on win32 asserts that refusal
// instead of skipping, so the sealed gate counters never record a skip and no
// case passes there without asserting.
export const WIN32_HOST = process.platform === "win32";

export async function mediationRefusedOnWin32(t) {
  t.diagnostic("win32: asserting the mediated bridge and Claude Code profile are refused instead");
  const socketRoot = await mkdtemp(join(tmpdir(), "verchestra-mediation-refused-"));
  try {
    await assert.rejects(
      McpToolBridgeController.open({
        worktreePath: socketRoot,
        readScope: ["src"],
        protectedPaths: [".git"],
        taskId: "T405.4",
        capabilityGrantRef: "grant:writer:1",
        payloads: new InMemoryExecutionPayloadStore(),
        invokeTool: async () => assert.fail("no tool is reachable"),
        socketRoot
      }),
      { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" }
    );
    assert.deepEqual(await readdir(socketRoot), [], "no bridge socket directory was created");
    for (const kind of ["mediated-mcp", "mediated-mcp-subscription"])
      assert.throws(
        () =>
          new ClaudeCodeDriver({
            command: [process.execPath, fakeClaude],
            profile: { kind },
            resolveExecution: async () => assert.fail("not reached")
          }),
        { code: "VES_CLAUDE_MEDIATION_UNSUPPORTED" },
        kind
      );
  } finally {
    await rm(socketRoot, { recursive: true, force: true });
  }
}
