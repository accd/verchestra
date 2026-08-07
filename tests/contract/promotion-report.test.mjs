import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));

const promoted = {
  verdict: "PROMOTED",
  candidateDigest: `sha256:${"a".repeat(64)}`,
  holdoutDigest: `sha256:${"b".repeat(64)}`,
  policyId: "release-policy",
  evaluatorKeyId: "holdout-evaluator",
  blocks: [],
  bodyDigest: `sha256:${"c".repeat(64)}`
};

const blocked = { ...promoted, verdict: "BLOCKED", blocks: ["VES_PROMOTION_CONTAMINATED"] };

test("promotion-report@1 is registered", () => {
  assert.ok(registry.list().includes("promotion-report@1"));
});

test("validates a promoted report", () => {
  assert.deepEqual(registry.validate("promotion-report", "1", promoted), promoted);
});

test("validates a blocked report with a registered block code", () => {
  assert.deepEqual(registry.validate("promotion-report", "1", blocked), blocked);
});

for (const [name, mutate] of [
  [
    "an unknown field",
    (report) => {
      report.extra = true;
    }
  ],
  [
    "a missing field",
    (report) => {
      delete report.bodyDigest;
    }
  ],
  [
    "an out-of-range verdict",
    (report) => {
      report.verdict = "MAYBE";
    }
  ],
  [
    "a non-digest candidate",
    (report) => {
      report.candidateDigest = "sha256:short";
    }
  ],
  [
    "an uppercase policy id",
    (report) => {
      report.policyId = "Release";
    }
  ],
  [
    "an unregistered block code",
    (report) => {
      report.blocks = ["VES_PROMOTION_UNKNOWN"];
    }
  ],
  [
    "a duplicated block code",
    (report) => {
      report.blocks = ["VES_PROMOTION_CONTAMINATED", "VES_PROMOTION_CONTAMINATED"];
    }
  ]
]) {
  test(`rejects ${name}`, () => {
    const copy = structuredClone(blocked);
    mutate(copy);
    assert.throws(() => registry.validate("promotion-report", "1", copy), {
      code: "VES_SCHEMA_VALIDATION_FAILED",
      schema: "promotion-report@1"
    });
  });
}
