import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { WORKSPACE_ROOT_DIRNAME } from "../../packages/domain/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-10 (#207, AC13, edge case 4): the live driver/connector/probe checks
// observe a read-only availability record, never construct an adapter. T17
// covers doctor.driver; T18/T19 reuse the identical shared probe
// (availabilityProbe) for connector and probe, so the interesting behavior
// is proven once here and confirmed (not re-proven) for the other two.

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function checkCode(run, checkId) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith(`${checkId}:`));
}

test("a valid, matching, available record reports pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-availability-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(checkCode(run, "doctor.driver"), "doctor.driver:pass");
});

test("an absent record reports blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-availability-"));
  roots.push(root);
  // Deliberately not provisioned: no .verchestra/drivers/availability.json.

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(checkCode(run, "doctor.driver"), "doctor.driver:blocked");
});

test("a valid record with available: false reports blocked, not fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-availability-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const recordPath = join(root, WORKSPACE_ROOT_DIRNAME, "drivers", "availability.json");
  await writeFile(recordPath, JSON.stringify({ schemaVersion: 1, subsystem: "driver", available: false }));

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(checkCode(run, "doctor.driver"), "doctor.driver:blocked");
});

test("an unparseable record reports fail, not a crash", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-availability-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const recordPath = join(root, WORKSPACE_ROOT_DIRNAME, "drivers", "availability.json");
  await writeFile(recordPath, "not json");

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(checkCode(run, "doctor.driver"), "doctor.driver:fail");
});

test("a record declaring a different subsystem than the one checked reports fail (edge case 4)", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-availability-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const recordPath = join(root, WORKSPACE_ROOT_DIRNAME, "drivers", "availability.json");
  await writeFile(recordPath, JSON.stringify({ schemaVersion: 1, subsystem: "connector", available: true }));

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(checkCode(run, "doctor.driver"), "doctor.driver:fail");
});
