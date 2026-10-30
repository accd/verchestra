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

// X5 (.specs/features/doctor-scoped-verdict, door 1): doctor-report@2 adds the
// `not-offered` check status and the required not-offered capability list.
// `@1` stays registered unchanged, so a reader of the earlier shape keeps the
// guarantee that PASS means nothing is blocked.
const scopedPass = {
  "doctor.verdict": "PASS",
  "doctor.check_codes": [
    "doctor.cedar-policy:not-offered",
    "doctor.clock:pass",
    "doctor.connector:not-offered",
    "doctor.contract-schema:pass",
    "doctor.driver:not-offered",
    "doctor.git:pass",
    "doctor.installation:pass",
    "doctor.native-asset:pass",
    "doctor.probe:not-offered",
    "doctor.sandbox:not-offered",
    "doctor.secret-presence:pass",
    "doctor.sqlite-durable-state:not-offered"
  ],
  "doctor.failure_codes": [],
  "doctor.blocked_capabilities": [],
  "doctor.not_offered_capabilities": [
    "connectors.available",
    "drivers.available",
    "policy.enforceable",
    "probes.available",
    "sandbox.enforced",
    "state.durable"
  ],
  "doctor.remediation_codes": [],
  "doctor.duration_ms": 12
};

test("doctor-report@2 is registered and validates a scoped PASS report", () => {
  assert.ok(registry.list().includes("doctor-report@2"));
  assert.deepEqual(registry.validate("doctor-report", "2", scopedPass), scopedPass);
});

test("doctor-report@2 rejects a report without the not-offered capability list", () => {
  const copy = structuredClone(scopedPass);
  delete copy["doctor.not_offered_capabilities"];
  assert.throws(() => registry.validate("doctor-report", "2", copy), {
    code: "VES_SCHEMA_VALIDATION_FAILED",
    schema: "doctor-report@2"
  });
});

test("doctor-report@2 rejects a not-offered capability without a namespace dot", () => {
  const copy = structuredClone(scopedPass);
  copy["doctor.not_offered_capabilities"] = ["sandbox"];
  assert.throws(() => registry.validate("doctor-report", "2", copy), {
    code: "VES_SCHEMA_VALIDATION_FAILED",
    schema: "doctor-report@2"
  });
});

test("doctor-report@1 still refuses the not-offered status", () => {
  const copy = structuredClone(passing);
  copy["doctor.check_codes"] = ["doctor.sandbox:not-offered"];
  assert.throws(() => registry.validate("doctor-report", "1", copy), {
    code: "VES_SCHEMA_VALIDATION_FAILED",
    schema: "doctor-report@1"
  });
});
