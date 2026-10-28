import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDatabaseKnowledgePackage,
  importDdlSchemaSource,
  importOrmSchemaSource,
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

const SCHEMA_INVALID = "VES_DATABASE_SCHEMA_SOURCE_INVALID";
const KNOWLEDGE_INVALID = "VES_DATABASE_KNOWLEDGE_INVALID";
const SEED_INVALID = "VES_SEED_PLAN_INVALID";

const ordersColumns = () => schemaSource().entities[0].columns;
const customers = () => ({
  schema: "public",
  name: "customers",
  type: "table",
  columns: [{ name: "id", dataType: "uuid", nullable: false, primaryKey: true, unique: true }]
});
const knowledgeOf = (sources) =>
  buildDatabaseKnowledgePackage({ schemaVersion: 1, workspaceId, databaseId, generation: 1, sources });
const knowledge = () => knowledgeOf([importDdlSchemaSource(schemaSource())]);

const withColumn = (column) =>
  schemaSource("ddl", { entities: [{ ...schemaSource().entities[0], columns: [column] }] });

for (const [label, input, message] of [
  [
    "a column data type outside the type grammar",
    withColumn({ name: "id", dataType: "uuid;drop", nullable: false, primaryKey: true, unique: true }),
    /data type is invalid/u
  ],
  [
    "a data type checked before the constraints",
    withColumn({ name: "id", dataType: 7, nullable: "no", primaryKey: true, unique: true }),
    /data type is invalid/u
  ],
  [
    "a constraint that is not a boolean",
    withColumn({ name: "id", dataType: "uuid", nullable: false, primaryKey: "yes", unique: true }),
    /constraints are invalid/u
  ],
  [
    "a duplicated column",
    schemaSource("ddl", {
      entities: [{ ...schemaSource().entities[0], columns: [ordersColumns()[0], ordersColumns()[0]] }]
    }),
    /column is duplicated/u
  ],
  [
    "an invalid second column reported before the duplicate check",
    schemaSource("ddl", {
      entities: [
        { ...schemaSource().entities[0], columns: [ordersColumns()[0], { ...ordersColumns()[0], dataType: "" }] }
      ]
    }),
    /data type is invalid/u
  ],
  [
    "an entity type that is neither table nor view",
    schemaSource("ddl", { entities: [{ ...schemaSource().entities[0], type: "index", columns: [] }] }),
    /entity type is invalid/u
  ],
  [
    "an entity without columns",
    schemaSource("ddl", { entities: [{ ...schemaSource().entities[0], columns: [] }] }),
    /columns are invalid/u
  ],
  ["a source without entities", schemaSource("ddl", { entities: [] }), /entities are invalid/u],
  [
    "a duplicated entity",
    schemaSource("ddl", { entities: [schemaSource().entities[0], schemaSource().entities[0]] }),
    /entity is duplicated/u
  ]
])
  test(`schema import refuses ${label}`, () =>
    assert.throws(() => importDdlSchemaSource(input), { code: SCHEMA_INVALID, message }));

test("schema import normalizes the data type and keeps the constraints", () => {
  const source = importDdlSchemaSource(
    withColumn({ name: "id", dataType: "NUMERIC(10,  2)  ", nullable: true, primaryKey: false, unique: true })
  );
  assert.deepEqual(source.entities[0].columns, [
    { name: "id", dataType: "numeric(10, 2)", nullable: true, primaryKey: false, unique: true }
  ]);
});

test("a knowledge package refuses a source of an unknown kind", () => {
  const source = { ...importDdlSchemaSource(schemaSource()), kind: "spreadsheet" };
  assert.throws(() => knowledgeOf([source]), { code: KNOWLEDGE_INVALID, message: /source is invalid/u });
});

test("a knowledge package refuses a source whose digest does not match its content", () => {
  const source = { ...importDdlSchemaSource(schemaSource()), sourceDigest: `sha256:${"0".repeat(64)}` };
  assert.throws(() => knowledgeOf([source]), { code: KNOWLEDGE_INVALID, message: /source is invalid/u });
});

test("a knowledge package refuses a source for another database", () => {
  const source = importDdlSchemaSource(schemaSource("ddl", { databaseId: "orders-staging" }));
  assert.throws(() => knowledgeOf([source]), { code: KNOWLEDGE_INVALID, message: /source is invalid/u });
});

test("a knowledge package refuses one source identity with conflicting evidence", () => {
  const first = importDdlSchemaSource(schemaSource());
  const second = importDdlSchemaSource(schemaSource("ddl", { revision: "rev-002" }));
  assert.throws(() => knowledgeOf([first, second]), { code: "VES_DATABASE_SCHEMA_SOURCE_CONFLICT" });
});

test("a knowledge package keeps one copy of a repeated identical source", () => {
  const source = importDdlSchemaSource(schemaSource());
  assert.equal(knowledgeOf([source, source]).sources.length, 1);
});

test("a knowledge package without sources is refused", () =>
  assert.throws(() => knowledgeOf([]), { code: KNOWLEDGE_INVALID, message: /Package is invalid/u }));

test("an entity missing from one complete source is an explicit presence contradiction", () => {
  const withCustomers = importOrmSchemaSource(
    schemaSource("orm", { entities: [schemaSource().entities[0], customers()] })
  );
  const result = knowledgeOf([importDdlSchemaSource(schemaSource()), withCustomers]);
  const presence = result.facts.find((fact) => fact.factKey === "public.customers.present");
  assert.equal(presence.status, "contradictory");
  assert.deepEqual(presence.alternatives.map((item) => item.value).sort(), [false, true]);
  const entityType = result.facts.find((fact) => fact.factKey === "public.customers.entity_type");
  assert.deepEqual(entityType.alternatives[0].sourceIds, ["orm-orders-v1"]);
});

const promoted = () => structuredClone(promoteProbeEvidence(probePromotion()));
const planWithEvidence = (evidence) => planSyntheticSeedScenarios(seedInput(knowledge(), [evidence]));

test("approved promoted evidence is bound into the seed plan", () => {
  const evidence = promoted();
  assert.deepEqual(planWithEvidence(evidence).sanitizedEvidenceDigests, [evidence.evidenceDigest]);
});

for (const [label, mutate] of [
  ["a non-positive bound", (evidence) => (evidence.bounds.rowLimit = 0)],
  ["a negative row count", (evidence) => (evidence.rowCount = -1)],
  ["an unknown parameter classification", (evidence) => (evidence.parameterClassifications = ["top"])],
  ["an unknown redaction method", (evidence) => (evidence.redaction.method = "hash")],
  ["a malformed removed field", (evidence) => (evidence.redaction.removedFields = ["Customer Email"])],
  ["no sanitized claims", (evidence) => (evidence.sanitizedClaims = [])],
  ["a repeated fact key", (evidence) => evidence.sanitizedClaims.push({ ...evidence.sanitizedClaims[0] })],
  ["a secret-shaped fact key", (evidence) => (evidence.sanitizedClaims[0].factKey = "public.orders.token")],
  ["a confidential claim", (evidence) => (evidence.sanitizedClaims[0].classification = "confidential")],
  ["a claim marked trusted", (evidence) => (evidence.sanitizedClaims[0].untrusted = false)],
  ["a malformed claim digest", (evidence) => (evidence.sanitizedClaims[0].valueDigest = "sha256:x")],
  ["a digest that does not match the evidence", (evidence) => (evidence.rowCount = 4)]
])
  test(`a seed plan refuses promoted evidence with ${label}`, () => {
    const evidence = promoted();
    mutate(evidence);
    assert.throws(() => planWithEvidence(evidence), {
      code: SEED_INVALID,
      message: /Promoted Probe evidence is invalid/u
    });
  });

test("a seed plan refuses promoted evidence the policy does not allow", () => {
  const input = seedInput(knowledge(), [promoted()]);
  input.policy.allowedEvidenceDigests = [];
  assert.throws(() => planSyntheticSeedScenarios(input), { code: SEED_INVALID, message: /not approved/u });
});

const criterion = (overrides) => ({ ...seedInput(knowledge()).acceptanceCriteria[0], ...overrides });

for (const [label, overrides, message] of [
  ["an unknown plan version", { schemaVersion: 2 }, /plan version is invalid/u],
  ["no acceptance criteria", { acceptanceCriteria: [] }, /collections are invalid/u],
  ["fixtures that are not a list", { fixtures: {} }, /collections are invalid/u],
  ["a criterion with too little text", { acceptanceCriteria: [criterion({ when: "go" })] }, /criterion text/u],
  ["a criterion without targets", { acceptanceCriteria: [criterion({ targets: [] })] }, /targets are invalid/u],
  [
    "a target without a factory",
    { acceptanceCriteria: [criterion({ targets: ["public.customers"] })] },
    /factory is unavailable/u
  ],
  [
    "a factory that does not cover the target columns",
    {
      factories: [{ ...seedInput(knowledge()).factories[0], generators: { id: "uuid", status: "enum" } }]
    },
    /does not cover the target schema/u
  ],
  [
    "a factory generating a column the schema lacks",
    {
      factories: [
        {
          ...seedInput(knowledge()).factories[0],
          generators: { id: "uuid", status: "enum", note: "words", extra: "words" }
        }
      ]
    },
    /does not cover the target schema/u
  ]
])
  test(`a seed plan refuses ${label}`, () =>
    assert.throws(() => planSyntheticSeedScenarios({ ...seedInput(knowledge()), ...overrides }), {
      code: SEED_INVALID,
      message
    }));

test("a seed plan refuses a target with an unresolved schema contradiction before its factory", () => {
  const disagreeing = importOrmSchemaSource(
    schemaSource("orm", {
      entities: [{ ...schemaSource().entities[0], columns: [{ ...ordersColumns()[0], dataType: "text" }] }]
    })
  );
  const contested = knowledgeOf([importDdlSchemaSource(schemaSource()), disagreeing]);
  assert.throws(() => planSyntheticSeedScenarios({ ...seedInput(contested), factories: [] }), {
    code: "VES_SEED_SCHEMA_UNRESOLVED"
  });
});

test("a seed plan refuses a target the resolved schema says is absent", () => {
  const withCustomers = importOrmSchemaSource(
    schemaSource("orm", { entities: [schemaSource().entities[0], customers()] })
  );
  const contested = knowledgeOf([importDdlSchemaSource(schemaSource()), withCustomers]);
  const contradiction = contested.contradictions.find((item) => item.factKey === "public.customers.present");
  const absent = contradiction.alternatives.find((item) => item.value === false);
  const resolved = resolveDatabaseContradiction(contested, {
    contradictionId: contradiction.contradictionId,
    selectedValueDigest: absent.valueDigest,
    humanReviewRef: "human-review-customers-001",
    resolvedAt: "2026-07-14T12:00:00.000Z"
  });
  const input = seedInput(resolved);
  input.acceptanceCriteria = [criterion({ targets: ["public.customers"] })];
  input.factories.push({
    factoryRef: "factory.customers.v1",
    entity: "public.customers",
    origin: "synthetic",
    generators: { id: "uuid" }
  });
  assert.throws(() => planSyntheticSeedScenarios(input), {
    code: SEED_INVALID,
    message: /does not exist in the resolved schema/u
  });
});

test("a seed plan emits nominal, required and unique scenarios for each covered target", () => {
  const plan = planSyntheticSeedScenarios(seedInput(knowledge()));
  const cases = plan.scenarios.map((scenario) => `${scenario.caseKind}:${scenario.field ?? ""}`).sort();
  assert.deepEqual(cases, ["missing-required:id", "missing-required:status", "nominal:", "unique-collision:id"]);
  assert.deepEqual(plan.scenarios[0].fixtureRefs, ["fixture.orders.boundary.v1"]);
  assert.equal(new Set(plan.scenarios.map((scenario) => scenario.scenarioId)).size, 4);
});
