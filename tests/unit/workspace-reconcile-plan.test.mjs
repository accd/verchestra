import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkspaceReconcileService } from "../../packages/application/src/sync/workspace-reconcile.ts";

import { canonical, createService, input, opId, project, projection } from "../helpers/workspace-reconcile-fixture.mjs";

// Unit-level reconciliation plans: which topology operation each registry
// change becomes, which directions resolve them, which effects follow, and the
// first validation each malformed registry fails.

async function seeded(configuration = canonical()) {
  const context = createService(WorkspaceReconcileService);
  await context.service.execute(input(configuration));
  return context;
}

const kinds = (result) => result.operations.map((entry) => [entry.kind, entry.operationId]);

test("a first sync adds every Project and reconciles without a direction", async () => {
  const { service, store } = createService(WorkspaceReconcileService);
  const result = await service.execute(
    input(canonical({ projects: [project("orders", "services/orders"), project("billing", "services/billing")] }))
  );
  assert.equal(result.status, "reconciled");
  assert.deepEqual(kinds(result), [
    ["added", opId("add", "orders")],
    ["added", opId("add", "billing")]
  ]);
  assert.equal(result.stateChanged, true);
  assert.equal(store.writes, 1);
});

test("a Project that both moves and retires yields both operations, each needing acceptance", async () => {
  const { service, store } = await seeded();
  const result = await service.execute(
    input(canonical({ projects: [project("orders", "apps/orders", { state: "retired" })] }))
  );
  assert.equal(result.status, "direction-required");
  assert.deepEqual(kinds(result), [
    ["moved", opId("move", "orders")],
    ["retired", opId("retire", "orders")]
  ]);
  assert.deepEqual(result.unresolvedDirections, [opId("move", "orders"), opId("retire", "orders")]);
  assert.deepEqual(result.localRebuildRequirements, []);
  assert.equal(result.stateChanged, false);
  assert.equal(store.writes, 1);
});

test("accepting only one of two operations leaves the other unresolved", async () => {
  const { service } = await seeded();
  const result = await service.execute(
    input(canonical({ projects: [project("orders", "apps/orders", { state: "retired" })] }), {
      directions: { [opId("move", "orders")]: "accept" }
    })
  );
  assert.deepEqual(result.unresolvedDirections, [opId("retire", "orders")]);
});

test("a split consumes its predecessor, so it is not also reported missing", async () => {
  const { service } = await seeded();
  const result = await service.execute(
    input(
      canonical({
        projects: [
          project("orders-api", "services/orders-api", { predecessorProjectIds: ["orders"] }),
          project("orders-worker", "services/orders-worker", { predecessorProjectIds: ["orders"] })
        ]
      })
    )
  );
  assert.deepEqual(kinds(result), [["split", opId("split", "orders")]]);
  assert.deepEqual(result.operations[0].fromPaths, ["services/orders"]);
  assert.deepEqual(result.operations[0].toPaths, ["services/orders-api", "services/orders-worker"]);
});

test("successors of an unknown predecessor are neither a split nor added", async () => {
  const { service } = await seeded();
  const result = await service.execute(
    input(
      canonical({
        projects: [
          project("orders", "services/orders"),
          project("api", "api", { predecessorProjectIds: ["ledger"] }),
          project("web", "web", { predecessorProjectIds: ["ledger"] })
        ]
      })
    )
  );
  assert.deepEqual(result.operations, []);
});

test("a merge consumes every predecessor and records their prior paths", async () => {
  const { service } = await seeded(
    canonical({ projects: [project("orders", "orders"), project("billing", "billing")] })
  );
  const result = await service.execute(
    input(
      canonical({ projects: [project("commerce", "commerce", { predecessorProjectIds: ["orders", "billing"] })] }),
      { directions: { [opId("merge", "commerce")]: "accept" } }
    )
  );
  assert.equal(result.status, "reconciled");
  assert.deepEqual(kinds(result), [["merged", opId("merge", "commerce")]]);
  assert.deepEqual(result.operations[0].fromPaths, ["billing", "orders"]);
});

test("a multi-parent Project with an unknown predecessor is added, and the known one goes missing", async () => {
  const { service } = await seeded();
  const result = await service.execute(
    input(canonical({ projects: [project("commerce", "commerce", { predecessorProjectIds: ["orders", "ledger"] })] }))
  );
  assert.deepEqual(
    result.operations.map((entry) => entry.kind),
    ["added", "missing"]
  );
});

test("a drifted projection without a direction plans no effect; a direction plans exactly one", async () => {
  const { service } = await seeded(canonical({ projections: [projection()] }));
  const unversioned = projection({ observedRemoteDigest: "sha256:human-edit" });
  delete unversioned.observedRemoteVersion;
  const drifted = canonical({ projections: [unversioned] });
  const unresolved = await service.execute(input(drifted));
  assert.deepEqual(unresolved.unresolvedDirections, ["projection-drift:projection-orders-jira"]);
  assert.deepEqual(unresolved.effects, []);
  const accepted = await service.execute(
    input(drifted, { directions: { "projection-drift:projection-orders-jira": "accept" } })
  );
  assert.deepEqual(accepted.unresolvedDirections, ["projection-drift:projection-orders-jira"]);
  const pushed = await service.execute(
    input(drifted, { directions: { "projection-drift:projection-orders-jira": "canonical-to-remote" } })
  );
  assert.equal(pushed.status, "reconciled");
  assert.deepEqual(pushed.effects, [
    {
      kind: "upsert-projection",
      projectionId: "projection-orders-jira",
      connectorId: "jira",
      canonicalDigest: "sha256:canonical",
      observedRemoteDigest: "sha256:human-edit"
    }
  ]);
});

test("uncertain effects are planned after projection effects, ordered by effect ID", async () => {
  const { service } = await seeded(canonical({ projections: [projection()] }));
  const result = await service.execute(
    input(canonical({ projections: [projection()] }), {
      directions: { "projection-drift:projection-orders-jira": "remote-to-canonical" },
      uncertainEffects: [
        { effectId: "effect-b", connectorId: "jira", correlationMarker: "m-b", inputDigest: "sha256:b" },
        { effectId: "effect-a", connectorId: "jira", correlationMarker: "m-a", inputDigest: "sha256:a" }
      ]
    })
  );
  assert.deepEqual(
    result.effects.map((entry) => [entry.kind, entry.effectId ?? entry.projectionId]),
    [
      ["import-remote-projection", "projection-orders-jira"],
      ["reconcile-effect", "effect-a"],
      ["reconcile-effect", "effect-b"]
    ]
  );
  assert.equal(result.effects[0].expectedRemoteVersion, "7");
});

test("a stored state for another Workspace fails closed before its digest is checked", async () => {
  const { service, store } = await seeded();
  store.state = { ...store.state, workspaceId: "workspace_other", stateDigest: "sha256:wrong" };
  await assert.rejects(service.execute(input()), {
    code: "VES_SYNC_STATE_INVALID",
    message: "Stored sync state belongs to another Workspace"
  });
});

test("a stored state whose digest does not match its content fails closed", async () => {
  const { service, store } = await seeded();
  store.state = { ...store.state, stateDigest: "sha256:wrong" };
  await assert.rejects(service.execute(input()), {
    code: "VES_SYNC_STATE_INVALID",
    message: "Stored sync state digest does not match its content"
  });
});

for (const [name, configuration, message] of [
  [
    "an invalid project identity",
    canonical({ projects: [project("not-a-stable-id", "orders")] }),
    "Project identity, path, or lineage is invalid"
  ],
  [
    "an invalid logical path",
    canonical({ projects: [project("orders", "../escape")] }),
    "Project identity, path, or lineage is invalid"
  ],
  [
    "an invalid predecessor identity",
    canonical({ projects: [project("orders", "orders", { predecessorProjectIds: ["bad id"] })] }),
    "Project identity, path, or lineage is invalid"
  ],
  [
    "a duplicated project identity",
    canonical({ projects: [project("orders", "a"), project("orders", "b")] }),
    "Project registry contains ambiguous identity or lineage"
  ],
  [
    "a duplicated logical path",
    canonical({ projects: [project("orders", "a"), project("billing", "a")] }),
    "Project registry contains ambiguous identity or lineage"
  ],
  [
    "a Project that is its own predecessor",
    canonical({ projects: [project("orders", "a", { predecessorProjectIds: ["orders"] })] }),
    "Project registry contains ambiguous identity or lineage"
  ],
  [
    "a projection for an unknown Project",
    canonical({ projections: [projection({ projectId: "billing" })] }),
    "Projection mapping is ambiguous or references an unknown Project"
  ],
  [
    "a duplicated projection",
    canonical({ projections: [projection(), projection()] }),
    "Projection mapping is ambiguous or references an unknown Project"
  ],
  [
    "an empty projection connector",
    canonical({ projections: [projection({ connectorId: " " })] }),
    "Connector ID is invalid"
  ]
]) {
  test(`${name} fails closed with no write`, async () => {
    const { service, store } = createService(WorkspaceReconcileService);
    await assert.rejects(service.execute(input(configuration)), { code: "VES_SYNC_INPUT_INVALID", message });
    assert.equal(store.writes, 0);
  });
}

test("the workspace identity is checked before any Project", async () => {
  const { service } = createService(WorkspaceReconcileService);
  await assert.rejects(
    service.execute(
      input(canonical({ workspaceId: "nope", projects: [project("orders", "orders"), project("orders", "x")] }))
    ),
    { code: "VES_SYNC_INPUT_INVALID", message: "Workspace identity is invalid" }
  );
});
