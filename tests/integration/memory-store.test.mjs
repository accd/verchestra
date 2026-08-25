import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { DEFAULT_MEMORY_MIGRATIONS, MemoryStore, inspectMemoryDatabase } from "../../packages/memory/src/index.ts";
import {
  batch,
  cleanup,
  later,
  now,
  opened,
  projectId,
  source,
  workspaceId
} from "../helpers/memory-store-fixture.mjs";

afterEach(cleanup);

test("memory store opens memory.sqlite with qualified safety settings and FTS5", async () => {
  const { store } = await opened();
  assert.deepEqual(store.safetySettings(), {
    journalMode: "wal",
    foreignKeys: 1,
    busyTimeoutMs: 10,
    writableSchema: 0,
    fts5: true
  });
  store.close();
});

test("default raw migration applies once with immutable checksums", async () => {
  const { result, store } = await opened();
  assert.equal(result.appliedMigrations, DEFAULT_MEMORY_MIGRATIONS.length);
  assert.equal(store.migrationLedger().length, DEFAULT_MEMORY_MIGRATIONS.length);
  assert.match(store.migrationLedger()[0].checksum, /^[a-f0-9]{64}$/u);
  store.close();
});

test("reopening is migration-idempotent", async () => {
  const { dbPath, store } = await opened();
  store.close();
  const reopened = new MemoryStore({ dbPath, now: () => now });
  assert.equal(reopened.open().appliedMigrations, 0);
  reopened.close();
});

test("automatic downgrade is refused", async () => {
  const { store } = await opened();
  assert.throws(() => store.downgradeTo("000"), { code: "VES_MEMORY_DOWNGRADE_UNSUPPORTED" });
  store.close();
});

test("canonical ingestion stores document and chunk provenance", async () => {
  const { store } = await opened();
  const result = store.ingest(batch());
  const [record] = store.listSources({ workspaceId, projectId });
  const chunks = store.listChunks({ workspaceId, projectId, sourceId: record.sourceId });
  assert.equal(result.changed, true);
  assert.equal(record.sourceId, "source:orders");
  assert.equal(record.revision, "rev-1");
  assert.equal(record.retrievedAt, now);
  assert.equal(record.classification, "internal");
  assert.match(record.contentDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    chunks.map(({ ordinal, contentDigest, untrusted }) => ({ ordinal, contentDigest, untrusted })),
    [
      { ordinal: 0, contentDigest: chunks[0].contentDigest, untrusted: true },
      { ordinal: 1, contentDigest: chunks[1].contentDigest, untrusted: true }
    ]
  );
  store.close();
});

test("lexical search returns active untrusted content with exact provenance", async () => {
  const { store } = await opened();
  const ingested = store.ingest(batch());
  const [hit] = store.lexicalSearch({ workspaceId, projectId, query: "refund audit", limit: 5 });
  assert.equal(hit.sourceId, "source:orders");
  assert.equal(hit.revision, "rev-1");
  assert.equal(hit.retrievedAt, now);
  assert.equal(hit.classification, "internal");
  assert.equal(hit.generationId, ingested.generationId);
  assert.equal(hit.untrusted, true);
  assert.equal(hit.content, "Refunds require an audit reason.");
  store.close();
});

test("lexical query punctuation is normalized without exposing SQL or FTS syntax", async () => {
  const { store } = await opened();
  store.ingest(batch());
  assert.equal(
    store.lexicalSearch({ workspaceId, projectId, query: 'refund OR "capture"; DROP TABLE', limit: 5 }).length,
    0
  );
  assert.equal(store.listSources({ workspaceId, projectId }).length, 1);
  store.close();
});

test("repeated ingestion converges on one active generation and no duplicate rows", async () => {
  const { store } = await opened();
  const first = store.ingest(batch());
  const digestBefore = store.stateDigest();
  const second = store.ingest(batch());
  assert.deepEqual(second, { ...first, changed: false, invalidatedSourceIds: [] });
  assert.equal(store.stateDigest(), digestBefore);
  assert.equal(store.listSources({ workspaceId, projectId }).length, 1);
  assert.equal(store.listChunks({ workspaceId, projectId, sourceId: "source:orders" }).length, 2);
  assert.equal(store.listGenerations({ workspaceId, projectId }).filter((item) => item.status === "active").length, 1);
  store.close();
});

test("source and chunk permutations produce the same canonical manifest", async () => {
  const first = source("source:a", { contents: ["alpha one", "alpha two"] });
  const second = source("source:b", { contents: ["beta one"] });
  const left = await opened();
  const right = await opened();
  const a = left.store.ingest(batch([first, second]));
  const bSource = { ...first, chunks: first.chunks.toReversed() };
  const b = right.store.ingest(batch([second, bSource]));
  assert.equal(a.manifestDigest, b.manifestDigest);
  assert.equal(a.generationId, b.generationId);
  assert.equal(left.store.stateDigest(), right.store.stateDigest());
  left.store.close();
  right.store.close();
});

test("changed source supersedes prior chunks and replaces FTS visibility", async () => {
  const { store } = await opened();
  store.ingest(batch());
  const changed = source("source:orders", {
    revision: "rev-2",
    contents: ["Settlement uses a reviewed ledger."],
    contentDigest: undefined
  });
  changed.contentDigest = `sha256:${"b".repeat(64)}`;
  const result = store.ingest(batch([changed], { manifestRef: "artifact:memory/orders-manifest-v2" }));
  assert.deepEqual(result.invalidatedSourceIds, ["source:orders"]);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "refund", limit: 5 }).length, 0);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "settlement", limit: 5 }).length, 1);
  assert.equal(store.listSources({ workspaceId, projectId })[0].revision, "rev-2");
  assert.equal(
    store.listChunks({ workspaceId, projectId, sourceId: "source:orders", includeInactive: true }).length,
    3
  );
  store.close();
});

test("a source omitted from a full canonical snapshot becomes an explicit tombstone", async () => {
  const { store } = await opened();
  store.ingest(batch([source("source:a"), source("source:b", { contents: ["obsolete glossary"] })]));
  const result = store.ingest(batch([source("source:a")], { manifestRef: "artifact:memory/next" }));
  assert.deepEqual(result.invalidatedSourceIds, ["source:b"]);
  assert.equal(store.listSources({ workspaceId, projectId }).length, 1);
  assert.equal(
    store.listSources({ workspaceId, projectId, includeInactive: true }).find((item) => item.sourceId === "source:b")
      .state,
    "deleted"
  );
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "obsolete", limit: 5 }).length, 0);
  store.close();
});

test("stale source invalidation is explicit and removes lexical visibility", async () => {
  const { store } = await opened();
  store.ingest(batch([source("source:short", { validUntil: "2026-07-15T12:30:00.000Z", contents: ["short lived"] })]));
  assert.deepEqual(store.invalidateStale({ workspaceId, projectId, evaluatedAt: later }), ["source:short"]);
  assert.equal(store.listSources({ workspaceId, projectId }).length, 0);
  assert.equal(store.listSources({ workspaceId, projectId, includeInactive: true })[0].state, "stale");
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "short", limit: 5 }).length, 0);
  store.close();
});

test("fresh and non-expiring sources remain active during stale invalidation", async () => {
  const { store } = await opened();
  store.ingest(
    batch([source("source:fresh"), source("source:permanent", { validUntil: null, contents: ["permanent evidence"] })])
  );
  assert.deepEqual(store.invalidateStale({ workspaceId, projectId, evaluatedAt: later }), []);
  assert.equal(store.listSources({ workspaceId, projectId }).length, 2);
  store.close();
});

test("a newer canonical observation revives a stale logical source", async () => {
  const { store } = await opened();
  store.ingest(batch([source("source:short", { validUntil: "2026-07-15T12:30:00.000Z", contents: ["old wording"] })]));
  store.invalidateStale({ workspaceId, projectId, evaluatedAt: later });
  const revised = source("source:short", {
    revision: "rev-2",
    retrievedAt: later,
    validUntil: null,
    contents: ["new wording"]
  });
  store.ingest(batch([revised], { manifestRef: "artifact:memory/revived" }));
  assert.equal(store.listSources({ workspaceId, projectId })[0].state, "active");
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "wording", limit: 5 })[0].content, "new wording");
  store.close();
});

test("all allowed classifications round-trip without content-granted authority", async () => {
  const { store } = await opened();
  const classifications = ["public", "internal", "confidential", "restricted"];
  store.ingest(
    batch(
      classifications.map((classification) =>
        source(`source:${classification}`, { classification, contents: [`${classification} datum`] })
      )
    )
  );
  assert.deepEqual(
    store.listSources({ workspaceId, projectId }).map((item) => item.classification),
    classifications.sort()
  );
  assert.equal(
    store.lexicalSearch({ workspaceId, projectId, query: "datum", limit: 10 }).every((hit) => hit.untrusted),
    true
  );
  store.close();
});

test("ingestion manifests contain canonical identities and no raw document content", async () => {
  const { store } = await opened();
  store.ingest(batch());
  const manifests = store.listIngestionManifests({ workspaceId, projectId });
  const serialized = JSON.stringify(manifests);
  assert.equal(manifests.length, 1);
  assert.match(manifests[0].manifestDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(serialized.includes("Orders are approved"), false);
  assert.equal(serialized.includes("Refunds require"), false);
  assert.equal(manifests[0].sourceDigests.length, 1);
  store.close();
});

test("canonical state digest is independent of database insertion order", async () => {
  const a = source("source:a", { contents: ["alpha"] });
  const b = source("source:b", { contents: ["beta"] });
  const first = await opened();
  const second = await opened();
  first.store.ingest(batch([a, b]));
  second.store.ingest(batch([b, a]));
  assert.equal(first.store.stateDigest(), second.store.stateDigest());
  first.store.close();
  second.store.close();
});

test("a clean machine rebuilds lexical authority from canonical batches", async () => {
  const original = await opened();
  const rebuilt = await opened();
  const input = batch([source("source:a", { contents: ["portable lexical evidence"] }), source("source:b")]);
  original.store.ingest(input);
  rebuilt.store.rebuild([input]);
  assert.equal(rebuilt.store.stateDigest(), original.store.stateDigest());
  assert.equal(rebuilt.store.lexicalSearch({ workspaceId, projectId, query: "portable", limit: 5 }).length, 1);
  original.store.close();
  rebuilt.store.close();
});

test("rebuild replaces noncanonical local state rather than merging it", async () => {
  const { store } = await opened();
  store.ingest(batch([source("source:local", { contents: ["machine only"] })]));
  store.rebuild([
    batch([source("source:canonical", { contents: ["team source"] })], { manifestRef: "artifact:memory/team" })
  ]);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "machine", limit: 5 }).length, 0);
  assert.equal(store.lexicalSearch({ workspaceId, projectId, query: "team", limit: 5 }).length, 1);
  store.close();
});

test("workspace scope prevents visibility of another workspace", async () => {
  const { store } = await opened();
  const other = "workspace_018f0b6d-7b1a-7abc-8def-8123456789ab";
  store.ingest(batch([source("source:a", { contents: ["alpha private"] })]));
  store.ingest(batch([source("source:b", { contents: ["beta private"] })], { workspaceId: other }));
  assert.deepEqual(
    store.lexicalSearch({ workspaceId, projectId, query: "private", limit: 10 }).map((hit) => hit.sourceId),
    ["source:a"]
  );
  assert.deepEqual(
    store.lexicalSearch({ workspaceId: other, projectId, query: "private", limit: 10 }).map((hit) => hit.sourceId),
    ["source:b"]
  );
  store.close();
});

test("project scope prevents visibility of another project", async () => {
  const { store } = await opened();
  store.ingest(batch([source("source:a", { contents: ["project alpha"] })]));
  store.ingest(batch([source("source:b", { contents: ["project beta"] })], { projectId: "project_billing" }));
  assert.deepEqual(
    store.lexicalSearch({ workspaceId, projectId, query: "project", limit: 10 }).map((hit) => hit.sourceId),
    ["source:a"]
  );
  store.close();
});

test("multiple active generations remain isolated per Workspace and Project", async () => {
  const { store } = await opened();
  store.ingest(batch());
  store.ingest(batch([source("source:b")], { projectId: "project_billing" }));
  assert.equal(store.listGenerations({ workspaceId, projectId }).filter((item) => item.status === "active").length, 1);
  assert.equal(
    store.listGenerations({ workspaceId, projectId: "project_billing" }).filter((item) => item.status === "active")
      .length,
    1
  );
  store.close();
});

test("online backup binds integrity, byte digest, canonical state and document count", async () => {
  const { root, store } = await opened();
  store.ingest(batch());
  const backup = await store.backupTo(join(root, "backup.sqlite"));
  assert.match(backup.manifest.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(backup.manifest.stateDigest, store.stateDigest());
  assert.equal(backup.manifest.documentCount, 1);
  assert.equal(backup.manifest.migrations.length, DEFAULT_MEMORY_MIGRATIONS.length);
  assert.equal(inspectMemoryDatabase(backup.path).integrity, "ok");
  await access(backup.path);
  store.close();
});

test("online backup includes committed WAL source and FTS rows", async () => {
  const { root, store } = await opened();
  store.ingest(batch());
  const backup = await store.backupTo(join(root, "wal.sqlite"));
  assert.deepEqual(inspectMemoryDatabase(backup.path), {
    integrity: "ok",
    sources: 1,
    chunks: 2,
    ftsRows: 2,
    migrations: DEFAULT_MEMORY_MIGRATIONS.length
  });
  store.close();
});

test("read-only inspection verifies extension loading remains unavailable", async () => {
  const { dbPath, store } = await opened();
  assert.equal(inspectMemoryDatabase(dbPath, { assertExtensionsDisabled: true }).integrity, "ok");
  store.close();
});

test("generation and lexical ordering are stable across reopen", async () => {
  const { dbPath, store } = await opened();
  store.ingest(
    batch([source("source:b", { contents: ["shared token"] }), source("source:a", { contents: ["shared token"] })])
  );
  const before = store.lexicalSearch({ workspaceId, projectId, query: "shared", limit: 10 });
  const digestBefore = store.stateDigest();
  store.close();
  const reopened = new MemoryStore({ dbPath, now: () => later });
  reopened.open();
  assert.deepEqual(reopened.lexicalSearch({ workspaceId, projectId, query: "shared", limit: 10 }), before);
  assert.equal(reopened.stateDigest(), digestBefore);
  reopened.close();
});

// #58 (memory vertical): memory-store.ts ordered canonical-JSON object members
// and the ingestion manifest's source list with String.prototype.localeCompare,
// which is locale-dependent and diverges from UTF-16 code-unit order for the
// mixed-case ASCII identifiers IDENTIFIER_PATTERN accepts. Replacing
// localeCompare with a comparator that reverses code-unit order simulates a
// divergent collation without depending on any particular installed ICU locale
// disagreeing on the host running the test.
async function withHostileLocaleCompare(run) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await run();
  } finally {
    String.prototype.localeCompare = original;
  }
}

const mixedCaseBatch = () =>
  batch([source("Source-b", { contents: ["beta content"] }), source("source-a", { contents: ["alpha content"] })]);

test("ingestion identity and persisted manifest order are stable across divergent locale collations", async () => {
  const plain = await opened();
  const hostile = await opened();
  const first = plain.store.ingest(mixedCaseBatch());
  const second = await withHostileLocaleCompare(() => hostile.store.ingest(mixedCaseBatch()));
  assert.equal(first.generationId, second.generationId);
  assert.equal(first.manifestDigest, second.manifestDigest);

  const manifests = plain.store.listIngestionManifests({ workspaceId, projectId });
  assert.deepEqual(manifests, hostile.store.listIngestionManifests({ workspaceId, projectId }));
  // Code-unit order specifically, not merely "some" deterministic order:
  // uppercase sorts before lowercase in UTF-16, so "Source-b" leads the
  // persisted manifest even though every ambient collation the repository has
  // met orders "source-a" first. The digests identify which source is which.
  assert.deepEqual(manifests[0].sourceDigests, [
    plain.store.listSources({ workspaceId, projectId }).find((entry) => entry.sourceId === "Source-b").contentDigest,
    plain.store.listSources({ workspaceId, projectId }).find((entry) => entry.sourceId === "source-a").contentDigest
  ]);

  // The state digest canonicalizes raw column names, so it too must not move
  // with the ambient collation.
  assert.equal(plain.store.stateDigest(), await withHostileLocaleCompare(() => plain.store.stateDigest()));
  assert.equal(plain.store.stateDigest(), hostile.store.stateDigest());
  plain.store.close();
  hostile.store.close();
});

test("re-ingesting a mixed-case batch under a hostile locale stays idempotent", async () => {
  const { store } = await opened();
  const first = store.ingest(mixedCaseBatch());
  const replay = await withHostileLocaleCompare(() => store.ingest(mixedCaseBatch()));
  assert.equal(replay.changed, false);
  assert.equal(replay.generationId, first.generationId);
  store.close();
});
