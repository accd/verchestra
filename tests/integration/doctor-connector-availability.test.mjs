import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { WORKSPACE_ROOT_DIRNAME } from "../../packages/domain/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-10 (#207, AC13): doctor.connector reuses T17's availabilityProbe
// unmodified — this file confirms the wiring is correct for the connector
// subsystem specifically, not the mapping logic itself (already proven in
// tests/integration/doctor-availability-probes.test.mjs).

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function connectorCode(run) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.connector:"));
}

test("a valid, matching, available record reports pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-connector-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(connectorCode(run), "doctor.connector:pass");
});

test("connector's check reads its own fixture, not the driver subsystem's", async () => {
  // Isolates the wiring itself: deleting only the driver fixture must not
  // affect the connector check's outcome. Without this, a mutation wiring
  // doctor.connector to read driver's path instead would go undetected by
  // the other tests here, since driver's real fixture also happens to be
  // valid+matching+available for its own subsystem.
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-connector-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  await rm(join(root, WORKSPACE_ROOT_DIRNAME, "drivers", "availability.json"), { force: true });

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(connectorCode(run), "doctor.connector:pass");
});

test("an absent record reports blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-connector-"));
  roots.push(root);
  // Deliberately not provisioned: no .verchestra/connectors/availability.json.

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(connectorCode(run), "doctor.connector:blocked");
});

test("a record declaring a different subsystem reports fail (edge case 4)", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-connector-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const recordPath = join(root, WORKSPACE_ROOT_DIRNAME, "connectors", "availability.json");
  await writeFile(recordPath, JSON.stringify({ schemaVersion: 1, subsystem: "driver", available: true }));

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(connectorCode(run), "doctor.connector:fail");
});
