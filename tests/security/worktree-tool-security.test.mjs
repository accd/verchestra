import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeWorktreeToolAdapter } from "../../packages/platform-node/src/index.ts";
import { cleanupWorktreeTools, worktreeToolFixture } from "../helpers/worktree-tool-fixture.mjs";

const outsideRoots = [];
afterEach(async () => {
  await cleanupWorktreeTools();
  await Promise.all(outsideRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function outside() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-tool-outside-"));
  outsideRoots.push(root);
  await writeFile(join(root, "victim.txt"), "untouched\n");
  return root;
}

for (const target of ["../escape.txt", "src/./x"]) {
  test(`traversal target ${JSON.stringify(target)} is refused before any effect`, async () => {
    const { adapter, request, repositoryRoot } = await worktreeToolFixture();
    await assert.rejects(adapter.invoke(request({ targetPaths: [target] })), { code: "VES_TOOL_PATH_ESCAPE" });
    await assert.rejects(access(join(repositoryRoot, "..", "escape.txt")), { code: "ENOENT" });
  });
}

test("a symbolic-link parent directory pointing outside the worktree is refused", async () => {
  const { adapter, request, worktreePath } = await worktreeToolFixture();
  const target = await outside();
  await symlink(target, join(worktreePath, "src", "linked"), "dir");
  await assert.rejects(adapter.invoke(request({ targetPaths: ["src/linked/victim.txt"] })), {
    code: "VES_TOOL_SYMLINK_DENIED"
  });
  assert.equal(await readFile(join(target, "victim.txt"), "utf8"), "untouched\n");
});

test("a symbolic-link final component is refused for write and delete", async () => {
  const { adapter, request, worktreePath } = await worktreeToolFixture();
  const target = await outside();
  await symlink(join(target, "victim.txt"), join(worktreePath, "src", "victim.txt"));
  await assert.rejects(adapter.invoke(request({ targetPaths: ["src/victim.txt"] })), {
    code: "VES_TOOL_SYMLINK_DENIED"
  });
  await assert.rejects(
    adapter.invoke(
      request({
        requestId: "bridge:delete",
        operation: "delete",
        payloadRef: "payload:none",
        targetPaths: ["src/victim.txt"]
      })
    ),
    { code: "VES_TOOL_SYMLINK_DENIED" }
  );
  assert.equal(await readFile(join(target, "victim.txt"), "utf8"), "untouched\n");
});

for (const target of [".git/hooks/pre-commit", ".verchestra/policy/rules.cedar"]) {
  test(`protected target ${JSON.stringify(target)} is refused`, async () => {
    const { adapter, request, worktreePath } = await worktreeToolFixture();
    await assert.rejects(adapter.invoke(request({ targetPaths: [target] })), { code: "VES_TOOL_PROTECTED_PATH" });
    await assert.rejects(access(join(worktreePath, ".verchestra")), { code: "ENOENT" });
  });
}

test("a command request is denied", async () => {
  const { adapter, request } = await worktreeToolFixture();
  await assert.rejects(adapter.invoke(request({ operation: "command" })), { code: "VES_TOOL_COMMAND_DENIED" });
});

test("content whose bytes do not match the payload digest is never written", async () => {
  const { adapter, payloads, request, worktreePath } = await worktreeToolFixture();
  const ref = payloads.put("approved content\n");
  payloads.entries.set(ref, new TextEncoder().encode("swapped content\n"));
  await assert.rejects(adapter.invoke(request({ payloadRef: ref })), { code: "VES_TOOL_PAYLOAD_INVALID" });
  assert.equal(await readFile(join(worktreePath, "src", "value.txt"), "utf8"), "base\n");
});

test("payload references must match their operation", async () => {
  const { adapter, request } = await worktreeToolFixture();
  await assert.rejects(adapter.invoke(request({ payloadRef: "payload:none" })), { code: "VES_TOOL_PAYLOAD_INVALID" });
  await assert.rejects(adapter.invoke(request({ operation: "delete" })), { code: "VES_TOOL_PAYLOAD_INVALID" });
});

test("a duplicate request ID bound to a different request fails closed without an effect", async () => {
  const { adapter, payloads, request, worktreePath } = await worktreeToolFixture();
  await adapter.invoke(request());
  await assert.rejects(adapter.invoke(request({ payloadRef: payloads.put("second content\n") })), {
    code: "VES_TOOL_REQUEST_CONFLICT"
  });
  await assert.rejects(adapter.invoke(request({ targetPaths: ["src/other.txt"] })), {
    code: "VES_TOOL_REQUEST_CONFLICT"
  });
  assert.equal(await readFile(join(worktreePath, "src", "value.txt"), "utf8"), "implemented\n");
  await assert.rejects(access(join(worktreePath, "src", "other.txt")), { code: "ENOENT" });
});

test("the adapter binds a request ID to its content even when the receipt store does not", async () => {
  const fixture = await worktreeToolFixture();
  const repository = fixture.store.createEffectRepository();
  // A permissive store that returns any existing intent for a key without
  // comparing its content: the adapter's own binding must still refuse.
  const permissive = {
    ...repository,
    insertOrGet: async (intent) => (await repository.get(intent.idempotencyKey)) ?? repository.insertOrGet(intent)
  };
  const adapter = new NodeWorktreeToolAdapter({
    workspaceId: "workspace_tool",
    worktrees: fixture.worktrees,
    receipts: permissive,
    payloads: fixture.payloads
  });
  await adapter.invoke(fixture.request());
  await assert.rejects(adapter.invoke(fixture.request({ payloadRef: fixture.payloads.put("second content\n") })), {
    code: "VES_TOOL_REQUEST_CONFLICT"
  });
  assert.equal(await readFile(join(fixture.worktreePath, "src", "value.txt"), "utf8"), "implemented\n");
});

test("a request naming several targets or unknown fields is refused", async () => {
  const { adapter, request } = await worktreeToolFixture();
  await assert.rejects(adapter.invoke(request({ targetPaths: ["src/a", "src/b"] })), {
    code: "VES_TOOL_REQUEST_INVALID"
  });
  await assert.rejects(adapter.invoke({ ...request(), shell: "sh" }), { code: "VES_TOOL_REQUEST_INVALID" });
});

test("a directory target is not overwritten", async () => {
  const { adapter, request, worktreePath } = await worktreeToolFixture();
  await mkdir(join(worktreePath, "src", "folder"));
  await assert.rejects(adapter.invoke(request({ targetPaths: ["src/folder"] })), { code: "VES_TOOL_PATH_ESCAPE" });
});

test("a handle for an unregistered worktree performs no effect", async () => {
  const { adapter, baseCommit, request } = await worktreeToolFixture();
  await assert.rejects(adapter.invoke(request({ worktreeRef: `worktree:${"e".repeat(32)}:${baseCommit}` })), {
    code: "VES_GIT_WORKTREE_NOT_FOUND"
  });
});
