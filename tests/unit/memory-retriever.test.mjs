import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ExplainableMemoryRetriever,
  MemoryRetrievalError,
  PolicyFilteredMemoryRetrievalService
} from "../../packages/memory/src/index.ts";
import {
  digest,
  evaluatedAt,
  lexicalCandidate,
  permutations,
  projectId,
  record,
  retrievalInput,
  vectorCandidate,
  workspaceId
} from "../helpers/memory-retrieval-fixture.mjs";

const retriever = new ExplainableMemoryRetriever();

test("lexical-only retrieval returns stable ranked untrusted results", () => {
  const input = retrievalInput({ vector: { status: "unavailable", candidates: [] } });
  const result = retriever.search(input);
  assert.equal(result.mode, "lexical");
  assert.deepEqual(
    result.results.map((entry) => entry.sourceId),
    ["source-1", "source-2", "source-3"]
  );
  assert.ok(result.results.every((entry) => entry.trust === "untrusted-data"));
  assert.deepEqual(result.degradations, [{ code: "semantic-unavailable", affectsConfidence: true }]);
});

test("hybrid reciprocal-rank fusion rewards a candidate present in both modalities", () => {
  const records = [record(1), record(2), record(3)];
  const result = retriever.search(
    retrievalInput({
      records,
      lexical: {
        generationId: digest("lexical-generation"),
        candidates: [lexicalCandidate(records[0], 1), lexicalCandidate(records[1], 2)]
      },
      vector: {
        status: "ready",
        generationId: digest("vector-generation"),
        candidates: [vectorCandidate(records[2], 1), vectorCandidate(records[1], 2)]
      }
    })
  );
  assert.equal(result.mode, "hybrid");
  assert.equal(result.results[0].sourceId, "source-2");
  assert.deepEqual(result.results[0].explanation.modalityRanks, { lexical: 2, vector: 2 });
  assert.deepEqual(result.results[0].explanation.providerSignals, { lexicalScore: -2, vectorDistance: 0.2 });
});

test("vector-only candidate is eligible in hybrid mode", () => {
  const records = [record(1), record(2)];
  const result = retriever.search(
    retrievalInput({
      records,
      lexical: { generationId: digest("lexical-generation"), candidates: [lexicalCandidate(records[0], 1)] },
      vector: {
        status: "ready",
        generationId: digest("vector-generation"),
        candidates: [vectorCandidate(records[1], 1)]
      }
    })
  );
  assert.deepEqual(new Set(result.results.map((entry) => entry.sourceId)), new Set(["source-1", "source-2"]));
});

for (const status of ["unavailable", "stale", "corrupt"]) {
  test(`preferred semantic mode records ${status} and continues lexically`, () => {
    const result = retriever.search(retrievalInput({ vector: { status, candidates: [] } }));
    assert.equal(result.mode, "lexical");
    assert.equal(result.degradations[0].code, `semantic-${status}`);
  });
}

test("disabled semantic policy ignores an otherwise ready vector generation", () => {
  const base = retrievalInput();
  const result = retriever.search(retrievalInput({ policy: { ...base.policy, semanticMode: "disabled" } }));
  assert.equal(result.mode, "lexical");
  assert.equal(result.explanation.vectorGenerationId, null);
  assert.deepEqual(result.degradations, []);
});

test("required semantic policy rejects unavailable semantic retrieval", () => {
  const base = retrievalInput();
  assert.throws(
    () =>
      retriever.search(
        retrievalInput({
          policy: { ...base.policy, semanticMode: "required" },
          vector: { status: "unavailable", candidates: [] }
        })
      ),
    (error) => error instanceof MemoryRetrievalError && error.code === "VES_MEMORY_SEMANTIC_REQUIRED"
  );
});

test("canonical identity breaks exact score ties independently from input order", () => {
  const records = [record(2), record(1)];
  const input = retrievalInput({
    records,
    lexical: {
      generationId: digest("lexical-generation"),
      candidates: [lexicalCandidate(records[0], 1), lexicalCandidate(records[1], 1, { rank: 2 })]
    },
    vector: {
      status: "ready",
      generationId: digest("vector-generation"),
      candidates: [vectorCandidate(records[1], 1), vectorCandidate(records[0], 2)]
    }
  });
  assert.deepEqual(
    retriever.search(input).results.map((entry) => entry.sourceId),
    ["source-1", "source-2"]
  );
});

test("freshness adjustment lowers confidence and final score", () => {
  const fresh = record(1, { retrievedAt: "2026-07-15T11:59:00.000Z" });
  const older = record(2, { retrievedAt: "2026-07-14T12:01:00.000Z" });
  const result = retriever.search(
    retrievalInput({
      records: [older, fresh],
      lexical: {
        generationId: digest("lexical-generation"),
        candidates: [lexicalCandidate(older, 1), lexicalCandidate(fresh, 2)]
      },
      vector: { status: "unavailable", candidates: [] }
    })
  );
  assert.equal(result.results[0].sourceId, "source-1");
  assert.ok(result.results[0].confidence > result.results[1].confidence);
});

test("expired records are absent from results", () => {
  const expired = record(1, { validUntil: "2026-07-15T11:59:59.999Z" });
  const result = retriever.search(
    retrievalInput({
      records: [expired],
      lexical: { generationId: digest("lexical-generation"), candidates: [lexicalCandidate(expired, 1)] },
      vector: { status: "unavailable", candidates: [] }
    })
  );
  assert.deepEqual(result.results, []);
});

test("records beyond maximum policy age are absent from results", () => {
  const old = record(1, { retrievedAt: "2026-07-14T11:59:59.999Z", validUntil: null });
  const result = retriever.search(
    retrievalInput({
      records: [old],
      lexical: { generationId: digest("lexical-generation"), candidates: [lexicalCandidate(old, 1)] },
      vector: { status: "unavailable", candidates: [] }
    })
  );
  assert.deepEqual(result.results, []);
});

for (const [maximumClassification, visible] of [
  ["public", ["public"]],
  ["internal", ["public", "internal"]],
  ["confidential", ["public", "internal", "confidential"]],
  ["restricted", ["public", "internal", "confidential", "restricted"]]
]) {
  test(`classification ceiling ${maximumClassification} is monotonic`, () => {
    const records = ["public", "internal", "confidential", "restricted"].map((classification, index) =>
      record(index + 1, { classification })
    );
    const base = retrievalInput();
    const result = retriever.search(
      retrievalInput({
        policy: { ...base.policy, maximumClassification },
        records,
        lexical: {
          generationId: digest("lexical-generation"),
          candidates: records.map((value, index) => lexicalCandidate(value, index + 1))
        },
        vector: { status: "unavailable", candidates: [] }
      })
    );
    assert.deepEqual(
      result.results.map((entry) => entry.classification),
      visible
    );
  });
}

test("result-limit omissions preserve the complete VES-CTX-005 explanation surface", () => {
  const result = retriever.search(retrievalInput({ limit: 1, vector: { status: "unavailable", candidates: [] } }));
  assert.equal(result.omissions.length, 2);
  assert.deepEqual(Object.keys(result.omissions[0]).sort(), [
    "affectsConfidence",
    "affectsFreshness",
    "estimatedSizeBytes",
    "fragmentId",
    "priority",
    "reason"
  ]);
  assert.equal(result.omissions[0].reason, "result-limit");
});

test("no omission is emitted when every eligible result fits", () => {
  assert.deepEqual(retriever.search(retrievalInput()).omissions, []);
});

test("provenance contains exact source and generation bindings", () => {
  const result = retriever.search(retrievalInput());
  assert.deepEqual(result.results[0].provenance, {
    sourceKind: "repository",
    sourceId: "source-1",
    revision: "revision-1",
    manifestRef: "manifest:1",
    retrievedAt: "2026-07-15T11:00:00.000Z",
    validUntil: "2026-07-16T12:00:00.000Z",
    contentDigest: digest("memory content 1"),
    lexicalGenerationId: digest("lexical-generation"),
    vectorGenerationId: digest("vector-generation")
  });
});

test("identical canonical input returns byte-identical retrieval output", () => {
  assert.deepEqual(retriever.search(retrievalInput()), retriever.search(structuredClone(retrievalInput())));
});

test("query changes query and search identities", () => {
  const first = retriever.search(retrievalInput());
  const second = retriever.search(retrievalInput({ query: "different query" }));
  assert.notEqual(first.queryDigest, second.queryDigest);
  assert.notEqual(first.searchId, second.searchId);
});

test("semantic query digest changes the hybrid retrieval identity", () => {
  const first = retriever.search(retrievalInput());
  const second = retriever.search(retrievalInput({ semanticQueryDigest: digest("other-semantic-query") }));
  assert.notEqual(first.searchId, second.searchId);
  assert.equal(second.explanation.semanticQueryDigest, digest("other-semantic-query"));
});

test("hybrid retrieval requires a bound semantic query digest", () => {
  const input = retrievalInput();
  delete input.semanticQueryDigest;
  assert.throws(() => retriever.search(input), { code: "VES_MEMORY_RETRIEVAL_INVALID" });
});

for (const field of ["policy", "lexical", "vector"]) {
  test(`${field} generation/evidence changes the retrieval identity`, () => {
    const base = retrievalInput();
    const mutation =
      field === "policy"
        ? { policy: { ...base.policy, evidenceDigest: digest("other-policy") } }
        : field === "lexical"
          ? { lexical: { ...base.lexical, generationId: digest("other-lexical") } }
          : { vector: { ...base.vector, generationId: digest("other-vector") } };
    assert.notEqual(retriever.search(base).searchId, retriever.search(retrievalInput(mutation)).searchId);
  });
}

test("retrieval does not mutate caller arrays and returns a deeply frozen result", () => {
  const input = retrievalInput();
  const before = structuredClone(input);
  const result = retriever.search(input);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.results), true);
  assert.equal(Object.isFrozen(result.results[0].provenance), true);
});

for (const [name, mutation] of [
  ["limit", { limit: 0 }],
  ["schema", { schemaVersion: 2 }],
  ["query", { query: "" }],
  ["lexical generation", { lexical: { generationId: "bad", candidates: [] } }]
]) {
  test(`invalid ${name} fails closed`, () => {
    assert.throws(() => retriever.search(retrievalInput(mutation)), { code: "VES_MEMORY_RETRIEVAL_INVALID" });
  });
}

test("duplicate authoritative records fail closed", () => {
  const value = record(1);
  assert.throws(() => retriever.search(retrievalInput({ records: [value, { ...value }] })), {
    code: "VES_MEMORY_RETRIEVAL_INVALID"
  });
});

test("duplicate modality ranks fail closed", () => {
  const records = [record(1), record(2)];
  assert.throws(
    () =>
      retriever.search(
        retrievalInput({
          records,
          lexical: {
            generationId: digest("lexical-generation"),
            candidates: [lexicalCandidate(records[0], 1), lexicalCandidate(records[1], 1)]
          }
        })
      ),
    { code: "VES_MEMORY_RETRIEVAL_INVALID" }
  );
});

for (const [index, order] of permutations([record(1), record(2), record(3)]).entries()) {
  test(`property: record insertion order preserves result and explanation ${index + 1}`, () => {
    const canonical = retrievalInput();
    assert.deepEqual(retriever.search({ ...canonical, records: order }), retriever.search(canonical));
  });
}

for (const [index, order] of permutations([0, 1, 2]).entries()) {
  test(`property: candidate insertion order preserves result and explanation ${index + 1}`, () => {
    const canonical = retrievalInput();
    const permuted = {
      ...canonical,
      lexical: {
        ...canonical.lexical,
        candidates: order.map((candidate) => canonical.lexical.candidates[candidate])
      },
      vector: {
        ...canonical.vector,
        candidates: order.map((candidate) => canonical.vector.candidates[candidate])
      }
    };
    assert.deepEqual(retriever.search(permuted), retriever.search(canonical));
  });
}

function coordinatedFixture(options = {}) {
  const calls = [];
  const value = record(1);
  const policy = { ...retrievalInput().policy, semanticMode: options.semanticMode ?? "preferred" };
  const service = new PolicyFilteredMemoryRetrievalService({
    policy: {
      authorize: async (request) => {
        calls.push({ kind: "policy", request });
        if (options.policyFailure) throw new Error("policy secret");
        return options.policy ?? policy;
      }
    },
    lexical: {
      retrieve: async (request) => {
        calls.push({ kind: "lexical", request });
        if (options.lexicalFailure) throw new Error("database secret");
        return {
          generationId: digest("lexical-generation"),
          records: [value],
          candidates: [lexicalCandidate(value, 1)]
        };
      }
    },
    vector: {
      retrieve: async (request) => {
        calls.push({ kind: "vector", request });
        if (options.vectorFailure) throw new Error("vector secret");
        return {
          status: "ready",
          generationId: digest("vector-generation"),
          records: [value],
          candidates: [vectorCandidate(value, 1)]
        };
      }
    }
  });
  return {
    calls,
    service,
    request: {
      schemaVersion: 1,
      workspaceId,
      projectId,
      query: "refund workflow",
      purpose: "discovery",
      evaluatedAt,
      limit: 5,
      embedding: [1, 0, 0]
    }
  };
}

test("coordinator enforces policy then lexical then vector operational order", async () => {
  const fixture = coordinatedFixture();
  const result = await fixture.service.search(fixture.request);
  assert.deepEqual(
    fixture.calls.map((entry) => entry.kind),
    ["policy", "lexical", "vector"]
  );
  assert.equal(result.mode, "hybrid");
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0].explanation.modalityRanks, { lexical: 1, vector: 1 });
});

test("coordinator sends exact policy filters to both candidate sources", async () => {
  const fixture = coordinatedFixture();
  await fixture.service.search(fixture.request);
  for (const call of fixture.calls.filter((entry) => entry.kind !== "policy")) {
    assert.equal(call.request.maximumClassification, "internal");
    assert.equal(call.request.maximumAgeSeconds, 86_400);
    assert.equal(call.request.workspaceId, workspaceId);
    assert.equal(call.request.projectId, projectId);
    assert.equal(call.request.purpose, "discovery");
    assert.equal(Object.isFrozen(call.request), true);
  }
});

test("policy receives digests and intent metadata but no query or embedding values", async () => {
  const fixture = coordinatedFixture();
  await fixture.service.search(fixture.request);
  const request = fixture.calls[0].request;
  assert.equal(request.queryDigest, digest("refund workflow"));
  assert.match(request.embeddingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal("query" in request, false);
  assert.equal("embedding" in request, false);
  assert.equal(Object.isFrozen(request), true);
});

test("disabled semantic policy never invokes the vector source", async () => {
  const fixture = coordinatedFixture({ semanticMode: "disabled" });
  const result = await fixture.service.search(fixture.request);
  assert.deepEqual(
    fixture.calls.map((entry) => entry.kind),
    ["policy", "lexical"]
  );
  assert.equal(result.mode, "lexical");
});

test("missing query embedding skips the vector source and records lexical degradation", async () => {
  const fixture = coordinatedFixture();
  const request = structuredClone(fixture.request);
  delete request.embedding;
  const result = await fixture.service.search(request);
  assert.deepEqual(
    fixture.calls.map((entry) => entry.kind),
    ["policy", "lexical"]
  );
  assert.equal(result.mode, "lexical");
  assert.equal(result.degradations[0].code, "semantic-unavailable");
});

test("preferred vector source failure degrades explicitly to lexical retrieval", async () => {
  const fixture = coordinatedFixture({ vectorFailure: true });
  const result = await fixture.service.search(fixture.request);
  assert.equal(result.mode, "lexical");
  assert.equal(result.degradations[0].code, "semantic-unavailable");
});

test("required vector source failure blocks after policy and lexical evidence", async () => {
  const fixture = coordinatedFixture({ semanticMode: "required", vectorFailure: true });
  await assert.rejects(fixture.service.search(fixture.request), { code: "VES_MEMORY_SEMANTIC_REQUIRED" });
  assert.deepEqual(
    fixture.calls.map((entry) => entry.kind),
    ["policy", "lexical", "vector"]
  );
});

test("coordinator Float32-normalizes and freezes the embedding before adapters", async () => {
  const fixture = coordinatedFixture();
  await fixture.service.search({ ...fixture.request, embedding: [1 / 3, 0, -0] });
  const candidateRequest = fixture.calls.find((entry) => entry.kind === "lexical").request;
  assert.equal(candidateRequest.embedding[0], Math.fround(1 / 3));
  assert.equal(Object.isFrozen(candidateRequest.embedding), true);
});
