import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { CedarPolicyAdapter, PolicyActivationService } from "../../packages/policy/src/index.ts";
import { RuntimePolicyViewStore, RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { cedar, lowerPermit, view } from "../helpers/policy-fixture.mjs";

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-policy-"));
  const runtime = new RuntimeStore({ dbPath: join(root, "runtime.sqlite") });
  runtime.open();
  const store = new RuntimePolicyViewStore({ runtimeStore: runtime, workspaceId });
  const service = new PolicyActivationService({ validator: new CedarPolicyAdapter({ engine: cedar }), store });
  return { root, runtime, store, service };
}

test("last-known-good policy view survives SQLite restart", async () => {
  const context = await fixture();
  try {
    const activated = await context.service.activate(view());
    context.runtime.close();
    context.runtime.open();
    const stored = await context.store.load();
    assert.equal(stored.generation, 1);
    assert.equal(stored.policyViewDigest, activated.policyViewDigest);
    assert.deepEqual(stored.layers, view().layers);
  } finally {
    context.runtime.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("invalid candidate preserves active SQLite policy and runtime digest", async () => {
  const context = await fixture();
  try {
    await context.service.activate(view());
    const before = context.runtime.stateDigest();
    const candidate = view({ generation: 2 });
    candidate.layers.project = { expand: lowerPermit };
    const result = await context.service.activate(candidate);
    assert.equal(result.code, "VES_POLICY_NON_MONOTONIC");
    assert.equal(context.runtime.stateDigest(), before);
    assert.equal((await context.store.load()).generation, 1);
  } finally {
    context.runtime.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("unchanged activation is a byte-stable SQLite no-op", async () => {
  const context = await fixture();
  try {
    await context.service.activate(view());
    const before = context.runtime.stateDigest();
    const result = await context.service.activate(view());
    assert.equal(result.status, "unchanged");
    assert.equal(context.runtime.stateDigest(), before);
  } finally {
    context.runtime.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("stale generation CAS cannot replace the runtime winner", async () => {
  const context = await fixture();
  try {
    const first = await context.service.activate(view());
    const validator = new CedarPolicyAdapter({ engine: cedar });
    const secondView = view({ generation: 2 });
    const candidate = { ...secondView, policyViewDigest: validator.validateView(secondView).policyViewDigest };
    const winner = context.runtime.saveActivePolicyView(
      workspaceId,
      JSON.stringify(candidate),
      candidate.policyViewDigest,
      1
    );
    const thirdView = view({ generation: 3 });
    const thirdCandidate = { ...thirdView, policyViewDigest: validator.validateView(thirdView).policyViewDigest };
    const stale = context.runtime.saveActivePolicyView(
      workspaceId,
      JSON.stringify(thirdCandidate),
      thirdCandidate.policyViewDigest,
      1
    );
    assert.equal(first.status, "activated");
    assert.deepEqual(winner, { activated: true, conflict: false });
    assert.deepEqual(stale, { activated: false, conflict: true });
    assert.equal(context.runtime.getActivePolicyView(workspaceId).generation, 2);
  } finally {
    context.runtime.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

test("tampered persisted Policy View digest fails closed on load", async () => {
  const context = await fixture();
  try {
    await context.service.activate(view());
    context.runtime.close();
    const database = new DatabaseSync(join(context.root, "runtime.sqlite"));
    database.prepare("UPDATE active_policy_views SET view_json=?").run(JSON.stringify({ generation: 99 }));
    database.close();
    context.runtime.open();
    assert.throws(() => context.runtime.getActivePolicyView(workspaceId), { code: "VES_RUNTIME_CORRUPT" });
  } finally {
    context.runtime.close();
    await rm(context.root, { recursive: true, force: true });
  }
});
