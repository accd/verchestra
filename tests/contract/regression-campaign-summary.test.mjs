import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));

const valid = {
  corpusDigest: `sha256:${"a".repeat(64)}`,
  campaignCount: 2,
  verdict: "PASS",
  campaigns: [
    { id: "canonical-json", requirement: "CAM-04", verdict: "PASS", samples: 1, passRate: 1, lowerConfidenceBound: 1 },
    {
      id: "gate-repair-converges",
      requirement: "CAM-03",
      verdict: "PASS",
      samples: 100,
      passRate: 0.97,
      lowerConfidenceBound: 0.915
    }
  ]
};

test("regression-campaign-summary@1 is registered", () => {
  assert.ok(registry.list().includes("regression-campaign-summary@1"));
});

test("validates a passing campaign summary", () => {
  assert.deepEqual(registry.validate("regression-campaign-summary", "1", valid), valid);
});

for (const [name, mutate] of [
  [
    "an unknown top-level field",
    (s) => {
      s.extra = true;
    }
  ],
  [
    "a missing field",
    (s) => {
      delete s.verdict;
    }
  ],
  [
    "an out-of-range verdict",
    (s) => {
      s.verdict = "MAYBE";
    }
  ],
  [
    "an empty campaign list",
    (s) => {
      s.campaigns = [];
    }
  ],
  [
    "a bad corpus digest",
    (s) => {
      s.corpusDigest = "sha256:short";
    }
  ],
  [
    "an entry id with an uppercase letter",
    (s) => {
      s.campaigns[0].id = "Canonical";
    }
  ],
  [
    "an entry requirement in lower case",
    (s) => {
      s.campaigns[0].requirement = "cam-04";
    }
  ],
  [
    "a pass rate above one",
    (s) => {
      s.campaigns[0].passRate = 1.2;
    }
  ],
  [
    "a negative lower confidence bound",
    (s) => {
      s.campaigns[0].lowerConfidenceBound = -0.1;
    }
  ],
  [
    "a non-integer sample count",
    (s) => {
      s.campaigns[0].samples = 1.5;
    }
  ],
  [
    "an unknown entry field",
    (s) => {
      s.campaigns[0].note = "x";
    }
  ]
]) {
  test(`rejects ${name}`, () => {
    const copy = structuredClone(valid);
    mutate(copy);
    assert.throws(() => registry.validate("regression-campaign-summary", "1", copy), {
      code: "VES_SCHEMA_VALIDATION_FAILED",
      schema: "regression-campaign-summary@1"
    });
  });
}
