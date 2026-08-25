import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { qualifyPlatformIsolation, selectIsolationProfile } from "../../spikes/isolation/src/isolation-policy.mjs";

// T75 sandbox matrix, isolation-grade axis.
//
// The sandbox boundary components — protected paths, process-tree termination,
// egress, capability grants, probe-worker bounds, disposable roots, bounded
// driver queues — each already carry escape cases that prove they fail closed,
// and this file does not restate them.
//
// What had no executable matrix is the isolation GRADE axis, and it is the one
// place the sandbox declaration is easiest to over-read. Two things are true of
// it and neither was proven by a test:
//
//   1. The per-platform native control sets are a three-platform contract
//      evaluated by a pure function, but nothing ever evaluated more than the
//      platform the runner happened to be. On a Linux leg the win32 and darwin
//      control sets were inert data.
//   2. `container-isolated` is declared as a matrix case and is implemented
//      nowhere. The declaration records it as not-qualified, which is honest —
//      but "honest" was a sentence, not a check, and a future change could
//      start advertising a grade the policy never learned to qualify.
//
// So this file runs the grade axis for every declared platform from any runner,
// and it pins the two grades that must never be advertisable. It is a security
// test because the failure mode is a workload placed in a sandbox weaker than
// the one it was promised.

const POLICY_SOURCE = readFileSync(new URL("../../spikes/isolation/src/isolation-policy.mjs", import.meta.url), "utf8");

// The per-platform control sets, read from the policy rather than restated, so
// a control added to a platform enters this matrix instead of going unproven.
const NATIVE_CONTROLS = (() => {
  const body = /const NATIVE_CONTROLS = Object\.freeze\(\{([\s\S]*?)\}\);/u.exec(POLICY_SOURCE)?.[1];
  assert.ok(body, "the native control sets must be readable from isolation-policy.mjs");
  const platforms = {};
  for (const match of body.matchAll(/(\w+): \[([^\]]+)\]/gu))
    platforms[match[1]] = [...match[2].matchAll(/"([a-z0-9-]+)"/gu)].map((entry) => entry[1]);
  return Object.freeze(platforms);
})();

// The grades the policy can actually name. `process-contained` is the floor
// every platform gets; `native-restricted` is the only upgrade it can award.
const ADVERTISABLE_GRADES = ["process-contained", "native-restricted"];
const DECLARED_BUT_UNIMPLEMENTED_GRADES = ["container-isolated"];

const VALID_DIGEST = "a".repeat(64);
const evidence = (platform, overrides = {}) => ({
  digest: VALID_DIGEST,
  controls: [...NATIVE_CONTROLS[platform]],
  ...overrides
});

test("the matrix covers every platform the isolation contract declares", () => {
  assert.deepEqual(Object.keys(NATIVE_CONTROLS).sort(), ["darwin", "linux", "win32"]);
  for (const [platform, controls] of Object.entries(NATIVE_CONTROLS))
    assert.equal(controls.length, 4, `${platform} must declare its full native control set`);
});

for (const platform of Object.keys(NATIVE_CONTROLS)) {
  test(`${platform} without native evidence is qualified at process-contained only`, () => {
    // The default every platform gets, evaluated for all three from one runner.
    const result = qualifyPlatformIsolation({ platform, nativeEvidence: null });
    assert.deepEqual(result.available, ["process-contained"]);
    assert.equal(result.nativeEvidenceDigest, null, "an unqualified platform must claim no evidence digest");
  });

  test(`${platform} advertises native-restricted only with a digest and every required control`, () => {
    const result = qualifyPlatformIsolation({ platform, nativeEvidence: evidence(platform) });
    assert.deepEqual(result.available, ["process-contained", "native-restricted"]);
    assert.equal(result.nativeEvidenceDigest, VALID_DIGEST);
  });

  for (const missing of NATIVE_CONTROLS[platform]) {
    test(`${platform} refuses native-restricted when ${missing} is absent`, () => {
      // Refused, not downgraded. A platform that quietly fell back to
      // process-contained would let a caller that asked for native isolation
      // receive a weaker sandbox and never learn of it.
      const controls = NATIVE_CONTROLS[platform].filter((control) => control !== missing);
      assert.throws(() => qualifyPlatformIsolation({ platform, nativeEvidence: evidence(platform, { controls }) }), {
        code: "VES_NATIVE_ISOLATION_UNQUALIFIED"
      });
    });
  }

  test(`${platform} refuses native-restricted without a well-formed evidence digest`, () => {
    for (const digest of ["", "not-a-digest", VALID_DIGEST.slice(1), `${VALID_DIGEST}0`, "A".repeat(64)])
      assert.throws(() => qualifyPlatformIsolation({ platform, nativeEvidence: evidence(platform, { digest }) }), {
        code: "VES_NATIVE_ISOLATION_UNQUALIFIED"
      });
  });

  test(`${platform} cannot borrow another platform's native controls`, () => {
    // The control sets are disjoint per platform; presenting a neighbour's
    // evidence must not qualify this one.
    for (const other of Object.keys(NATIVE_CONTROLS)) {
      if (other === platform) continue;
      assert.throws(
        () =>
          qualifyPlatformIsolation({
            platform,
            nativeEvidence: evidence(platform, { controls: [...NATIVE_CONTROLS[other]] })
          }),
        { code: "VES_NATIVE_ISOLATION_UNQUALIFIED" },
        `${platform} accepted ${other}'s native controls`
      );
    }
  });
}

test("a platform with no isolation contract is refused, never defaulted", () => {
  for (const platform of ["aix", "freebsd", "Win32", "", "linux2"])
    assert.throws(() => qualifyPlatformIsolation({ platform, nativeEvidence: null }), {
      code: "VES_PLATFORM_UNSUPPORTED"
    });
});

test("no platform can advertise a grade the policy does not implement", () => {
  // `container-isolated` is a declared matrix case with no implementation. This
  // pins that: whatever evidence is supplied, no platform's advertised set may
  // contain it, so the matrix's not-qualified entry cannot silently become a
  // pass.
  for (const platform of Object.keys(NATIVE_CONTROLS)) {
    for (const nativeEvidence of [null, evidence(platform)]) {
      const { available } = qualifyPlatformIsolation({ platform, nativeEvidence });
      for (const grade of DECLARED_BUT_UNIMPLEMENTED_GRADES)
        assert.equal(available.includes(grade), false, `${platform} advertised the unimplemented grade ${grade}`);
      for (const grade of available)
        assert.ok(ADVERTISABLE_GRADES.includes(grade), `${platform} advertised the undeclared grade ${grade}`);
    }
  }
  assert.equal(
    POLICY_SOURCE.includes("container-isolated"),
    false,
    "container-isolated is declared not-qualified precisely because the policy never names it"
  );
});

test("high-risk executable work is refused a process-contained sandbox on every platform", () => {
  // The reason the grade axis matters. On a platform with no native evidence
  // the only available grade is process-contained, so high-risk work must be
  // refused rather than placed in the weaker sandbox.
  for (const platform of Object.keys(NATIVE_CONTROLS)) {
    const { available } = qualifyPlatformIsolation({ platform, nativeEvidence: null });
    assert.throws(
      () => selectIsolationProfile({ risk: "high-untrusted-executable", requested: "process-contained", available }),
      { code: "VES_STRONG_ISOLATION_UNAVAILABLE" },
      `${platform} placed high-risk executable work in a process-contained sandbox`
    );
    assert.throws(
      () => selectIsolationProfile({ risk: "high-untrusted-executable", requested: "native-restricted", available }),
      { code: "VES_ISOLATION_PROFILE_UNAVAILABLE" },
      `${platform} granted a native-restricted profile it had not qualified`
    );
  }
});

test("a qualified platform grants native-restricted to high-risk work and nothing beyond it", () => {
  for (const platform of Object.keys(NATIVE_CONTROLS)) {
    const { available } = qualifyPlatformIsolation({ platform, nativeEvidence: evidence(platform) });
    assert.equal(
      selectIsolationProfile({ risk: "high-untrusted-executable", requested: "native-restricted", available }),
      "native-restricted"
    );
    for (const grade of DECLARED_BUT_UNIMPLEMENTED_GRADES)
      assert.throws(
        () => selectIsolationProfile({ risk: "high-untrusted-executable", requested: grade, available }),
        { code: "VES_ISOLATION_PROFILE_UNAVAILABLE" },
        `${platform} granted the unimplemented grade ${grade}`
      );
  }
});
