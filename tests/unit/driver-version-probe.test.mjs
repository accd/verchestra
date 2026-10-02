import assert from "node:assert/strict";
import { test } from "node:test";

import { probeDriverVersion } from "../../packages/drivers/src/driver-version-probe.ts";

// why: the version probe is asserted here once, at its own interface. Each
// driver's pattern, floor and codes stay pinned by its own suite and by
// tests/contract/driver-lifecycle-matrix.test.mjs.

const PROFILE = Object.freeze({
  identity: Object.freeze({ driverId: "fixture" }),
  errorCodePrefix: "VES_FIXTURE",
  noun: "Fixture CLI",
  capabilities: Object.freeze(["stream", "tools"])
});
const ANCHORED = /^(\d+)\.(\d+)\.(\d+)/u;
const NAMED = /(?:fixture-cli\s+)?(\d+)\.(\d+)\.(\d+)/u;
const UNSUPPORTED = Object.freeze({
  code: "VES_FIXTURE_VERSION_UNSUPPORTED",
  message: "Fixture CLI version is unsupported"
});
const UNAVAILABLE = Object.freeze({ code: "VES_FIXTURE_NOT_AVAILABLE", message: "Fixture CLI is unavailable" });

function minimum(output, floor = "2.1.282", pattern = ANCHORED) {
  return probeDriverVersion(PROFILE, { minimum: floor, pattern }, async () => output);
}

function exact(output, qualified = "0.87.1") {
  return probeDriverVersion(PROFILE, { exact: qualified }, async () => output);
}

function deeplyFrozen(report) {
  return (
    Object.isFrozen(report) &&
    (report.error === undefined || Object.isFrozen(report.error)) &&
    (report.capabilities === undefined || Object.isFrozen(report.capabilities))
  );
}

test("a version at the floor is available, with the driver's identity first and its capabilities", async () => {
  const report = await minimum("2.1.282 (Fixture CLI)\n");
  assert.deepEqual(report, {
    driverId: "fixture",
    available: true,
    version: "2.1.282",
    capabilities: ["stream", "tools"]
  });
  assert.deepEqual(Object.keys(report), ["driverId", "available", "version", "capabilities"]);
  assert.equal(deeplyFrozen(report), true);
});

for (const [output, floor] of [
  ["2.1.283", "2.1.282"],
  ["2.1.300", "2.1.282"],
  ["2.2.0", "2.1.282"],
  ["2.10.0", "2.9.5"],
  ["2.1.1000", "2.1.999"]
]) {
  test(`${output} meets the floor ${floor}, compared number by number`, async () => {
    const report = await minimum(output, floor);
    assert.equal(report.available, true);
    assert.equal(report.version, output);
  });
}

for (const [output, floor, why] of [
  ["2.1.281", "2.1.282", "a lower patch"],
  ["2.1.99", "2.1.282", "a patch that is only textually greater"],
  ["2.0.999", "2.1.282", "a lower minor"],
  ["1.9.999", "2.1.282", "a lower major"],
  ["3.0.0", "2.1.282", "a newer major"],
  ["2.1.282", "not-a-version", "a floor the pattern cannot read"]
]) {
  test(`${output} is unsupported against ${floor}: ${why}`, async () => {
    const report = await minimum(output, floor);
    assert.deepEqual(report, { driverId: "fixture", available: false, version: output, error: UNSUPPORTED });
    assert.deepEqual(Object.keys(report), ["driverId", "available", "version", "error"]);
    assert.equal(report.capabilities, undefined);
    assert.equal(deeplyFrozen(report), true);
  });
}

test("the reported version is the three numbers the pattern captured, not the provider's text", async () => {
  assert.equal((await minimum("  2.1.300-beta.4 (Fixture CLI)\n")).version, "2.1.300");
  assert.equal((await minimum("fixture-cli 0.116.0\n", "0.115.0", NAMED)).version, "0.116.0");
  assert.equal((await minimum("02.01.0300")).version, "2.1.300");
});

test("output the pattern cannot read is unsupported, with the version key present and undefined", async () => {
  for (const output of ["", "Fixture CLI", "v2.1.282", "2.1"]) {
    const report = await minimum(output);
    assert.equal(report.available, false);
    assert.deepEqual(report.error, UNSUPPORTED);
    assert.equal(Object.hasOwn(report, "version"), true);
    assert.equal(report.version, undefined);
  }
});

test("text longer than a version line is unsupported and is never matched, however many digits it holds", async () => {
  // invariant: 1024 characters is the bound; one more is not a version.
  const padded = `2.1.282 ${"x".repeat(1024 - "2.1.282 ".length)}`;
  assert.equal(padded.length, 1024);
  assert.equal((await minimum(padded)).version, "2.1.282");
  for (const output of [`${padded}x`, "0".repeat(200_000), `${"0".repeat(200_000)}.1.2`]) {
    const started = Date.now();
    const report = await minimum(output, "0.115.0", NAMED);
    assert.equal(report.available, false);
    assert.deepEqual(report.error, UNSUPPORTED);
    assert.equal(report.version, undefined);
    assert.ok(Date.now() - started < 1_000, "an oversized answer is refused without scanning it");
  }
  // why: surrounding whitespace is not part of the answer and does not count.
  assert.equal((await minimum(`${" ".repeat(4_000)}2.1.282\n`)).version, "2.1.282");
});

test("a pattern that starts at a digit-run boundary reads the same version as an unanchored one", async () => {
  const BOUNDED = /(?:^|\D)(\d+)\.(\d+)\.(\d+)/u;
  const UNANCHORED = /(\d+)\.(\d+)\.(\d+)/u;
  for (const [output, version] of [
    ["0.116.0", "0.116.0"],
    ["fixture-cli 0.116.0", "0.116.0"],
    ["v0.116.0", "0.116.0"],
    ["fixture 7 0.116.0-rc.1 (build 9.9.9)", "0.116.0"],
    ["x10.20.30y", "10.20.30"],
    ["no version here", undefined]
  ]) {
    const bounded = await minimum(output, "0.0.1", BOUNDED);
    assert.deepEqual(bounded, await minimum(output, "0.0.1", UNANCHORED), output);
    assert.equal(bounded.version, version, output);
  }
});

test("the driver's pattern decides what counts as a version line", async () => {
  assert.equal((await minimum("fixture-cli 2.1.282")).available, false, "an anchored pattern refuses a prefix");
  assert.equal((await minimum("fixture-cli 2.1.282", "2.1.282", NAMED)).available, true);
});

test("a provider that does not answer is unavailable, with no version key and no detail of the failure", async () => {
  const failure = new Error("spawn /private/secret/path/fixture ENOENT");
  const thrown = await probeDriverVersion(PROFILE, { minimum: "2.1.282", pattern: ANCHORED }, async () => {
    throw failure;
  });
  const absent = await probeDriverVersion(PROFILE, { exact: "0.87.1" }, async () => undefined);
  for (const report of [thrown, absent]) {
    assert.deepEqual(report, { driverId: "fixture", available: false, error: UNAVAILABLE });
    assert.deepEqual(Object.keys(report), ["driverId", "available", "error"]);
    assert.equal(JSON.stringify(report).includes("secret"), false);
    assert.equal(deeplyFrozen(report), true);
  }
});

test("an exact requirement admits only the qualified version, text for text", async () => {
  assert.deepEqual(await exact("0.87.1"), {
    driverId: "fixture",
    available: true,
    version: "0.87.1",
    capabilities: ["stream", "tools"]
  });
  for (const drifted of ["0.87.2", "0.87.0", "0.88.0", "1.0.0", "0.87.10", "0.87.1-beta.1", " 0.87.1", "v0.87.1", ""]) {
    const report = await exact(drifted);
    assert.deepEqual(report, { driverId: "fixture", available: false, version: drifted, error: UNSUPPORTED });
  }
});

test("every identity field leads the report, in the order the driver gave", async () => {
  const profile = { ...PROFILE, identity: Object.freeze({ driverId: "fixture", package: "@fixture/sdk" }) };
  const requirement = { exact: "0.87.1" };
  const available = await probeDriverVersion(profile, requirement, async () => "0.87.1");
  const drifted = await probeDriverVersion(profile, requirement, async () => "0.83.0");
  const absent = await probeDriverVersion(profile, requirement, async () => undefined);
  assert.deepEqual(Object.keys(available), ["driverId", "package", "available", "version", "capabilities"]);
  assert.deepEqual(Object.keys(drifted), ["driverId", "package", "available", "version", "error"]);
  assert.deepEqual(Object.keys(absent), ["driverId", "package", "available", "error"]);
  for (const report of [available, drifted, absent]) assert.equal(report.package, "@fixture/sdk");
});

test("the refusal codes and messages come from the driver's prefix and noun", async () => {
  const profile = { ...PROFILE, errorCodePrefix: "VES_OTHER", noun: "Other runtime" };
  const drifted = await probeDriverVersion(profile, { exact: "1.0.0" }, async () => "2.0.0");
  const absent = await probeDriverVersion(profile, { exact: "1.0.0" }, async () => undefined);
  assert.deepEqual(drifted.error, {
    code: "VES_OTHER_VERSION_UNSUPPORTED",
    message: "Other runtime version is unsupported"
  });
  assert.deepEqual(absent.error, { code: "VES_OTHER_NOT_AVAILABLE", message: "Other runtime is unavailable" });
});

test("each report carries its own copy of the capabilities", async () => {
  const first = await minimum("2.1.282");
  const second = await minimum("2.1.282");
  assert.notEqual(first.capabilities, second.capabilities);
  assert.notEqual(first.capabilities, PROFILE.capabilities);
});
