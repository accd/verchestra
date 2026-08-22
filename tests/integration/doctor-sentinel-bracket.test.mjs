import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCTOR_CHECK_IDS } from "../../packages/application/src/index.ts";
import { ArtifactSealer, NodeEd25519Signer } from "../../packages/evidence/src/index.ts";
import { runDoctor } from "../../apps/vestra-cli/src/doctor-composition.ts";

// DDL-05 (#207): every live observation must happen strictly between the two
// sentinel captures runDoctor takes. T6 widened collectDoctorFacts to accept
// an async probe; this proves the await introduced by that widening actually
// sits inside the bracket, rather than merely compiling.

const healthy = { present: true, healthy: true };

function healthyProbes(overrides = {}) {
  const set = {};
  for (const checkId of DOCTOR_CHECK_IDS) set[checkId] = overrides[checkId] ?? (() => healthy);
  return set;
}

function makeSealer() {
  const signer = NodeEd25519Signer.generate({ keyId: "doctor-sentinel-test", purposes: ["doctor-report"] });
  return new ArtifactSealer({ signer, now: () => new Date() });
}

test("a sentinel mutated while an async probe is in flight fails the diagnostic closed", async () => {
  let sentinelDigest = "sha256:before";
  const captureSentinels = () => [{ sentinelId: "control:package.json", digest: sentinelDigest }];

  await assert.rejects(
    runDoctor({
      probes: healthyProbes({
        "doctor.sandbox": async () => {
          // Simulates a guarded file changing during collection — the exact
          // event the sentinel bracket exists to catch.
          sentinelDigest = "sha256:after-mutation";
          return healthy;
        }
      }),
      captureSentinels,
      sealer: makeSealer(),
      now: () => Date.now()
    }),
    { code: "VES_DOCTOR_SENTINEL_MUTATION" }
  );
});

test("an unmutated sentinel across an async probe still produces a sealed report", async () => {
  const captureSentinels = () => [{ sentinelId: "control:package.json", digest: "sha256:stable" }];

  const result = await runDoctor({
    probes: healthyProbes({ "doctor.sandbox": async () => healthy }),
    captureSentinels,
    sealer: makeSealer(),
    now: () => Date.now()
  });

  assert.equal(result.verdict, "PASS");
});

test("no async work occurs before the first capture or after the second", async () => {
  const order = [];
  const captureSentinels = () => {
    order.push(order.includes("before-capture") ? "after-capture" : "before-capture");
    return [{ sentinelId: "control:package.json", digest: "sha256:stable" }];
  };

  await runDoctor({
    probes: healthyProbes({
      "doctor.sandbox": async () => {
        order.push("probe-start");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
        order.push("probe-end");
        return healthy;
      }
    }),
    captureSentinels,
    sealer: makeSealer(),
    now: () => Date.now()
  });

  assert.deepEqual(order, ["before-capture", "probe-start", "probe-end", "after-capture"]);
});
