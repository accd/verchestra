import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARCHITECTURE_CONFLUENCE_CAPABILITIES,
  ArchitectureConfluenceSource,
  ConfluenceConnectorError
} from "../../packages/connectors/src/index.ts";
import { MockConfluenceReadTransport, pageQuery, searchQuery, sourceFixture } from "../helpers/confluence-fixture.mjs";

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
