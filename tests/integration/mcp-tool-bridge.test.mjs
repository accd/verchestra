import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";

import { MCP_BRIDGE_TOOLS } from "../../packages/agent-runtime/src/index.ts";
import { bridgeWorktree, cleanupBridges, openController, startRelay } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";

afterEach(cleanupBridges);

const text = (result) => result.content.map((entry) => entry.text).join("");

test("the relay completes the MCP handshake and lists exactly the five bridge tools", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { worktree } = await bridgeWorktree();
  const { controller } = await openController(worktree);
  const relay = startRelay(controller.environment);
  const initialized = await relay.initialize();
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  assert.deepEqual(initialized.result.serverInfo, { name: "verchestra", version: "1.0.0" });
  assert.deepEqual(initialized.result.capabilities, { tools: { listChanged: false } });
  const listed = await relay.request("tools/list");
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [...MCP_BRIDGE_TOOLS]
  );
  for (const tool of listed.result.tools) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(await relay.request("ping"), { jsonrpc: "2.0", id: 3, result: {} });
  assert.equal(await relay.close(), 0);
});

test("read tools serve scoped content and hide everything outside the approved scope", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { worktree } = await bridgeWorktree();
  const { controller } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  const read = await relay.call("read_file", { path: "src/a.txt" });
  assert.equal(read.isError, false);
  assert.equal(text(read), "alpha needle\nsecond line\n");
  const partial = await relay.call("read_file", { path: "src/a.txt", offset: 6, length: 6 });
  assert.match(text(partial), /^needle\n\[verchestra: truncated; continue at offset 12 of 25 bytes\]$/u);
  const root = JSON.parse(text(await relay.call("list_dir", { path: "." })));
  assert.deepEqual(root.entries, [{ name: "src", type: "directory" }]);
  const source = JSON.parse(text(await relay.call("list_dir", { path: "src" })));
  assert.deepEqual(source.entries, [
    { name: "a.txt", type: "file" },
    { name: "nested", type: "directory" }
  ]);
  const found = JSON.parse(text(await relay.call("search", { query: "needle" })));
  assert.deepEqual(
    found.matches.map((match) => `${match.path}:${match.line}`),
    ["src/a.txt:1", "src/nested/b.txt:1"]
  );
  await relay.close();
});

test("write_file and delete_file become executor tool requests addressed by content digest", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { worktree } = await bridgeWorktree();
  const { controller, invoked, payloads } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  const content = "implemented by the model\n";
  const written = await relay.call("write_file", { path: "src/a.txt", content });
  assert.equal(written.isError, false);
  assert.equal(text(written), "wrote src/a.txt; receipt receipt:1");
  const deleted = await relay.call("delete_file", { path: "src/nested/b.txt" });
  assert.equal(text(deleted), "deleted src/nested/b.txt; receipt receipt:2");
  const digest = createHash("sha256").update(content).digest("hex");
  assert.equal(invoked.length, 2);
  assert.match(invoked[0].requestId, /^bridge:[a-f0-9]{16}:1$/u);
  assert.deepEqual(
    { ...invoked[0], requestId: undefined },
    {
      requestId: undefined,
      taskId: "T405.4",
      capabilityGrantRef: "grant:writer:1",
      operation: "write",
      targetPaths: ["src/a.txt"],
      payloadRef: `payload:sha256:${digest}`
    }
  );
  assert.equal(new TextDecoder().decode(await payloads.get(invoked[0].payloadRef)), content);
  assert.equal(invoked[1].operation, "delete");
  assert.equal(invoked[1].payloadRef, "payload:none");
  assert.notEqual(invoked[1].requestId, invoked[0].requestId);
  assert.deepEqual(controller.statistics(), { calls: 2, writes: 1, deletes: 1, denied: 0, rejectedConnections: 0 });
  await relay.close();
});

test("an executor denial returns to the model as a tool error and a fatal denial stops the run", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { worktree } = await bridgeWorktree();
  const denials = ["VES_EXECUTOR_SCOPE_DENIED", "VES_EXECUTOR_APPROVAL_INVALID"];
  const { controller, fatal } = await openController(worktree, {
    invokeTool: async () => {
      throw Object.assign(new Error("denied with /private/detail"), { code: denials.shift() });
    }
  });
  const relay = startRelay(controller.environment);
  await relay.initialize();
  const scope = await relay.call("write_file", { path: "docs/x.txt", content: "x" });
  assert.deepEqual(scope, { content: [{ type: "text", text: "denied: VES_EXECUTOR_SCOPE_DENIED" }], isError: true });
  assert.equal(fatal.length, 0);
  const approval = await relay.call("write_file", { path: "src/a.txt", content: "x" });
  assert.equal(text(approval), "denied: VES_EXECUTOR_APPROVAL_INVALID");
  assert.equal(fatal.length, 1);
  await relay.close();
});

test("protocol errors are answered without reaching the controller", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { worktree } = await bridgeWorktree();
  const { controller, invoked } = await openController(worktree);
  const relay = startRelay(controller.environment);
  await relay.initialize();
  assert.equal((await relay.request("resources/list")).error.code, -32601);
  const unknown = await relay.call("run_command", { command: "rm -rf /" });
  assert.equal(text(unknown), "denied: VES_BRIDGE_TOOL_UNKNOWN");
  const extra = await relay.call("read_file", { path: "src/a.txt", follow: true });
  assert.equal(text(extra), "denied: VES_BRIDGE_ARGUMENTS_INVALID");
  relay.raw("{not json}\n");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(relay.unmatched.at(-1).error.code, -32700);
  assert.equal(invoked.length, 0);
  await relay.close();
});
