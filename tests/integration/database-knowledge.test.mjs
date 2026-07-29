import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDatabaseKnowledgePackage,
  importDdlSchemaSource,
  importIntrospectionSchemaSource,
  planSyntheticSeedScenarios,
  promoteProbeEvidence,
  resolveDatabaseContradiction
} from "../../packages/data-probe/src/database-knowledge.ts";
import {
  databaseId,
  probePromotion,
  schemaSource,
  seedInput,
  workspaceId
} from "../helpers/database-knowledge-fixture.mjs";

function knowledge(sources = [importDdlSchemaSource(schemaSource())]) {
  return buildDatabaseKnowledgePackage({ schemaVersion: 1, workspaceId, databaseId, generation: 1, sources });
}
test("Probe promotion records every required provenance field without rows", () => {
  const evidence = promoteProbeEvidence(probePromotion());
  assert.equal(evidence.databaseId, databaseId);
  assert.deepEqual(evidence.schemaIdentity, { version: "migration-042", fingerprint: `sha256:${"6".repeat(64)}` });
  assert.match(evidence.evidenceDigest, /^sha256:/u);
  assert.equal(JSON.stringify(evidence).includes("protected-result"), false);
  assert.equal(Object.hasOwn(evidence, "rows"), false);
});
test("Probe promotion retains bounds, classifications, redaction, result digest, and producing run", () => {
  const evidence = promoteProbeEvidence(probePromotion());
  assert.deepEqual(evidence.bounds, { timeoutMs: 2000, rowLimit: 100, byteLimit: 100000, concurrencyLimit: 1 });
  assert.deepEqual(evidence.parameterClassifications, ["internal"]);
  assert.equal(evidence.redaction.humanReviewRef, "human-review-probe-001");
  assert.equal(evidence.resultDigest, `sha256:${"4".repeat(64)}`);
  assert.match(evidence.producingRunId, /^run-/u);
});
test("accepted sanitized claims remain explicitly untrusted schema evidence", () => {
  const evidence = promoteProbeEvidence(probePromotion());
  assert.equal(evidence.schemaVersion, 2);
  assert.deepEqual(evidence.sanitizedClaims[0], {
    factKey: "public.orders.column.status.data_type",
    classification: "internal",
    valueDigest: "sha256:0a3c10f586d34a2e4d05631102429adcf892474b8bde22788961d0998e0e75af",
    untrusted: true
  });
  assert.equal(evidence.promotionStatus, "accepted-sanitized");
  assert.equal(JSON.stringify(evidence).includes("varchar"), false);
});
test("seed planner produces nominal, required, and unique synthetic scenarios", () => {
  const plan = planSyntheticSeedScenarios(seedInput(knowledge()));
  assert.deepEqual([...new Set(plan.scenarios.map((scenario) => scenario.caseKind))].sort(), [
    "missing-required",
    "nominal",
    "unique-collision"
  ]);
  assert.equal(
    plan.scenarios.every((scenario) => scenario.materialization === "synthetic-only"),
    true
  );
  assert.equal(plan.productionDataAllowed, false);
});
test("seed scenarios trace to exact requirement and acceptance criterion", () => {
  const plan = planSyntheticSeedScenarios(seedInput(knowledge()));
  assert.equal(
    plan.scenarios.every(
      (scenario) => scenario.requirementId === "VES-ORD-001" && scenario.criterionId === "AC-ORD-001"
    ),
    true
  );
});
test("seed scenarios reference generators and fixtures without materialized values", () => {
  const plan = planSyntheticSeedScenarios(seedInput(knowledge()));
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("factory.orders.v1"), true);
  assert.equal(serialized.includes("fixture.orders.boundary.v1"), true);
  assert.deepEqual(plan.fixtureDigests, [`sha256:${"7".repeat(64)}`]);
  assert.equal(serialized.includes("paid"), false);
  assert.equal(Object.hasOwn(plan.scenarios[0], "rows"), false);
});
test("policy-approved sanitized Probe evidence contributes only an evidence digest", () => {
  const evidence = promoteProbeEvidence(probePromotion());
  const plan = planSyntheticSeedScenarios(seedInput(knowledge(), [evidence]));
  assert.deepEqual(plan.sanitizedEvidenceDigests, [evidence.evidenceDigest]);
  assert.equal(JSON.stringify(plan).includes("customer_email"), false);
});
test("unresolved target-schema contradiction blocks seed planning", () => {
  const live = schemaSource("introspection");
  live.entities[0].columns[1].dataType = "text";
  const packageWithConflict = knowledge([importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]);
  assert.throws(() => planSyntheticSeedScenarios(seedInput(packageWithConflict)), {
    code: "VES_SEED_SCHEMA_UNRESOLVED"
  });
});
test("reviewed contradiction permits deterministic seed planning", () => {
  const live = schemaSource("introspection");
  live.entities[0].columns[1].dataType = "text";
  const unresolved = knowledge([importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]);
  const contradiction = unresolved.contradictions[0];
  const resolved = resolveDatabaseContradiction(unresolved, {
    contradictionId: contradiction.contradictionId,
    selectedValueDigest: contradiction.alternatives[0].valueDigest,
    humanReviewRef: "human-review-schema-001",
    resolvedAt: "2026-07-13T13:00:00.000Z"
  });
  assert.ok(planSyntheticSeedScenarios(seedInput(resolved)).scenarios.length > 0);
});
test("equivalent seed inputs produce the same plan digest", () => {
  const packageValue = knowledge();
  assert.equal(
    planSyntheticSeedScenarios(seedInput(packageValue)).planDigest,
    planSyntheticSeedScenarios(seedInput(packageValue)).planDigest
  );
});
