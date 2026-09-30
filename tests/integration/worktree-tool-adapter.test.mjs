import assert from "node:assert/strict";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { NodeWorktreeToolAdapter } from "../../packages/platform-node/src/index.ts";

import { cleanupWorktreeTools, git, worktreeToolFixture } from "../helpers/worktree-tool-fixture.mjs";

afterEach(cleanupWorktreeTools);

test("a write creates missing parents and lands only inside the registered worktree", async () => {
  const { adapter, repositoryRoot, request, store, worktreePath } = await worktreeToolFixture();
  const result = await adapter.invoke(request({ targetPaths: ["src/new/deep/file.txt"] }));
  assert.match(result.receiptRef, /^receipt:tool-receipt-[a-f0-9]{40}$/u);
  assert.equal(await readFile(join(worktreePath, "src", "new", "deep", "file.txt"), "utf8"), "implemented\n");
  await assert.rejects(access(join(repositoryRoot, "src", "new")), { code: "ENOENT" });
  assert.deepEqual(
    receiptRows(store).map((row) => ({ ...row })),
    [{ adapter_id: "node-worktree-tool", attempt: 1, outcome: "applied" }]
  );
});

test("an overwrite keeps the file mode Git tracks", async () => {
  const { adapter, request, worktreePath } = await worktreeToolFixture();
  await adapter.invoke(request({ targetPaths: ["src/tool.sh"] }));
  // why: win32 keeps no executable bit, so there Git's own view, which reports
  // any mode change as a summary line, is the whole assertion.
  if (process.platform !== "win32")
    assert.equal((await stat(join(worktreePath, "src", "tool.sh"))).mode & 0o777, 0o755);
  assert.equal(git(worktreePath, "diff", "--summary"), "");
});

test("a delete removes the file and a delete of an absent file is already applied", async () => {
  const { adapter, request, worktreePath } = await worktreeToolFixture();
  await adapter.invoke(request({ operation: "delete", payloadRef: "payload:none" }));
  await assert.rejects(access(join(worktreePath, "src", "value.txt")), { code: "ENOENT" });
  const again = await adapter.invoke(
    request({
      requestId: "bridge:request:2",
      operation: "delete",
      payloadRef: "payload:none",
      targetPaths: ["src/absent/x"]
    })
  );
  assert.match(again.receiptRef, /^receipt:/u);
});

test("a duplicate request returns the original receipt without a second effect", async () => {
  const { adapter, request, worktreePath } = await worktreeToolFixture();
  const first = request();
  const receipt = await adapter.invoke(first);
  await writeFile(join(worktreePath, "src", "value.txt"), "changed after the receipt\n");
  const replay = await adapter.invoke({ ...first });
  assert.equal(replay.receiptRef, receipt.receiptRef);
  assert.equal(await readFile(join(worktreePath, "src", "value.txt"), "utf8"), "changed after the receipt\n");
});

function receiptRows(store) {
  const db = new DatabaseSync(store.dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT adapter_id, attempt, outcome FROM operation_receipts ORDER BY receipt_id").all();
  } finally {
    db.close();
  }
}

function crashingAdapter(fixture, overrides) {
  return new NodeWorktreeToolAdapter({
    workspaceId: "workspace_tool",
    worktrees: fixture.worktrees,
    receipts: { ...fixture.store.createEffectRepository(), ...overrides.receipts },
    payloads: overrides.payloads ?? fixture.payloads
  });
}

test("a crash after the write converges by observation without re-reading the payload", async () => {
  const fixture = await worktreeToolFixture();
  const pending = fixture.request();
  const crashing = crashingAdapter(fixture, {
    receipts: {
      complete: async () => {
        throw new Error("simulated crash before the receipt commit");
      }
    }
  });
  await assert.rejects(crashing.invoke(pending), /simulated crash/u);
  fixture.payloads.entries.clear();
  const converged = await fixture.adapter.invoke(pending);
  assert.match(converged.receiptRef, /^receipt:/u);
  assert.equal(await readFile(join(fixture.worktreePath, "src", "value.txt"), "utf8"), "implemented\n");
  assert.deepEqual(
    receiptRows(fixture.store).map((row) => ({ ...row })),
    [{ adapter_id: "node-worktree-tool", attempt: 1, outcome: "already-applied" }]
  );
});

test("a crash before the write re-applies the request as a second attempt", async () => {
  const fixture = await worktreeToolFixture();
  const pending = fixture.request();
  const crashing = crashingAdapter(fixture, {
    payloads: {
      get: async () => {
        throw new Error("simulated crash before the write");
      }
    }
  });
  await assert.rejects(crashing.invoke(pending), /simulated crash/u);
  assert.equal(await readFile(join(fixture.worktreePath, "src", "value.txt"), "utf8"), "base\n");
  await fixture.adapter.invoke(pending);
  assert.equal(await readFile(join(fixture.worktreePath, "src", "value.txt"), "utf8"), "implemented\n");
  assert.deepEqual(
    receiptRows(fixture.store).map((row) => ({ ...row })),
    [{ adapter_id: "node-worktree-tool", attempt: 2, outcome: "applied" }]
  );
  assert.deepEqual(await fixture.store.createEffectRepository().listDispatchable(10), []);
});

test("a definite denial is durable for its request", async () => {
  const fixture = await worktreeToolFixture();
  const pending = fixture.request();
  const missing = crashingAdapter(fixture, { payloads: { get: async () => undefined } });
  await assert.rejects(missing.invoke(pending), { code: "VES_TOOL_PAYLOAD_INVALID" });
  await assert.rejects(fixture.adapter.invoke(pending), { code: "VES_TOOL_EFFECT_FAILED" });
  assert.equal(await readFile(join(fixture.worktreePath, "src", "value.txt"), "utf8"), "base\n");
});

test("resolvePath returns the registered worktree and refuses an unknown handle", async () => {
  const { handle, worktrees, worktreePath } = await worktreeToolFixture();
  assert.equal(await worktrees.resolvePath(handle.worktreeRef), worktreePath);
  await assert.rejects(worktrees.resolvePath(`worktree:${"f".repeat(32)}:${handle.baseCommit}`), {
    code: "VES_GIT_WORKTREE_NOT_FOUND"
  });
  await assert.rejects(worktrees.resolvePath("worktree:../escape"), { code: "VES_GIT_WORKTREE_INPUT_INVALID" });
});
