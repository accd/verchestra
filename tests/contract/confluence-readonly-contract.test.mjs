import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARCHITECTURE_CONFLUENCE_CAPABILITIES,
  ArchitectureConfluenceSource,
  ConfluenceConnectorError
} from "../../packages/connectors/src/index.ts";
import {
  MockConfluenceReadTransport,
  attachment,
  page,
  pageQuery,
  searchQuery,
  sourceFixture
} from "../helpers/confluence-fixture.mjs";

test("architecture Confluence capability set is frozen and read only", () => {
  assert.deepEqual(ARCHITECTURE_CONFLUENCE_CAPABILITIES, ["search", "page-read", "attachment-read"]);
  assert.equal(Object.isFrozen(ARCHITECTURE_CONFLUENCE_CAPABILITIES), true);
});

test("architecture Confluence source exposes no mutation operation", () => {
  const methods = Object.getOwnPropertyNames(ArchitectureConfluenceSource.prototype).sort();
  assert.deepEqual(methods, ["constructor", "resolve"]);
  for (const forbidden of ["apply", "create", "delete", "mutate", "plan", "reconcile", "update", "write"]) {
    assert.equal(methods.includes(forbidden), false);
  }
});

test("search reads every bounded page into one knowledge observation", async () => {
  const { source, transport } = sourceFixture();
  const result = await source.resolve(searchQuery());
  assert.equal(result.source.kind, "knowledge");
  assert.equal(result.source.identity, "confluence:architecture");
  assert.equal(result.scope, "project:core");
  assert.equal(result.fragments.filter((entry) => entry.claims.some((claim) => claim.value === "page")).length, 3);
  assert.deepEqual(
    transport.calls.filter((call) => call.startsWith("search:")),
    ["search:start", "search:2"]
  );
});

test("explicit page mode reads canonical page identifiers without search", async () => {
  const { source, transport } = sourceFixture();
  const result = await source.resolve(pageQuery());
  assert.equal(result.fragments.filter((entry) => entry.claims.some((claim) => claim.value === "page")).length, 2);
  assert.equal(
    transport.calls.some((call) => call.startsWith("search:")),
    false
  );
  assert.deepEqual(
    transport.calls.filter((call) => call.startsWith("page:")),
    ["page:page:1", "page:page:2"]
  );
});

test("allowed textual attachments become separate source fragments", async () => {
  const { source } = sourceFixture();
  const result = await source.resolve(pageQuery());
  const fragment = result.fragments.find((entry) => entry.content === "# Architecture notes");
  assert.equal(fragment.classification, "internal");
  assert.equal(fragment.trust, "untrusted-data");
  assert.equal(
    fragment.claims.some((claim) => claim.value === "attachment"),
    true
  );
});

test("remote order does not alter observation revision or fragment order", async () => {
  const first = await sourceFixture().source.resolve(searchQuery());
  const transport = new MockConfluenceReadTransport();
  transport.pages = new Map([...transport.pages.entries()].reverse());
  const second = await sourceFixture({ transport }).source.resolve(searchQuery());
  assert.equal(first.source.revision, second.source.revision);
  assert.deepEqual(
    first.fragments.map((entry) => entry.fragmentId),
    second.fragments.map((entry) => entry.fragmentId)
  );
});

test("page revision change alters canonical source revision", async () => {
  const fixture = sourceFixture();
  const first = await fixture.source.resolve(searchQuery());
  fixture.transport.pages.set("page:2", { ...fixture.transport.pages.get("page:2"), revision: "revision:changed" });
  const second = await fixture.source.resolve(searchQuery());
  assert.notEqual(first.source.revision, second.source.revision);
});

test("page content change alters source revision even when remote revision is unchanged", async () => {
  const fixture = sourceFixture();
  const first = await fixture.source.resolve(searchQuery());
  fixture.transport.pages.set("page:2", { ...fixture.transport.pages.get("page:2"), body: "changed bytes" });
  const second = await fixture.source.resolve(searchQuery());
  assert.notEqual(first.source.revision, second.source.revision);
});

test("retrieval time is controller supplied rather than remote content", async () => {
  const result = await sourceFixture().source.resolve(searchQuery());
  assert.equal(result.retrievedAt, "2026-07-15T12:00:00.000Z");
});

test("configured classification is applied to every remote fragment", async () => {
  const result = await sourceFixture({ classification: "confidential" }).source.resolve(pageQuery());
  assert.ok(result.fragments.every((entry) => entry.classification === "confidential"));
});

test("every Confluence fragment is structurally untrusted data", async () => {
  const result = await sourceFixture().source.resolve(searchQuery());
  assert.ok(result.fragments.every((entry) => entry.trust === "untrusted-data"));
});

test("empty search resolves as a missing knowledge source", async () => {
  const transport = new MockConfluenceReadTransport();
  transport.pages.clear();
  assert.equal(await sourceFixture({ transport }).source.resolve(searchQuery()), undefined);
});

for (const [name, change] of [
  ["schema", { schemaVersion: 1 }],
  ["source kind", { sourceKind: "tracker" }],
  ["source identity", { sourceId: "confluence:other" }],
  ["workspace", { workspaceId: "workspace_018f0000-0000-7000-8000-000000000999" }]
]) {
  test(`closed source request rejects invalid ${name}`, async () => {
    await assert.rejects(sourceFixture().source.resolve(searchQuery(change)), ConfluenceConnectorError);
  });
}

for (const [name, query] of [
  ["unknown field", { ...searchQuery().query, surprise: true }],
  ["write-shaped field", { ...searchQuery().query, updatePage: { title: "forbidden" } }],
  ["duplicate term", { ...searchQuery().query, terms: ["architecture", "architecture"] }],
  ["duplicate page", { ...pageQuery().query, pageIds: ["page:1", "page:1"] }],
  ["oversized page bound", { ...searchQuery().query, maximumPages: 101 }]
]) {
  test(`closed selector rejects ${name}`, async () => {
    await assert.rejects(sourceFixture().source.resolve(searchQuery({ query })), {
      code: "VES_CONFLUENCE_QUERY_INVALID"
    });
  });
}

// Issue #58 (T4k): the observation revision digest, the page order it records,
// the attachment read order, and the published fragment order are Verchestra
// identities, not Confluence's own API contract, so a machine's ambient
// collation must not reach them. Before the canonical JSON V2 migration all
// four went through String.prototype.localeCompare. Mocking localeCompare with
// a comparator that reverses code-unit order simulates a divergent locale
// without depending on any particular installed ICU locale disagreeing today.
async function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

function codeUnitSorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

// Identifiers chosen so code-unit order and a case- or punctuation-aware
// collation genuinely disagree: by code unit "A" < "_" < "a", while a
// language-sensitive collation groups the letters and demotes punctuation.
function collationSensitiveTransport() {
  const transport = new MockConfluenceReadTransport();
  transport.pages = new Map([
    ["page:Alpha", page("Alpha")],
    ["page:_beta", page("_beta")]
  ]);
  transport.attachments = new Map([
    ["page:Alpha", [attachment("Alpha", "Zulu"), attachment("Alpha", "alpha")]],
    ["page:_beta", []]
  ]);
  transport.attachmentContents = new Map([
    ["attachment:Alpha:Zulu", { ...attachment("Alpha", "Zulu"), content: "# Architecture notes" }],
    ["attachment:Alpha:alpha", { ...attachment("Alpha", "alpha"), content: "# Alternate notes AB" }]
  ]);
  return transport;
}

const collationSensitiveQuery = () =>
  pageQuery({ query: { ...pageQuery().query, pageIds: ["page:Alpha", "page:_beta"] } });

test("knowledge observation identity is byte-identical under a hostile ambient collation", async () => {
  const baseline = await sourceFixture({ transport: collationSensitiveTransport() }).source.resolve(
    collationSensitiveQuery()
  );
  const hostile = await withHostileLocaleCompare(() =>
    sourceFixture({ transport: collationSensitiveTransport() }).source.resolve(collationSensitiveQuery())
  );
  assert.equal(hostile.source.revision, baseline.source.revision);
  assert.deepEqual(
    hostile.fragments.map((entry) => entry.fragmentId),
    baseline.fragments.map((entry) => entry.fragmentId)
  );
  assert.deepEqual(
    baseline.fragments.map((entry) => entry.fragmentId),
    codeUnitSorted(baseline.fragments.map((entry) => entry.fragmentId))
  );
});

test("attachment read order stays UTF-16 code-unit order under a hostile ambient collation", async () => {
  const transport = collationSensitiveTransport();
  await withHostileLocaleCompare(() => sourceFixture({ transport }).source.resolve(collationSensitiveQuery()));
  assert.deepEqual(
    transport.calls.filter((call) => call.startsWith("attachment:")),
    ["attachment:attachment:Alpha:Zulu", "attachment:attachment:Alpha:alpha"]
  );
});
