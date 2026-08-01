// T69 T4 faults: the composed trust domain must fail closed on every way a
// run can go wrong — sentinel mutation, incomplete cleanup, quarantine
// failure, unknown profiles, unregistered codes, and prohibited report
// content — and it must seal only what the evidence contract allows.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ArtifactSealer, NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { probeRootFacts } from "../../packages/self-test/src/index.ts";
import {
  SELF_TEST_FAILURE_CODES,
  SelfTestComposition,
  createSelfTestCodeRegistry
} from "../../apps/vestra-cli/src/self-test-composition.ts";

const bases = [];
const now = "2026-07-15T15:00:00.000Z";

async function base() {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-selftest-composition-"));
  bases.push(directory);
  return directory;
}

function sealer() {
  const signer = NodeEd25519Signer.generate({ keyId: "self-test-domain", purposes: ["self-test-report"] });
  return { sealer: new ArtifactSealer({ signer, now: () => new Date(now) }), signer };
}

function passingScenario(overrides = {}) {
  return {
    run: async () => ({
      checkCount: 4,
      durationMs: 12,
      evidenceRefs: [],
      failureCodes: [],
      redactionCount: 0,
      ...overrides
    })
  };
}

async function composition(directory, options = {}) {
  const { sealer: artifactSealer, signer } = sealer();
  return {
    signer,
    composition: new SelfTestComposition({
      baseDirectory: directory,
      guardedRoots: [await probeRootFacts(process.cwd())],
      sentinels: [],
      scenario: passingScenario(),
      sealer: artifactSealer,
      ...options
    })
  };
}

afterEach(async () => {
  await Promise.all(bases.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("a clean run seals a verifiable report bound to the code registry", async () => {
  const directory = await base();
  const { composition: composed, signer } = await composition(directory);
  const { result, artifact } = await composed.run("smoke");

  assert.equal(result.rootState, "removed");
  assert.equal(artifact.purpose, "self-test-report");
  assert.equal(artifact.bindingId, "self-test:smoke");
  assert.equal(artifact.sourceStateDigest, createSelfTestCodeRegistry().digest.replace("sha256:", ""));
  assert.deepEqual(Object.keys(artifact.payload).sort(), [
    "self_test.check_count",
    "self_test.duration_ms",
    "self_test.evidence_refs",
    "self_test.failure_codes",
    "self_test.profile",
    "self_test.redaction_count",
    "self_test.verdict"
  ]);
  const trust = createTrustRoot({ trustRootId: "self-test-root", version: 1, keys: [signer.publicKeyRef] });
  const verification = await new ArtifactSealer({ signer }).verify(artifact, trust, {
    purpose: "self-test-report",
    bindingId: "self-test:smoke",
    schema: { name: "self-test-report", version: 1 },
    sourceStateDigest: artifact.sourceStateDigest,
    now: new Date(now)
  });
  assert.equal(verification.ok, true, `verification failed: ${verification.code ?? "unknown"}`);

  // A report sealed against one registry must not verify as though it came
  // from another: the binding is what stops a replay under different codes.
  const swapped = await new ArtifactSealer({ signer }).verify(artifact, trust, {
    purpose: "self-test-report",
    bindingId: "self-test:smoke",
    schema: { name: "self-test-report", version: 1 },
    sourceStateDigest: "0".repeat(64),
    now: new Date(now)
  });
  assert.equal(swapped.ok, false);
  assert.equal(swapped.code, "VES_INTEGRITY_SOURCE_STATE_MISMATCH");
});

test("an unknown profile fails closed before any root is provisioned", async () => {
  const directory = await base();
  const { composition: composed } = await composition(directory);
  await assert.rejects(composed.run("crash-recovery"), { code: "VES_SELFTEST_UNKNOWN_PROFILE" });
  assert.deepEqual(await readdir(directory), [], "no disposable root may exist after an unknown profile");
});

test("a sentinel mutated during the run quarantines the root and seals nothing", async () => {
  const directory = await base();
  const sentinelPath = join(directory, "guarded-state.db");
  await writeFile(sentinelPath, "original");
  const { composition: composed } = await composition(directory, {
    sentinels: [{ sentinelId: "guarded-state.db", path: sentinelPath }],
    scenario: {
      run: async () => {
        await writeFile(sentinelPath, "mutated by the run");
        return { checkCount: 1, durationMs: 1, evidenceRefs: [], failureCodes: [], redactionCount: 0 };
      }
    }
  });
  await assert.rejects(composed.run("smoke"), (error) => {
    assert.equal(error.code, "VES_SELFTEST_SENTINEL_MUTATION");
    assert.match(error.message, /guarded-state\.db/u);
    return true;
  });
  const quarantined = (await readdir(directory)).filter((entry) => entry.includes(".quarantined-"));
  assert.equal(quarantined.length, 1, "the mutated run's root must be quarantined, not removed");
});

test("a sentinel deleted during the run is caught as a removed sentinel", async () => {
  const directory = await base();
  const sentinelPath = join(directory, "vanishing.db");
  await writeFile(sentinelPath, "here");
  const { composition: composed } = await composition(directory, {
    sentinels: [{ sentinelId: "vanishing.db", path: sentinelPath }],
    scenario: {
      run: async () => {
        await rm(sentinelPath);
        return { checkCount: 1, durationMs: 1, evidenceRefs: [], failureCodes: [], redactionCount: 0 };
      }
    }
  });
  await assert.rejects(composed.run("smoke"), { code: "VES_SELFTEST_SENTINEL_MUTATION" });
});

test("a scenario that reports a failure code seals a FAIL verdict instead of throwing", async () => {
  const directory = await base();
  const { composition: composed } = await composition(directory, {
    scenario: passingScenario({ failureCodes: ["VES_SELFTEST_FIXTURE_BUDGET"] })
  });
  const { artifact, result } = await composed.run("workspace");
  assert.equal(artifact.payload["self_test.verdict"], "FAIL");
  assert.deepEqual(artifact.payload["self_test.failure_codes"], ["VES_SELFTEST_FIXTURE_BUDGET"]);
  assert.equal(result.rootState, "removed", "a reported failure still cleans up");
});

test("an unregistered failure code fails closed instead of reaching evidence", async () => {
  const directory = await base();
  const { composition: composed } = await composition(directory, {
    scenario: passingScenario({ failureCodes: ["VES_SELFTEST_MADE_UP"] })
  });
  await assert.rejects(composed.run("smoke"), /unregistered failure code: VES_SELFTEST_MADE_UP/u);
});

test("prohibited report content is refused before sealing", async () => {
  const directory = await base();
  const { composition: composed } = await composition(directory, {
    scenario: passingScenario({ evidenceRefs: ["transcript of the run"] })
  });
  await assert.rejects(composed.run("smoke"), { code: "VES_SELFTEST_REPORT_CONTENT_PROHIBITED" });
});

test("the registry carries every declared code and rejects an unknown one", () => {
  const registry = createSelfTestCodeRegistry();
  for (const code of SELF_TEST_FAILURE_CODES) assert.equal(registry.has(code), true, code);
  assert.equal(registry.has("VES_SELFTEST_NOT_A_CODE"), false);
  assert.match(registry.digest, /^sha256:[0-9a-f]{64}$/u);
});

test("a scenario writing outside its fixture budget surfaces the bounded failure", async () => {
  const directory = await base();
  const { composition: composed } = await composition(directory, {
    scenario: {
      run: async ({ fixtures }) => {
        await assert.rejects(fixtures.write("../escape.txt", "x"), { code: "VES_SELFTEST_FIXTURE_ESCAPE" });
        await fixtures.write("inside.txt", "ok");
        return {
          checkCount: 2,
          durationMs: 3,
          evidenceRefs: [],
          failureCodes: ["VES_SELFTEST_FIXTURE_ESCAPE"],
          redactionCount: 0
        };
      }
    }
  });
  const { artifact } = await composed.run("smoke");
  assert.equal(artifact.payload["self_test.verdict"], "FAIL");
});

test("the subject only ever receives test-only material", async () => {
  const directory = await base();
  let observed = null;
  const { composition: composed } = await composition(directory, {
    scenario: {
      run: async ({ materials }) => {
        observed = materials;
        return { checkCount: 1, durationMs: 1, evidenceRefs: [], failureCodes: [], redactionCount: 0 };
      }
    }
  });
  await composed.run("drivers");
  assert.ok(observed.length > 0);
  assert.ok(observed.every((material) => material.testOnly === true));
});
