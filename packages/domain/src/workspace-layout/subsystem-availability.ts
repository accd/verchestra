// The availability-record contract for the driver, connector, and probe
// checks (DDL-10, #207). tests/architecture/doctor-readonly-graph.test.mjs
// forbids the doctor composition root from importing @verchestra/drivers,
// @verchestra/connectors, or @verchestra/data-probe by name — precisely the
// three packages those checks would otherwise need to construct a real
// adapter. A record read is the alternative: "available" means the record
// exists, parses, and declares an installed subsystem, never that it is
// reachable — no field here can express a network endpoint or credential,
// so there is nothing this contract could use to attempt a live connection
// even if a future caller wanted to.
//
// schemas/subsystem-availability/1.schema.json is the canonical wire schema,
// generated into packages/contracts/src/generated.ts. This module is the
// hand-written structural reader a doctor probe calls directly — domain
// takes no third-party import, so it cannot use the ajv-backed
// SchemaRegistry contracts owns.

import { DomainValueError } from "../primitives/errors.ts";

export const AVAILABILITY_SUBSYSTEMS = Object.freeze(["driver", "connector", "probe"] as const);

export type AvailabilitySubsystem = (typeof AVAILABILITY_SUBSYSTEMS)[number];

export interface SubsystemAvailabilityRecord {
  readonly schemaVersion: 1;
  readonly subsystem: AvailabilitySubsystem;
  readonly available: boolean;
}

const ALLOWED_FIELDS = Object.freeze(["schemaVersion", "subsystem", "available"]);

export function parseSubsystemAvailability(value: unknown): SubsystemAvailabilityRecord {
  if (value === null || typeof value !== "object") {
    throw new DomainValueError("VES_SUBSYSTEM_AVAILABILITY_INVALID", "Availability record must be an object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_FIELDS.includes(key))) {
    throw new DomainValueError("VES_SUBSYSTEM_AVAILABILITY_INVALID", "Availability record has unknown fields");
  }
  if (record["schemaVersion"] !== 1) {
    throw new DomainValueError(
      "VES_SUBSYSTEM_AVAILABILITY_INVALID",
      "Availability record schema version is unsupported"
    );
  }
  if (!AVAILABILITY_SUBSYSTEMS.includes(record["subsystem"] as AvailabilitySubsystem)) {
    throw new DomainValueError("VES_SUBSYSTEM_AVAILABILITY_INVALID", "Availability record names an unknown subsystem");
  }
  if (typeof record["available"] !== "boolean") {
    throw new DomainValueError(
      "VES_SUBSYSTEM_AVAILABILITY_INVALID",
      "Availability record's available field must be a boolean"
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    subsystem: record["subsystem"] as AvailabilitySubsystem,
    available: record["available"]
  });
}
