import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupplyChainEvidence,
  verifySupplyChainEvidence
} from "../../packages/distribution/src/supply-chain-evidence.ts";
import { components, releaseId } from "../helpers/hermetic-bundle-fixture.mjs";

const input = (overrides = {}) => ({
  schemaVersion: 1,
  releaseId,
  semanticVersion: "1.0.0",
  revision: "0123456789abcdef0123456789abcdef01234567",
  target: { platform: "win32", arch: "x64", nodeVersion: "24.14.0" },
  components: components().filter(({ kind }) => !["sbom", "provenance", "evaluation"].includes(kind)),
  evaluations: [
    { profile: "gate:quick", result: "pass", assertionCount: 153, skipped: 0, todo: 0, survivingMutants: 0 },
    { profile: "gate:release", result: "pass", assertionCount: 28, skipped: 0, todo: 0, survivingMutants: 0 }
  ],
  ...overrides
});

test("builds four deterministic unsigned supply-chain documents", () => {
  const documents = buildSupplyChainEvidence(input());
  assert.deepEqual(
    documents.map((document) => document.kind),
    ["license", "sbom", "provenance", "evaluation"]
  );
  assert.ok(documents.every((document) => document.sizeBytes > 0));
  assert.ok(documents.every((document) => /^sha256:[a-f0-9]{64}$/u.test(document.contentDigest)));
  assert.deepEqual(
    verifySupplyChainEvidence(documents).map((document) => document.kind),
    ["evaluation", "license", "provenance", "sbom"]
  );
});

test("component and evaluation input order does not change document bytes", () => {
  const first = buildSupplyChainEvidence(input());
  const second = buildSupplyChainEvidence(
    input({ components: [...input().components].reverse(), evaluations: [...input().evaluations].reverse() })
  );
  assert.deepEqual(
    first.map((document) => [document.kind, document.contentDigest, document.sizeBytes]),
    second.map((document) => [document.kind, document.contentDigest, document.sizeBytes])
  );
});

test("the evaluation document preserves failing and blocked evidence without upgrading it", () => {
  const [evaluation] = buildSupplyChainEvidence(
    input({
      evaluations: [
        { profile: "gate:security", result: "blocked", assertionCount: 1, skipped: 1, todo: 0, survivingMutants: 0 },
        { profile: "gate:full", result: "fail", assertionCount: 2, skipped: 0, todo: 1, survivingMutants: 1 }
      ]
    })
  ).filter((document) => document.kind === "evaluation");
  const parsed = JSON.parse(Buffer.from(evaluation.bytes).toString("utf8"));
  assert.equal(parsed.summary.failedProfiles, 2);
  assert.equal(parsed.summary.skippedCases, 1);
  assert.equal(parsed.summary.todoCases, 1);
  assert.equal(parsed.summary.survivingMutants, 1);
});
