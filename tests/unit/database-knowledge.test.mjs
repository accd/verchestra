import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDatabaseKnowledgePackage,
  importDdlSchemaSource,
  importErSchemaSource,
  importIntrospectionSchemaSource,
  importMigrationSchemaSource,
  importOrmSchemaSource,
  resolveDatabaseContradiction
} from "../../packages/data-probe/src/database-knowledge.ts";
import { databaseId, schemaSource, workspaceId } from "../helpers/database-knowledge-fixture.mjs";

const importers = [
  ["er", importErSchemaSource],
  ["ddl", importDdlSchemaSource],
  ["migration", importMigrationSchemaSource],
  ["orm", importOrmSchemaSource],
  ["introspection", importIntrospectionSchemaSource]
];
for (const [kind, importer] of importers)
  test(`imports and fingerprints ${kind} schema evidence`, () => {
    const source = importer(schemaSource(kind));
    assert.equal(source.kind, kind);
    assert.match(source.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(source.entities[0].columns), true);
  });

test("schema import sorts entities and columns deterministically", () => {
  const input = schemaSource("ddl");
  input.entities[0].columns.reverse();
  assert.deepEqual(
    importDdlSchemaSource(input).entities[0].columns.map((column) => column.name),
    ["id", "note", "status"]
  );
});
test("equivalent schema imports have identical source digests", () => {
  const left = schemaSource("ddl");
  const right = schemaSource("ddl");
  right.entities[0].columns.reverse();
  assert.equal(importDdlSchemaSource(left).sourceDigest, importDdlSchemaSource(right).sourceDigest);
});
test("knowledge package preserves every source", () => {
  const sources = importers.map(([kind, importer]) => importer(schemaSource(kind)));
  const result = buildDatabaseKnowledgePackage({ schemaVersion: 1, workspaceId, databaseId, generation: 1, sources });
  assert.deepEqual(
    result.sources.map((source) => source.kind),
    ["ddl", "er", "introspection", "migration", "orm"]
  );
});
test("knowledge package digest is independent of source order", () => {
  const sources = [importDdlSchemaSource(schemaSource()), importOrmSchemaSource(schemaSource("orm"))];
  const left = buildDatabaseKnowledgePackage({ schemaVersion: 1, workspaceId, databaseId, generation: 1, sources });
  const right = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [...sources].reverse()
  });
  assert.equal(left.packageDigest, right.packageDigest);
});
test("matching schema facts are agreed and not contradictory", () => {
  const result = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importOrmSchemaSource(schemaSource("orm"))]
  });
  assert.equal(result.contradictions.length, 0);
  assert.equal(
    result.facts.every((fact) => fact.status === "agreed"),
    true
  );
});
for (const [attribute, changed] of [
  ["data_type", { dataType: "text" }],
  ["nullable", { nullable: true }],
  ["primary_key", { primaryKey: false }],
  ["unique", { unique: false }]
])
  test(`preserves ${attribute} contradiction alternatives side by side`, () => {
    const live = schemaSource("introspection");
    Object.assign(live.entities[0].columns[0], changed);
    const result = buildDatabaseKnowledgePackage({
      schemaVersion: 1,
      workspaceId,
      databaseId,
      generation: 1,
      sources: [importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]
    });
    const contradiction = result.contradictions.find((item) => item.factKey.endsWith(attribute));
    assert.equal(contradiction.alternatives.length, 2);
    assert.equal(contradiction.status, "unresolved");
    assert.equal(contradiction.requiredResolution, true);
  });
test("one source can disagree while all original source records remain", () => {
  const orm = schemaSource("orm");
  orm.entities[0].columns[1].dataType = "enum";
  const result = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [
      importErSchemaSource(schemaSource("er")),
      importDdlSchemaSource(schemaSource()),
      importOrmSchemaSource(orm)
    ]
  });
  assert.equal(result.sources.length, 3);
  assert.equal(result.contradictions.length, 1);
  assert.deepEqual(
    result.contradictions[0].alternatives.map((alternative) => alternative.sourceIds.length).sort(),
    [1, 2]
  );
});
test("missing column remains an explicit presence contradiction", () => {
  const live = schemaSource("introspection");
  live.entities[0].columns = live.entities[0].columns.filter((column) => column.name !== "note");
  const result = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]
  });
  const contradiction = result.contradictions.find((item) => item.factKey === "public.orders.column.note.present");
  assert.deepEqual(contradiction.alternatives.map((item) => item.value).sort(), [false, true]);
  assert.equal(contradiction.status, "unresolved");
});
test("partial source omission is absence of evidence, not a contradiction", () => {
  const migration = schemaSource("migration", { coverage: "partial" });
  migration.entities[0].columns = migration.entities[0].columns.filter((column) => column.name !== "note");
  const result = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importMigrationSchemaSource(migration)]
  });
  assert.equal(
    result.contradictions.some((item) => item.factKey === "public.orders.column.note.present"),
    false
  );
});
test("entity type disagreement remains explicit", () => {
  const live = schemaSource("introspection");
  live.entities[0].type = "view";
  const result = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]
  });
  const contradiction = result.contradictions.find((item) => item.factKey === "public.orders.entity_type");
  assert.deepEqual(contradiction.alternatives.map((item) => item.value).sort(), ["table", "view"]);
});
test("human resolution selects one existing alternative and retains all evidence", () => {
  const live = schemaSource("introspection");
  live.entities[0].columns[1].dataType = "text";
  const unresolved = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]
  });
  const contradiction = unresolved.contradictions[0];
  const resolved = resolveDatabaseContradiction(unresolved, {
    contradictionId: contradiction.contradictionId,
    selectedValueDigest: contradiction.alternatives[0].valueDigest,
    humanReviewRef: "human-review-schema-001",
    resolvedAt: "2026-07-13T13:00:00.000Z"
  });
  assert.equal(resolved.contradictions[0].status, "resolved");
  assert.equal(resolved.contradictions[0].alternatives.length, 2);
  assert.equal(resolved.generation, 2);
  assert.notEqual(resolved.packageDigest, unresolved.packageDigest);
});
test("resolution rejects a value outside preserved alternatives", () => {
  const live = schemaSource("introspection");
  live.entities[0].columns[1].dataType = "text";
  const unresolved = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]
  });
  assert.throws(
    () =>
      resolveDatabaseContradiction(unresolved, {
        contradictionId: unresolved.contradictions[0].contradictionId,
        selectedValueDigest: `sha256:${"f".repeat(64)}`,
        humanReviewRef: "human-review-schema-001",
        resolvedAt: "2026-07-13T13:00:00.000Z"
      }),
    { code: "VES_DATABASE_CONTRADICTION_RESOLUTION_INVALID" }
  );
});
test("resolution is idempotent only for the same reviewed choice", () => {
  const live = schemaSource("introspection");
  live.entities[0].columns[1].dataType = "text";
  const unresolved = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource()), importIntrospectionSchemaSource(live)]
  });
  const contradiction = unresolved.contradictions[0];
  const input = {
    contradictionId: contradiction.contradictionId,
    selectedValueDigest: contradiction.alternatives[0].valueDigest,
    humanReviewRef: "human-review-schema-001",
    resolvedAt: "2026-07-13T13:00:00.000Z"
  };
  const resolved = resolveDatabaseContradiction(unresolved, input);
  assert.equal(resolveDatabaseContradiction(resolved, input), resolved);
});
test("knowledge package and nested evidence are immutable", () => {
  const result = buildDatabaseKnowledgePackage({
    schemaVersion: 1,
    workspaceId,
    databaseId,
    generation: 1,
    sources: [importDdlSchemaSource(schemaSource())]
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.sources[0].entities[0]), true);
  assert.throws(() => result.sources.push({}));
});
