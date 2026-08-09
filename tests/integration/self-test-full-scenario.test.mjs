import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  FULL_CHECK_IDS,
  FULL_DURABLE_BOUNDARY_IDS,
  semanticFingerprint
} from "../../packages/application/src/index.ts";
import { DisposableRootProvider, FileRecordStore } from "../../packages/self-test/src/index.ts";
import { runFullWorkflowScenario } from "../../apps/vestra-cli/src/self-test-full-scenario.ts";

const roots = [];

async function root() {
  const provider = new DisposableRootProvider({ baseDirectory: join(process.cwd(), ".tmp-self-test-full") });
  const value = await provider.provision("full");
  roots.push(value.canonicalPath);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("the full scenario exercises every successful production boundary", async () => {
  const result = await runFullWorkflowScenario(await root());
  assert.deepEqual(
    result.facts.checks.map((entry) => entry.checkId),
    FULL_CHECK_IDS.filter((checkId) => checkId !== "full.crash-recovery")
  );
  assert.equal(
    result.facts.checks.every((entry) => entry.status === "pass"),
    true
  );
  assert.deepEqual(result.facts.failureCodes, []);
});

test("the complete delivery path uses its production APIs", async () => {
  const { diagnostics } = await runFullWorkflowScenario(await root());
  assert.equal(diagnostics.packageStored, "published");
  assert.equal(diagnostics.packageVerified, true);
  assert.equal(diagnostics.approvalVerified, true);
  assert.equal(diagnostics.contextFragments, 1);
  assert.match(diagnostics.routedPassportId, /^passport_/u);
  assert.equal(diagnostics.executionStatus, "AWAITING_GATE");
  assert.equal(diagnostics.effectApplyCalls, 1);
  assert.equal(diagnostics.gateStatus, "COMMITTED");
  assert.equal(diagnostics.verificationVerdict, "PASS");
  assert.equal(diagnostics.handoffStatus, "EXECUTION_AUTHORIZED");
  assert.equal(diagnostics.capsuleStored, "published");
  assert.equal(diagnostics.capsuleVerified, true);
});

test("the sealed verification report binds distinct implementation and verifier drivers", async () => {
  const disposableRoot = await root();
  await runFullWorkflowScenario(disposableRoot);
  const records = new FileRecordStore({ root: join(disposableRoot.canonicalPath, "self-test-records") });
  const report = await records.load("verification:report");

  assert.equal(report.schemaVersion, 2);
  // #35 / AD-011: the binding must name drivers that were actually probed and
  // resolved, not two labels chosen to differ. It used to read
  // "deterministic-implementer-driver"/"deterministic-verifier-driver" — strings
  // bound to no driver instance, so the independence assertion passed on
  // spelling alone. The resolution now produces exactly AD-011's worked example:
  // Claude Code implements, Codex verifies.
  assert.deepEqual(report.driverBinding, {
    implementerDriverId: "claude-code",
    verifierDriverId: "codex"
  });
  // The regression this replaces: no invented identity may reappear.
  assert.equal(JSON.stringify(report.driverBinding).includes("deterministic-"), false);
});

test("the complete delivery path queries one authoritative outcome per durable boundary", async () => {
  const result = await runFullWorkflowScenario(await root());
  assert.deepEqual(
    result.durableOutcomes.map((outcome) => outcome.boundaryId),
    FULL_DURABLE_BOUNDARY_IDS
  );
  for (const outcome of result.durableOutcomes) {
    assert.match(outcome.logicalId, /^[-:._A-Za-z0-9]+$/u);
    assert.equal(outcome.logicalResultCount, 1);
    assert.match(outcome.resultDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(outcome.resultStatus, /^[A-Z_-]+$/u);
  }
});

test("portable full-scenario evidence excludes provider-local state", async () => {
  const result = await runFullWorkflowScenario(await root());
  const portable = JSON.stringify(result.portableArtifacts).toLowerCase();
  for (const forbidden of [
    "provider",
    "session",
    "transcript",
    "prompt",
    "credential",
    "secret",
    "environment",
    "userprofile"
  ]) {
    assert.equal(portable.includes(forbidden), false, forbidden);
  }
});

test("independent full-scenario runs have one semantic fingerprint", async () => {
  const first = await runFullWorkflowScenario(await root());
  const second = await runFullWorkflowScenario(await root());
  assert.deepEqual(semanticFingerprint(first.facts.checks), semanticFingerprint(second.facts.checks));
});
