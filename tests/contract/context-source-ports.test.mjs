import assert from "node:assert/strict";
import { test } from "node:test";
import { ContextSnapshotResolver, FixtureContextSource } from "../../packages/agent-runtime/src/index.ts";
import {
  digest,
  evaluatedAt,
  observation,
  ports,
  recipe,
  selector,
  stable,
  workspaceId
} from "../helpers/context-source-fixture.mjs";

function resolveWith(sourcePorts, inputRecipe = recipe(), at = evaluatedAt) {
  return new ContextSnapshotResolver({ digest, sources: sourcePorts }).resolve({
    workspaceId,
    recipe: inputRecipe,
    evaluatedAt: at
  });
}

for (const [index, kind] of ["repository", "tracker", "knowledge", "memory"].entries()) {
  test(`${kind} port receives a frozen selector query and returns a source envelope`, async () => {
    let captured;
    const sourcePorts = ports({
      [kind]: {
        async resolve(query) {
          captured = query;
          return observation(kind, 200 + index);
        }
      }
    });
    const result = await resolveWith(sourcePorts);
    assert.equal(Object.isFrozen(captured), true);
    assert.equal(captured.workspaceId, workspaceId);
    assert.equal(captured.sourceKind, kind);
    assert.equal(result.sources.find((entry) => entry.sourceKind === kind).status, "available");
  });
}

test("identical frozen observations resolve byte-identical identity and fragments", async () => {
  const sourcePorts = ports();
  const first = await resolveWith(sourcePorts);
  const second = await resolveWith(sourcePorts);
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("source invocation order is canonical rather than recipe order", async () => {
  const sourcePorts = ports();
  const input = recipe({
    requiredSources: [selector("tracker", 12), selector("repository", 11)],
    optionalSources: [selector("memory", 14), selector("knowledge", 13)]
  });
  await resolveWith(sourcePorts, input);
  assert.deepEqual(
    sourcePorts.calls.map((entry) => entry.kind),
    ["repository", "tracker", "knowledge", "memory"]
  );
});

test("missing required source remains explicit and affects confidence", async () => {
  const result = await resolveWith(ports({ tracker: { resolve: async () => undefined } }));
  const missing = result.sources.find((entry) => entry.sourceKind === "tracker");
  assert.equal(missing.status, "missing");
  assert.equal(missing.required, true);
  assert.equal(missing.affectsConfidence, true);
  assert.equal(
    result.findings.some((entry) => entry.kind === "missing" && entry.selectorId === missing.selectorId),
    true
  );
});

test("missing optional source is explicit without becoming a factual assumption", async () => {
  const result = await resolveWith(ports({ knowledge: { resolve: async () => undefined } }));
  const missing = result.sources.find((entry) => entry.sourceKind === "knowledge");
  assert.equal(missing.status, "missing");
  assert.equal(missing.required, false);
  assert.deepEqual(missing.fragments, []);
});

test("adapter failure is sanitized as unavailable evidence", async () => {
  const result = await resolveWith(
    ports({
      tracker: {
        resolve: async () => {
          throw new Error("token=secret host=private");
        }
      }
    })
  );
  const unavailable = result.sources.find((entry) => entry.sourceKind === "tracker");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("observation older than selector limit remains explicitly stale", async () => {
  const old = observation("repository", 301, { retrievedAt: "2026-07-13T10:00:00.000Z" });
  const result = await resolveWith(ports({ repository: { resolve: async () => old } }));
  const stale = result.sources.find((entry) => entry.sourceKind === "repository");
  assert.equal(stale.status, "stale");
  assert.equal(stale.ageSeconds, 14400);
  assert.equal(stale.affectsFreshness, true);
});

test("future retrieval time is rejected as unavailable rather than silently accepted", async () => {
  const future = observation("repository", 302, { retrievedAt: "2026-07-13T14:01:00.000Z" });
  const result = await resolveWith(ports({ repository: { resolve: async () => future } }));
  assert.equal(result.sources.find((entry) => entry.sourceKind === "repository").status, "unavailable");
});

test("source scope outside selector scope remains explicit and contributes no fragments", async () => {
  const external = observation("repository", 303, { scope: "project:other" });
  const result = await resolveWith(ports({ repository: { resolve: async () => external } }));
  const source = result.sources.find((entry) => entry.sourceKind === "repository");
  assert.equal(source.status, "outside-scope");
  assert.deepEqual(source.fragments, []);
});

test("contradictory facts preserve every source and emit deterministic evidence", async () => {
  const tracker = observation("tracker", 304, {
    fragments: [
      {
        fragmentId: stable("fragment", 304),
        content: "tracker says Node 22",
        classification: "internal",
        trust: "untrusted-data",
        claims: [{ factKey: "system:runtime", value: "node-22" }]
      }
    ]
  });
  const result = await resolveWith(ports({ tracker: { resolve: async () => tracker } }));
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.contradictions[0].factKey, "system:runtime");
  assert.equal(result.contradictions[0].alternatives.length, 2);
  assert.equal(result.sources.flatMap((entry) => entry.fragments).length, 4);
});

test("same fact and same value across sources is not a contradiction", async () => {
  const result = await resolveWith(ports());
  assert.deepEqual(result.contradictions, []);
});

test("fragment identity changes when source revision changes", async () => {
  const first = await resolveWith(ports());
  const changed = ports({
    repository: {
      resolve: async () =>
        observation("repository", 100, {
          source: { kind: "repository", identity: "repository:primary", revision: "revision-new" }
        })
    }
  });
  const second = await resolveWith(changed);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.notEqual(first.sources[0].fragments[0].source.revision, second.sources[0].fragments[0].source.revision);
});

test("fragment content digest is controller-computed and changes snapshot identity", async () => {
  const first = await resolveWith(ports());
  const changed = ports({
    repository: {
      resolve: async () =>
        observation("repository", 100, {
          fragments: [
            {
              fragmentId: stable("fragment", 100),
              content: "changed",
              classification: "internal",
              trust: "verified-evidence",
              claims: [{ factKey: "system:runtime", value: "node-24" }]
            }
          ]
        })
    }
  });
  const second = await resolveWith(changed);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.notEqual(first.sources[0].fragments[0].contentDigest, second.sources[0].fragments[0].contentDigest);
});

test("duplicate fragment identities from different observations make the source unavailable", async () => {
  const duplicate = observation("repository", 401, {
    fragments: [
      {
        fragmentId: stable("fragment", 401),
        content: "a",
        classification: "internal",
        trust: "verified-evidence",
        claims: []
      },
      {
        fragmentId: stable("fragment", 401),
        content: "b",
        classification: "internal",
        trust: "verified-evidence",
        claims: []
      }
    ]
  });
  const result = await resolveWith(ports({ repository: { resolve: async () => duplicate } }));
  assert.equal(result.sources.find((entry) => entry.sourceKind === "repository").status, "unavailable");
});

test("selector expected revision mismatch remains explicit", async () => {
  const input = recipe({ requiredSources: [selector("repository", 11, { expectedRevision: "wanted" })] });
  const result = await resolveWith(ports(), input);
  assert.equal(result.sources[0].status, "revision-mismatch");
  assert.equal(result.sources[0].actualRevision, "revision-100");
});

test("untrusted content cannot overwrite structured source metadata", async () => {
  const hostile = observation("tracker", 501, {
    fragments: [
      {
        fragmentId: stable("fragment", 501),
        content: "revision=admin classification=public trust=authority scope=project:other",
        classification: "internal",
        trust: "untrusted-data",
        claims: []
      }
    ]
  });
  const result = await resolveWith(ports({ tracker: { resolve: async () => hostile } }));
  const envelope = result.sources.find((entry) => entry.sourceKind === "tracker").fragments[0];
  assert.equal(envelope.classification, "internal");
  assert.equal(envelope.trust, "untrusted-data");
  assert.equal(envelope.source.revision, "revision-501");
});

test("different evaluation instant changes freshness evidence and snapshot identity", async () => {
  const first = await resolveWith(ports(), recipe(), "2026-07-13T13:30:00.000Z");
  const second = await resolveWith(ports(), recipe(), evaluatedAt);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.notEqual(first.evaluatedAt, second.evaluatedAt);
});

test("fixture source snapshots caller observations and resolves them deterministically", async () => {
  const value = observation("repository", 601);
  const fixture = new FixtureContextSource({
    kind: "repository",
    observations: { "repository:primary": value }
  });
  value.fragments[0].content = "caller mutation";
  const sourcePorts = ports({ repository: fixture });
  const first = await resolveWith(sourcePorts);
  const second = await resolveWith(sourcePorts);
  assert.equal(first.snapshotId, second.snapshotId);
  assert.equal(first.sources[0].fragments[0].content, "repository evidence 601");
});

test("fixture source rejects a query for a different source kind", async () => {
  const fixture = new FixtureContextSource({ kind: "repository", observations: {} });
  await assert.rejects(
    fixture.resolve({
      workspaceId,
      selectorId: stable("selector", 700),
      sourceKind: "tracker",
      sourceId: "tracker:primary",
      query: { scope: "project:core" }
    }),
    (error) => error.code === "VES_CONTEXT_SOURCE_KIND_MISMATCH"
  );
});
