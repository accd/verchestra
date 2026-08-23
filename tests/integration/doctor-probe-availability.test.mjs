import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { WORKSPACE_ROOT_DIRNAME } from "../../packages/domain/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-10 (#207, AC13): doctor.probe reuses T17's availabilityProbe
// unmodified — this file confirms the wiring for the probe subsystem
// specifically, not the mapping logic itself (already proven in
// tests/integration/doctor-availability-probes.test.mjs).

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function probeCode(run) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.probe:"));
}

test("a valid, matching, available record reports pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-probe-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(probeCode(run), "doctor.probe:pass");
});

test("probe's check reads its own fixture, not another subsystem's", async () => {
  // Isolates the wiring itself (T18's lesson): deleting the other two
  // subsystems' fixtures must not affect the probe check's outcome. Without
  // this, a mutation wiring doctor.probe to read driver's or connector's
  // path instead would go undetected, since those real fixtures are also
  // independently valid for their own subsystems.
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-probe-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  await rm(join(root, WORKSPACE_ROOT_DIRNAME, "drivers", "availability.json"), { force: true });
  await rm(join(root, WORKSPACE_ROOT_DIRNAME, "connectors", "availability.json"), { force: true });

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(probeCode(run), "doctor.probe:pass");
});

test("an absent record reports blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-probe-"));
  roots.push(root);
  // Deliberately not provisioned: no .verchestra/probe/fixtures/availability.json.

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(probeCode(run), "doctor.probe:blocked");
});

test("a record declaring a different subsystem reports fail (edge case 4)", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-probe-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const recordPath = join(root, WORKSPACE_ROOT_DIRNAME, "probe", "fixtures", "availability.json");
  await writeFile(recordPath, JSON.stringify({ schemaVersion: 1, subsystem: "connector", available: true }));

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(probeCode(run), "doctor.probe:fail");
});
