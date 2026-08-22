import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AVAILABILITY_SUBSYSTEMS,
  parseSubsystemAvailability
} from "../../packages/domain/src/workspace-layout/subsystem-availability.ts";

// DDL-10 (#207): "available" means the record exists, parses, and declares
// an installed subsystem — never that it is reachable. No field in this
// contract can express a network endpoint or credential, so reachability is
// excluded structurally, not merely by convention.

test("parses a valid record for each declared subsystem", () => {
  for (const subsystem of AVAILABILITY_SUBSYSTEMS) {
    const record = parseSubsystemAvailability({ schemaVersion: 1, subsystem, available: true });
    assert.deepEqual(record, { schemaVersion: 1, subsystem, available: true });
  }
});

test("available may be false — presence of the record and its truth value are distinct", () => {
  const record = parseSubsystemAvailability({ schemaVersion: 1, subsystem: "driver", available: false });
  assert.equal(record.available, false);
});

test("rejects a non-object value, including an absent (undefined) record", () => {
  for (const value of [null, undefined, "driver", 1, ["driver"]]) {
    assert.throws(() => parseSubsystemAvailability(value), { code: "VES_SUBSYSTEM_AVAILABILITY_INVALID" });
  }
});

test("rejects an unknown field", () => {
  assert.throws(
    () => parseSubsystemAvailability({ schemaVersion: 1, subsystem: "driver", available: true, endpoint: "https://x" }),
    { code: "VES_SUBSYSTEM_AVAILABILITY_INVALID" }
  );
});

test("rejects an unsupported schema version", () => {
  assert.throws(() => parseSubsystemAvailability({ schemaVersion: 2, subsystem: "driver", available: true }), {
    code: "VES_SUBSYSTEM_AVAILABILITY_INVALID"
  });
});

test("rejects an undeclared subsystem name", () => {
  assert.throws(() => parseSubsystemAvailability({ schemaVersion: 1, subsystem: "database", available: true }), {
    code: "VES_SUBSYSTEM_AVAILABILITY_INVALID"
  });
});

test("rejects a non-boolean available field", () => {
  assert.throws(() => parseSubsystemAvailability({ schemaVersion: 1, subsystem: "driver", available: "yes" }), {
    code: "VES_SUBSYSTEM_AVAILABILITY_INVALID"
  });
});

test("the record is frozen", () => {
  const record = parseSubsystemAvailability({ schemaVersion: 1, subsystem: "probe", available: true });
  assert.equal(Object.isFrozen(record), true);
});
