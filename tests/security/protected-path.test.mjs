import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { ProtectedPathBroker } from "../../packages/platform-node/src/index.ts";

const roots = [];
const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(options = {}) {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-path-"));
  roots.push(parent);
  const granted = join(parent, "granted");
  const outside = join(parent, "outside");
  await mkdir(granted);
  await mkdir(outside);
  await mkdir(join(granted, "safe-dir"));
  await writeFile(join(granted, "safe.txt"), "safe");
  await writeFile(join(outside, "secret.txt"), "outside");
  await writeFile(join(granted, "safe-dir", "value.txt"), "safe");
  await writeFile(join(outside, "value.txt"), "outside");
  const broker = await ProtectedPathBroker.create({
    workspaceId,
    roots: [{ rootId: "runtime", path: granted }],
    idSource: () => "path-handle-1",
    ...options
  });
  return { parent, granted, outside, broker };
}

test("broker reads through an authenticated opened file handle", async () => {
  const { broker } = await fixture();
  const handle = await broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "safe.txt" });
  assert.equal(await broker.readFile(handle, "utf8"), "safe");
  await broker.close(handle);
});

test("path handle serialization contains no absolute machine path", async () => {
  const { parent, broker } = await fixture();
  const handle = await broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "safe.txt" });
  assert.deepEqual(JSON.parse(JSON.stringify(handle)), {
    handleId: "path-handle-1",
    workspaceId,
    rootId: "runtime",
    logicalPath: "safe.txt"
  });
  assert.equal(JSON.stringify(handle).includes(parent), false);
  await broker.close(handle);
});

for (const logicalPath of [
  "../outside/secret.txt",
  "/outside/secret.txt",
  "sub/../../outside/secret.txt",
  "safe\\..\\secret.txt"
]) {
  test(`logical path rejects boundary escape: ${logicalPath}`, async () => {
    const { broker } = await fixture();
    await assert.rejects(broker.openExisting({ workspaceId, rootId: "runtime", logicalPath }), {
      code: "VES_PATH_LOGICAL_INVALID"
    });
  });
}

test("symlink or junction escape is rejected after resolution", async () => {
  const { granted, outside, broker } = await fixture();
  await symlink(outside, join(granted, "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "escape/secret.txt" }), {
    code: "VES_PATH_OUTSIDE_ROOT"
  });
});

test("requests from another Workspace are rejected before path access", async () => {
  const { broker } = await fixture();
  await assert.rejects(
    broker.openExisting({
      workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab",
      rootId: "runtime",
      logicalPath: "safe.txt"
    }),
    { code: "VES_PATH_WORKSPACE_MISMATCH" }
  );
});

test("broker creation rejects a non-canonical Workspace identity", async () => {
  const { granted } = await fixture();
  await assert.rejects(
    ProtectedPathBroker.create({ workspaceId: "../workspace", roots: [{ rootId: "runtime", path: granted }] }),
    { code: "VES_WORKSPACE_ID_INVALID" }
  );
});

test("broker creation rejects duplicate or malformed protected root IDs", async () => {
  const { granted } = await fixture();
  await assert.rejects(
    ProtectedPathBroker.create({
      workspaceId,
      roots: [
        { rootId: "runtime", path: granted },
        { rootId: "runtime", path: granted }
      ]
    }),
    { code: "VES_PATH_ROOT_INVALID" }
  );
  await assert.rejects(ProtectedPathBroker.create({ workspaceId, roots: [{ rootId: "../runtime", path: granted }] }), {
    code: "VES_PATH_ROOT_INVALID"
  });
});

test("unknown protected root is rejected", async () => {
  const { broker } = await fixture();
  await assert.rejects(broker.openExisting({ workspaceId, rootId: "unknown", logicalPath: "safe.txt" }), {
    code: "VES_PATH_ROOT_UNKNOWN"
  });
});

test("missing protected path maps to a stable safe error", async () => {
  const { broker } = await fixture();
  await assert.rejects(broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "missing.txt" }), {
    code: "VES_PATH_NOT_FOUND"
  });
});

test("plain objects cannot forge a path handle", async () => {
  const { broker } = await fixture();
  await assert.rejects(broker.readFile({ handleId: "path-handle-1" }, "utf8"), {
    code: "VES_PATH_HANDLE_INVALID"
  });
});

test("closed path handles cannot be reused", async () => {
  const { broker } = await fixture();
  const handle = await broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "safe.txt" });
  await broker.close(handle);
  await assert.rejects(broker.readFile(handle, "utf8"), { code: "VES_PATH_HANDLE_INVALID" });
});

test("path replacement between resolution and open fails closed", async () => {
  let granted;
  let outside;
  const { broker } = await fixture({
    hooks: {
      afterInitialResolution: async () => {
        await rm(join(granted, "safe-dir"), { recursive: true });
        await symlink(outside, join(granted, "safe-dir"), process.platform === "win32" ? "junction" : "dir");
      }
    }
  }).then((value) => {
    granted = value.granted;
    outside = value.outside;
    return value;
  });
  await assert.rejects(broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "safe-dir/value.txt" }), {
    code: "VES_PATH_CHANGED"
  });
});

test("path deletion between resolution and open maps to changed identity", async () => {
  let granted;
  const { broker } = await fixture({
    hooks: {
      afterInitialResolution: async () => rm(join(granted, "safe.txt"))
    }
  }).then((value) => {
    granted = value.granted;
    return value;
  });
  await assert.rejects(broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "safe.txt" }), {
    code: "VES_PATH_CHANGED"
  });
});

test("path replacement after open is detected before read", async () => {
  let granted;
  let outside;
  const { broker } = await fixture({
    hooks: {
      afterOpen: async () => {
        await rm(join(granted, "safe-dir"), { recursive: true });
        await symlink(outside, join(granted, "safe-dir"), process.platform === "win32" ? "junction" : "dir");
      }
    }
  }).then((value) => {
    granted = value.granted;
    outside = value.outside;
    return value;
  });
  await assert.rejects(broker.openExisting({ workspaceId, rootId: "runtime", logicalPath: "safe-dir/value.txt" }), {
    code: "VES_PATH_CHANGED"
  });
});
