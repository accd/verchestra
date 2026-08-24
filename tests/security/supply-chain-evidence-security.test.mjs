import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupplyChainEvidence,
  verifySupplyChainEvidence
} from "../../packages/distribution/src/supply-chain-evidence.ts";
import { components, releaseId } from "../helpers/hermetic-bundle-fixture.mjs";

const input = {
  schemaVersion: 1,
  releaseId,
  semanticVersion: "1.0.0",
  revision: "0123456789abcdef0123456789abcdef01234567",
  target: { platform: "win32", arch: "x64", nodeVersion: "24.14.0" },
  components: components().filter(({ kind }) => !["sbom", "provenance", "evaluation"].includes(kind)),
  evaluations: [{ profile: "gate:quick", result: "pass", assertionCount: 1, skipped: 0, todo: 0, survivingMutants: 0 }]
};

test("verifier rejects a changed evidence byte or digest", () => {
  const documents = buildSupplyChainEvidence(input);
  const tampered = documents.map((document) => ({ ...document, bytes: new Uint8Array(document.bytes) }));
  tampered[0].bytes[0] ^= 1;
  assert.throws(() => verifySupplyChainEvidence(tampered), { code: "VES_DISTRIBUTION_EVIDENCE_INVALID" });
});

test("verifier rejects duplicate or incomplete evidence kinds", () => {
  const documents = buildSupplyChainEvidence(input);
  assert.throws(() => verifySupplyChainEvidence(documents.slice(0, 3)), {
    code: "VES_DISTRIBUTION_EVIDENCE_INVALID"
  });
  assert.throws(() => verifySupplyChainEvidence([documents[0], documents[0], documents[2], documents[3]]), {
    code: "VES_DISTRIBUTION_EVIDENCE_INVALID"
  });
});

test("builder rejects invalid counters and duplicate component identity", () => {
  assert.throws(() => buildSupplyChainEvidence({ ...input, evaluations: [{ ...input.evaluations[0], skipped: -1 }] }), {
    code: "VES_DISTRIBUTION_EVIDENCE_EVALUATION_INVALID"
  });
  const duplicate = [...input.components, input.components[0]];
  assert.throws(() => buildSupplyChainEvidence({ ...input, components: duplicate }), {
    code: "VES_DISTRIBUTION_EVIDENCE_INPUT_INVALID"
  });
});
