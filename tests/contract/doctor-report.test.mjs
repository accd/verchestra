import assert from "node:assert/strict";
import { test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));

const passing = {
  "doctor.verdict": "PASS",
  "doctor.check_codes": ["doctor.git:pass", "doctor.installation:pass"],
  "doctor.failure_codes": [],
  "doctor.blocked_capabilities": [],
  "doctor.remediation_codes": [],
  "doctor.duration_ms": 12
};

const blocked = {
  "doctor.verdict": "BLOCKED",
  "doctor.check_codes": ["doctor.git:blocked", "doctor.installation:pass"],
  "doctor.failure_codes": [],
  "doctor.blocked_capabilities": ["workspace.git"],
  "doctor.remediation_codes": ["install-git"],
  "doctor.duration_ms": 40
};

test("doctor-report@1 is a registered canonical schema", () => {
  assert.ok(registry.list().includes("doctor-report@1"));
});

test("validates a passing diagnostic report", () => {
  assert.deepEqual(registry.validate("doctor-report", "1", passing), passing);
});

test("validates a blocked diagnostic report with remediation", () => {
  assert.deepEqual(registry.validate("doctor-report", "1", blocked), blocked);
});

for (const [caseName, mutate] of [
  [
    "an unknown field",
    (r) => {
      r["doctor.extra"] = "x";
    }
  ],
  [
    "a missing field",
    (r) => {
      delete r["doctor.duration_ms"];
    }
  ],
  [
    "an out-of-range verdict",
    (r) => {
      r["doctor.verdict"] = "DEGRADED";
    }
  ],
  [
    "a check code without the doctor prefix",
    (r) => {
      r["doctor.check_codes"] = ["installation:pass"];
    }
  ],
  [
    "a check code with an invalid status",
    (r) => {
      r["doctor.check_codes"] = ["doctor.git:degraded"];
    }
  ],
  [
    "a duplicated check code",
    (r) => {
      r["doctor.check_codes"] = ["doctor.git:pass", "doctor.git:pass"];
    }
  ],
  [
    "a path-shaped remediation code",
    (r) => {
      r["doctor.remediation_codes"] = ["/home/user/.secret"];
    }
  ],
  [
    "an uppercase failure code",
    (r) => {
      r["doctor.failure_codes"] = ["REINSTALL"];
    }
  ],
  [
    "a blocked capability without a namespace dot",
    (r) => {
      r["doctor.blocked_capabilities"] = ["git"];
    }
  ],
  [
    "a non-integer duration",
    (r) => {
      r["doctor.duration_ms"] = 1.5;
    }
  ],
  [
    "a negative duration",
    (r) => {
      r["doctor.duration_ms"] = -1;
    }
  ]
]) {
  test(`rejects ${caseName}`, () => {
    const copy = structuredClone(passing);
    mutate(copy);
    assert.throws(() => registry.validate("doctor-report", "1", copy), {
      code: "VES_SCHEMA_VALIDATION_FAILED",
      schema: "doctor-report@1"
    });
  });
}
