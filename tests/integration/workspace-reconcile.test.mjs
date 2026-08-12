import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkspaceReconcileService } from "../../packages/application/src/index.ts";
import {
  MemorySyncStore,
  canonical,
  createService,
  generations,
  id,
  input,
  opId,
  project,
  projection,
  workspaceId
} from "../helpers/workspace-reconcile-fixture.mjs";

async function seeded(configuration = canonical()) {
  const context = createService(WorkspaceReconcileService);
  await context.service.execute(input(configuration));
  return context;
}

test("first sync registers Projects and creates a local rebuild requirement", async () => {
  const { service, store } = createService(WorkspaceReconcileService);
  const result = await service.execute(input());
  assert.equal(result.status, "reconciled");
  assert.equal(result.operations[0].kind, "added");
  assert.equal(result.localRebuildRequirements.length, 1);
  assert.equal(store.writes, 1);
});

test("unchanged sync has no operations, effects, rebuilds, or mutations", async () => {
  const { service, store } = await seeded();
  const firstDigest = store.state.stateDigest;
  const result = await service.execute(input());
  assert.deepEqual(result.operations, []);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.localRebuildRequirements, []);
  assert.equal(result.stateChanged, false);
  assert.equal(result.stateDigest, firstDigest);
  assert.equal(store.writes, 1);
});

test("input order cannot change resulting state digest", async () => {
  const projects = [project("orders", "z/orders"), project("billing", "a/billing")];
  const left = createService(WorkspaceReconcileService);
  const right = createService(WorkspaceReconcileService);
  const a = await left.service.execute(input(canonical({ projects })));
  const b = await right.service.execute(input(canonical({ projects: projects.toReversed() })));
  assert.equal(a.stateDigest, b.stateDigest);
});

// Issue #58: stateDigest and planDigest must not depend on the machine's
// ambient locale.
test("stateDigest and planDigest are byte-identical under two different ambient locales", async () => {
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const first = await createService(WorkspaceReconcileService).service.execute(input());
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const second = await createService(WorkspaceReconcileService).service.execute(input());
    assert.equal(first.stateDigest, second.stateDigest);
    assert.equal(first.planDigest, second.planDigest);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

for (const [name, configuration] of [
  ["unsupported schema", canonical({ schemaVersion: 2 })],
  ["newer minimum CLI", canonical({ minimumCliVersion: "2.0.0" })]
]) {
  test(`${name} fails before state load or mutation`, async () => {
    const store = new MemorySyncStore();
    const { service } = createService(WorkspaceReconcileService, store);
    await assert.rejects(service.execute(input(configuration)), {
      code: "VES_SYNC_CONFIG_INCOMPATIBLE",
      minimumCompatibleRelease: "2.0.0"
    });
    assert.equal(store.loads, 0);
    assert.equal(store.writes, 0);
  });
}

for (const [name, configuration] of [
  ["duplicate Project IDs", canonical({ projects: [project("orders", "a"), project("orders", "b")] })],
  ["duplicate logical paths", canonical({ projects: [project("a", "same"), project("b", "same")] })],
  ["unknown projection Project", canonical({ projections: [projection({ projectId: "missing" })] })],
  ["self lineage", canonical({ projects: [project("orders", "a", { predecessorProjectIds: ["orders"] })] })]
]) {
  test(`${name} is rejected without persistence`, async () => {
    const { service, store } = createService(WorkspaceReconcileService);
    await assert.rejects(service.execute(input(configuration)), { code: "VES_SYNC_INPUT_INVALID" });
    assert.equal(store.writes, 0);
  });
}

test("move is detected by stable Project ID and requires direction", async () => {
  const { service, store } = await seeded();
  const result = await service.execute(input(canonical({ projects: [project("orders", "apps/orders")] })));
  assert.equal(result.status, "direction-required");
  assert.deepEqual(result.operations[0], {
    operationId: opId("move", "orders"),
    kind: "moved",
    projectIds: [id("orders")],
    fromPaths: ["services/orders"],
    toPaths: ["apps/orders"],
    destructive: true,
    directionRequired: true
  });
  assert.equal(store.writes, 1);
});

test("authorized move preserves Project identity and persists new path", async () => {
  const { service, store } = await seeded();
  const configuration = canonical({ projects: [project("orders", "apps/orders")] });
  const result = await service.execute(input(configuration, { directions: { [opId("move", "orders")]: "accept" } }));
  assert.equal(result.status, "reconciled");
  assert.equal(store.state.projects[0].projectId, id("orders"));
  assert.equal(store.state.projects[0].logicalPath, "apps/orders");
});

test("missing Project requires explicit destructive direction", async () => {
  const { service, store } = await seeded();
  const result = await service.execute(input(canonical({ projects: [] })));
  assert.equal(result.operations[0].kind, "missing");
  assert.equal(result.status, "direction-required");
  assert.equal(store.writes, 1);
});

test("authorized missing Project removes only that stable identity", async () => {
  const initial = canonical({ projects: [project("a", "a"), project("b", "b")] });
  const { service, store } = await seeded(initial);
  await service.execute(
    input(canonical({ projects: [project("b", "b")] }), {
      directions: { [opId("missing", "a")]: "accept" }
    })
  );
  assert.deepEqual(
    store.state.projects.map((entry) => entry.projectId),
    [id("b")]
  );
});

test("explicit retirement requires direction", async () => {
  const { service } = await seeded();
  const result = await service.execute(
    input(canonical({ projects: [project("orders", "services/orders", { state: "retired" })] }))
  );
  assert.equal(result.operations[0].kind, "retired");
  assert.equal(result.status, "direction-required");
});

test("authorized retirement keeps the Project registry record", async () => {
  const { service, store } = await seeded();
  const configuration = canonical({ projects: [project("orders", "services/orders", { state: "retired" })] });
  await service.execute(input(configuration, { directions: { [opId("retire", "orders")]: "accept" } }));
  assert.equal(store.state.projects[0].state, "retired");
});

test("split is recognized only from explicit lineage", async () => {
  const { service } = await seeded();
  const projects = [
    project("orders-api", "services/orders-api", { predecessorProjectIds: ["orders"] }),
    project("orders-worker", "services/orders-worker", { predecessorProjectIds: ["orders"] })
  ];
  const result = await service.execute(input(canonical({ projects })));
  assert.equal(result.operations.filter((entry) => entry.kind === "split").length, 1);
  assert.deepEqual(result.operations.find((entry) => entry.kind === "split").projectIds, [
    id("orders"),
    id("orders-api"),
    id("orders-worker")
  ]);
});

test("authorized split persists successors and their lineage", async () => {
  const { service, store } = await seeded();
  const projects = [
    project("orders-api", "api", { predecessorProjectIds: ["orders"] }),
    project("orders-worker", "worker", { predecessorProjectIds: ["orders"] })
  ];
  await service.execute(input(canonical({ projects }), { directions: { [opId("split", "orders")]: "accept" } }));
  assert.deepEqual(
    store.state.projects.map((entry) => entry.projectId),
    [id("orders-api"), id("orders-worker")]
  );
});

test("merge is recognized only from explicit multi-parent lineage", async () => {
  const initial = canonical({ projects: [project("orders", "orders"), project("billing", "billing")] });
  const { service } = await seeded(initial);
  const projects = [project("commerce", "commerce", { predecessorProjectIds: ["orders", "billing"] })];
  const result = await service.execute(input(canonical({ projects })));
  assert.equal(result.operations.filter((entry) => entry.kind === "merged").length, 1);
  assert.equal(result.operations.find((entry) => entry.kind === "merged").operationId, opId("merge", "commerce"));
});

test("authorized merge preserves all predecessor IDs as lineage", async () => {
  const initial = canonical({ projects: [project("orders", "orders"), project("billing", "billing")] });
  const { service, store } = await seeded(initial);
  const projects = [project("commerce", "commerce", { predecessorProjectIds: ["orders", "billing"] })];
  await service.execute(input(canonical({ projects }), { directions: { [opId("merge", "commerce")]: "accept" } }));
  assert.deepEqual(store.state.projects[0].predecessorProjectIds, [id("orders"), id("billing")].sort());
});

test("a new Project without lineage is added and never guessed as a rename", async () => {
  const { service } = await seeded();
  const projects = [project("orders", "services/orders"), project("ledger", "services/ledger")];
  const result = await service.execute(input(canonical({ projects })));
  assert.equal(result.operations.find((entry) => entry.projectIds.includes(id("ledger"))).kind, "added");
});

test("a single successor lineage is added and predecessor is missing, never guessed as split", async () => {
  const { service } = await seeded();
  const projects = [project("orders-v2", "orders", { predecessorProjectIds: ["orders"] })];
  const result = await service.execute(input(canonical({ projects })));
  assert.equal(
    result.operations.some((entry) => entry.kind === "split"),
    false
  );
  assert.deepEqual(
    result.operations.map((entry) => entry.kind),
    ["added", "missing"]
  );
});

test("remote projection drift requires authorized reconciliation direction", async () => {
  const initial = canonical({ projections: [projection()] });
  const { service, store } = await seeded(initial);
  const drifted = projection({ observedRemoteDigest: "sha256:human-edit", observedRemoteVersion: "8" });
  const result = await service.execute(input(canonical({ projections: [drifted] })));
  assert.equal(result.status, "direction-required");
  assert.equal(result.operations[0].kind, "projection-drift");
  assert.equal(result.effects.length, 0);
  assert.equal(store.writes, 1);
});

for (const [direction, kind] of [
  ["canonical-to-remote", "upsert-projection"],
  ["remote-to-canonical", "import-remote-projection"]
]) {
  test(`${direction} projection direction produces the exact explicit effect`, async () => {
    const initial = canonical({ projections: [projection()] });
    const { service } = await seeded(initial);
    const configuration = canonical({
      projections: [projection({ observedRemoteDigest: "sha256:human-edit", observedRemoteVersion: "8" })]
    });
    const result = await service.execute(
      input(configuration, { directions: { "projection-drift:projection-orders-jira": direction } })
    );
    assert.equal(result.effects[0].kind, kind);
    assert.equal(result.effects[0].expectedRemoteVersion, "8");
  });
}

test("uncertain remote success is reconciled by marker and digest before retry", async () => {
  const { service } = await seeded();
  const result = await service.execute(
    input(canonical(), {
      uncertainEffects: [
        {
          effectId: "effect-1",
          connectorId: "jira",
          correlationMarker: "ves:run-1:projection-1",
          inputDigest: "sha256:input"
        }
      ]
    })
  );
  assert.deepEqual(result.effects, [
    {
      kind: "reconcile-effect",
      effectId: "effect-1",
      connectorId: "jira",
      correlationMarker: "ves:run-1:projection-1",
      inputDigest: "sha256:input",
      retryProhibited: true
    }
  ]);
});

for (const generation of ["release", "config", "skills", "data", "integrations"]) {
  test(`${generation} generation change requests a deterministic local rebuild`, async () => {
    const { service } = await seeded();
    const configuration = canonical({ generations: generations({ [generation]: `${generation}-2` }) });
    const result = await service.execute(input(configuration));
    assert.deepEqual(result.localRebuildRequirements[0].changedGenerations, [generation]);
    assert.equal(result.localRebuildRequirements[0].source, "canonical-sources-and-ingestion-manifests");
  });
}

test("ingestion manifest change triggers rebuild without tracking local database files", async () => {
  const { service } = await seeded();
  const configuration = canonical({
    ingestionManifests: [{ manifestId: "schema-orders", sourceDigest: "sha256:schema-v2" }]
  });
  const result = await service.execute(input(configuration));
  assert.deepEqual(result.localRebuildRequirements[0].manifestIds, ["schema-orders"]);
  assert.equal(JSON.stringify(result).includes(".sqlite"), false);
  assert.equal(JSON.stringify(result).includes("vector"), false);
});

test("multiple unresolved destructive operations prevent every canonical mutation", async () => {
  const initial = canonical({ projects: [project("a", "a"), project("b", "b")] });
  const { service, store } = await seeded(initial);
  const before = store.state.stateDigest;
  const result = await service.execute(input(canonical({ projects: [] })));
  assert.equal(result.unresolvedDirections.length, 2);
  assert.equal(store.state.stateDigest, before);
  assert.equal(store.writes, 1);
});

test("workspace binding cannot be switched through stored local state", async () => {
  const { service, store } = await seeded();
  store.state = { ...store.state, workspaceId: "workspace_other" };
  await assert.rejects(service.execute(input()), { code: "VES_SYNC_STATE_INVALID" });
});

test("tampered stored state is rejected before reconciliation", async () => {
  const { service, store } = await seeded();
  store.state = { ...store.state, projects: [project("tampered", "tampered")] };
  await assert.rejects(service.execute(input()), { code: "VES_SYNC_STATE_INVALID" });
  assert.equal(store.writes, 1);
});

test("state digest changes after an authorized canonical topology change", async () => {
  const { service, store } = await seeded();
  const before = store.state.stateDigest;
  await service.execute(
    input(canonical({ projects: [project("orders", "apps/orders")] }), {
      directions: { [opId("move", "orders")]: "accept" }
    })
  );
  assert.notEqual(store.state.stateDigest, before);
  assert.equal(store.state.workspaceId, workspaceId);
});
