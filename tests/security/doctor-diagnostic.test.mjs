// T72 security (#13, DOC-01/DOC-04/DOC-06): the deep diagnostic is read-only,
// leaves sentinels byte-identical, seals with a purpose-bound TEST-ONLY
// identity, and never lets a secret, path, or raw error reach the report.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCTOR_CHECK_IDS } from "../../packages/application/src/index.ts";
import { ArtifactSealer, NodeEd25519Signer } from "../../packages/evidence/src/index.ts";
import { captureControlRootSentinels, runDoctor, runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";

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

test("every awaited probe completes before the after-sentinel capture", async () => {
  const events = [];
  let captures = 0;
  const stable = Object.freeze([{ sentinelId: "s", digest: `sha256:${"a".repeat(64)}` }]);
  await runDoctor(
    ports({
      probes: probes({
        "doctor.sandbox": async () => {
          events.push("probe-start");
          await Promise.resolve();
          events.push("probe-finished");
          return healthy;
        }
      }),
      captureSentinels: () => {
        events.push(captures++ === 0 ? "before" : "after");
        return stable;
      }
    })
  );
  assert.deepEqual(events, ["before", "probe-start", "probe-finished", "after"]);
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

test("no prohibited content class reaches the sealed report: secret, DB URL, or SQLite header", async () => {
  // spec.md DOC-06 edge case: a probe whose observation would carry a secret, a
  // DB URL, a "SQLite format 3" header, or an absolute path is dropped before
  // sealing. Each class is injected through a probe-thrown error; the fact
  // catch-and-degrade plus the closed positive allowlist keep every one out of
  // the payload and the artifact. This evidences the redaction outcome that the
  // booleans-only observation design guarantees by construction — no separate
  // pseudonymizer is needed because no path or value can enter the closed report.
  const run = await runDoctor(
    ports({
      probes: probes({
        "doctor.cedar-policy": () => {
          throw new Error("postgres://svc:s3cr3tpw@db.internal:5432/prod");
        },
        "doctor.sqlite-durable-state": () => {
          throw new Error("SQLite format 3 header read at /var/lib/vestra/runtime.db");
        },
        "doctor.secret-presence": () => {
          throw new Error("token AKIA0EXAMPLEDEADBEEF ghp_exampletoken00000000000000000000");
        }
      })
    })
  );
  const serialized = `${JSON.stringify(run.payload)}\n${JSON.stringify(run.artifact)}`;
  for (const forbidden of [
    /postgres:\/\//u,
    /s3cr3tpw/u,
    /SQLite format 3/u,
    /AKIA[0-9A-Z]{16}/u,
    /ghp_[0-9A-Za-z]{20,}/u,
    NO_PATH
  ])
    assert.doesNotMatch(serialized, forbidden, `a ${String(forbidden)} class value must never reach the sealed report`);
  for (const checkId of ["doctor.cedar-policy", "doctor.sqlite-durable-state", "doctor.secret-presence"]) {
    const code = run.payload["doctor.check_codes"].find((entry) => entry.startsWith(`${checkId}:`));
    assert.equal(code, `${checkId}:fail`, `${checkId} degrades to a registered fail code, carrying no leaked text`);
  }
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

const repoRoot = () => new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");

test("DOC-04: the real control-root sentinels are byte-identical across a real run", async () => {
  // The runDoctor cases above bracket synthetic sentinels; this brackets the
  // shipped captureControlRootSentinels around a real run so DOC-04 is evidenced
  // by the real capture, not a fake. runDoctor captures before and after and
  // fails closed on any mismatch, so a passing seal already proves invariance;
  // the external before/after comparison proves the capture itself is stable.
  const root = repoRoot();
  const before = captureControlRootSentinels(root);
  assert.ok(before.length > 0, "the control root must contribute at least one sentinel");
  const run = await runDoctor(ports({ captureSentinels: () => captureControlRootSentinels(root) }));
  assert.ok(run.artifact, "the run seals with the real sentinel capture bracketing it");
  assert.deepEqual(captureControlRootSentinels(root), before, "real sentinels are byte-identical after a real run");
});

test("DOC-06: runDoctorDeep seals a fresh per-run identity and leaks no private key", async () => {
  // The real composition generates a TEST-ONLY signing identity per call
  // (NodeEd25519Signer.generate) and never persists or prints it. Two real runs
  // seal distinct artifacts, and no private-key material appears in either -
  // the sealer exports only the public key and the signature. Combined with the
  // e2e "writes nothing to the working directory" assertion, this evidences that
  // the diagnostic signing key is per-run and never reaches disk or the report.
  const root = repoRoot();
  const first = await runDoctorDeep({ controlRoot: root });
  const second = await runDoctorDeep({ controlRoot: root });
  assert.ok(first.artifact && second.artifact, "each real run seals an artifact");
  assert.notDeepEqual(first.artifact, second.artifact, "each run seals under a freshly generated identity");
  const serialized = `${JSON.stringify(first.artifact)}\n${JSON.stringify(second.artifact)}`;
  assert.doesNotMatch(
    serialized,
    /PRIVATE KEY|BEGIN [A-Z ]*PRIVATE|"privateKey"/u,
    "no private-key material is sealed"
  );
  assert.doesNotMatch(serialized, NO_PATH, "the real sealed artifact carries no absolute machine path");
});
