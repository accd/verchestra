// invariant: AC 12 and AC 13 of .specs/features/probe-host-composition/plan.md.
// `vestra extension check` runs admission with no grant, so admission's
// VES_EXECUTION_GRANT_REQUIRED is the one outcome meaning every earlier
// prerequisite passed; any other outcome fails the prerequisite it names. On
// win32, `approve` and `check` refuse before they read the Workspace.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { executeExtensionCommand } from "../../apps/vestra-cli/src/extension/extension-command.ts";
import { evaluateAdmission } from "../../apps/vestra-cli/src/extension/extension-check.ts";
import { WorkspaceProbeAdmission } from "../../packages/extension-host/src/index.ts";
import {
  MemoryApprovals,
  approvalFor,
  extensionLock,
  extensionRegistry
} from "../helpers/spawned-probe-worker-fixture.mjs";

const ROWS = ["lock", "extension", "approval", "admission"];
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

function refusing(code) {
  return async () => {
    throw Object.assign(new Error("admission refused"), { code });
  };
}

function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

function assertFailed(rows, id, code) {
  const row = byId(rows)[id];
  assert.equal(row.status, "fail", `${id} ${code}`);
  assert.equal(row.code, code);
  assert.ok(typeof row.recovery === "string" && row.recovery.length > 0, `${id} names no recovery`);
  assert.ok(
    rows.every((other) => other.id === id || other.status !== "fail"),
    `${code} fails a row other than ${id}`
  );
}

test("only a grant-required admission passes", async () => {
  const passed = await evaluateAdmission(refusing("VES_EXECUTION_GRANT_REQUIRED"));
  assert.deepEqual(
    passed.map((row) => [row.id, row.status]),
    ROWS.map((id) => [id, "pass"])
  );
  // why: every row carries all four fields (Surface); a pass names no code.
  assert.ok(passed.every((row) => row.code === null && row.recovery === null));

  // why: the production admission, with the real registry and an approval on
  // record but no grant, ends exactly at the grant.
  const { lock, request } = extensionLock();
  const extension = await extensionRegistry().resolveExecutableExtension(lock, request);
  const admission = new WorkspaceProbeAdmission({
    extensions: extensionRegistry(),
    approvals: new MemoryApprovals([approvalFor(extension)])
  });
  const real = await evaluateAdmission(() =>
    admission.admit({ workspaceId: "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d", lock, request })
  );
  assert.ok(real.every((row) => row.status === "pass"));

  for (const [code, id] of [
    ["VES_PROBE_WORKSPACE_TRUST_APPROVAL", "approval"],
    ["VES_PROBE_WORKSPACE_TRUST_INVALID", "admission"],
    ["VES_SKILL_SIGNATURE_INVALID", "lock"],
    ["VES_SKILL_UNKNOWN", "extension"]
  ])
    assertFailed(await evaluateAdmission(refusing(code)), id, code);
  // An admission that succeeds without a grant is not a pass either.
  assertFailed(
    await evaluateAdmission(async () => ({ kind: "workspace" })),
    "admission",
    "VES_EXTENSION_ADMISSION_UNEXPECTED"
  );
});

test("approve and check refuse on win32", async () => {
  const root = await mkdtemp(join(tmpdir(), "vec-"));
  roots.push(root);
  // why: the control root does not exist, so any read of the Workspace would
  // fail with another code; the refusal therefore comes first.
  const missing = join(root, "no-workspace");
  const io = (platform) => ({
    controlRoot: missing,
    platform,
    env: {},
    stdin: process.stdin,
    stderr: () => undefined,
    pid: process.pid
  });
  const commands = [
    { name: "extension approve", options: { "approval-ref": "orders-probe-001", executable: "/usr/bin/node" } },
    { name: "extension check", options: { "approval-ref": "orders-probe-001" } }
  ];
  for (const command of commands) {
    await assert.rejects(
      executeExtensionCommand(command, io("win32")),
      (error) => error.envelope?.code === "VES_PROBE_HOST_PLATFORM_UNSUPPORTED",
      command.name
    );
    await assert.rejects(
      executeExtensionCommand(command, io("linux")),
      (error) => error.envelope?.code === "VES_INIT_WORKSPACE_MISSING",
      `${command.name} reads the Workspace on linux`
    );
  }
});
