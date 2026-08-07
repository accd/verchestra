// T72 security (#13, DOC-01/DOC-04/DOC-06): the deep diagnostic is read-only,
// leaves sentinels byte-identical, seals with a purpose-bound TEST-ONLY
// identity, and never lets a secret, path, or raw error reach the report.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCTOR_CHECK_IDS } from "../../packages/application/src/index.ts";
import { ArtifactSealer, NodeEd25519Signer } from "../../packages/evidence/src/index.ts";
import { captureControlRootSentinels, runDoctor } from "../../apps/vestra-cli/src/doctor-composition.ts";

const healthy = { present: true, healthy: true };
const absent = { present: false, healthy: false };

function probes(overrides = {}) {
  const set = {};
  for (const checkId of DOCTOR_CHECK_IDS) set[checkId] = overrides[checkId] ?? (() => healthy);
  return set;
}

function sealer(purposes = ["doctor-report"]) {
  const signer = NodeEd25519Signer.generate({ keyId: "doctor-test", purposes });
  return new ArtifactSealer({ signer, now: () => new Date() });
}

function ports(overrides = {}) {
  let tick = 0;
  const stable = Object.freeze([{ sentinelId: "s", digest: `sha256:${"a".repeat(64)}` }]);
  return {
    probes: probes(),
    captureSentinels: () => stable,
    sealer: sealer(),
    now: () => (tick += 1),
    ...overrides
  };
}

const NO_PATH = /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u;

test("a read-only run over stable sentinels seals a PASS report", async () => {
  const run = await runDoctor(ports());
  assert.equal(run.verdict, "PASS");
  assert.ok(run.artifact, "a signed artifact was produced");
});

test("a sentinel that changes during the run fails closed", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      runDoctor(
        ports({
          captureSentinels: () => [{ sentinelId: "s", digest: `sha256:${(n++).toString(16).padStart(64, "0")}` }]
        })
      ),
    { code: "VES_DOCTOR_SENTINEL_MUTATION" }
  );
});

test("a probe that throws a path-laden error never leaks it into the report", async () => {
  const run = await runDoctor(
    ports({
      probes: probes({
        "doctor.sandbox": () => {
          throw new Error("failed at C:\\Users\\me\\secret.key while reading /home/user/.env");
        }
      })
    })
  );
  const sandbox = run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.sandbox"));
  assert.equal(sandbox, "doctor.sandbox:fail");
  assert.doesNotMatch(JSON.stringify(run.payload), NO_PATH);
  assert.doesNotMatch(JSON.stringify(run.artifact), NO_PATH);
});

test("an under-provisioned machine reports BLOCKED with only registered codes", async () => {
  const run = await runDoctor(ports({ probes: probes({ "doctor.git": () => absent, "doctor.clock": () => absent }) }));
  assert.equal(run.verdict, "BLOCKED");
  for (const code of run.payload["doctor.remediation_codes"]) assert.match(code, /^[a-z][a-z-]*$/u);
});

test("a present-but-unhealthy subsystem makes the verdict FAIL", async () => {
  const run = await runDoctor(ports({ probes: probes({ "doctor.clock": () => ({ present: true, healthy: false }) }) }));
  assert.equal(run.verdict, "FAIL");
  assert.deepEqual([...run.payload["doctor.failure_codes"]], ["correct-system-clock"]);
});

test("the entire sealed artifact carries no absolute machine path", async () => {
  const run = await runDoctor(ports({ probes: probes({ "doctor.native-asset": () => absent }) }));
  assert.doesNotMatch(JSON.stringify(run.artifact), NO_PATH);
});

test("sealing requires the doctor-report purpose", async () => {
  await assert.rejects(() => runDoctor(ports({ sealer: sealer(["some-other-purpose"]) })));
});

test("control-root sentinels are deterministic and read-only", () => {
  const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");
  const first = captureControlRootSentinels(root);
  const second = captureControlRootSentinels(root);
  assert.deepEqual(first, second);
  for (const fact of first) assert.match(fact.digest, /^sha256:[a-f0-9]{64}$/u);
});

test("the report duration is a non-negative integer", async () => {
  const run = await runDoctor(ports());
  assert.equal(Number.isSafeInteger(run.payload["doctor.duration_ms"]), true);
  assert.ok(run.payload["doctor.duration_ms"] >= 0);
});
