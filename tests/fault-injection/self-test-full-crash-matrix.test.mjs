import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  DURABLE_CRASH_PHASES,
  FULL_DURABLE_BOUNDARY_IDS,
  assertDurableBoundaryFacts
} from "../../packages/application/src/index.ts";
import { DisposableRootProvider, DurableCrashRunner, rootIdentityDigest } from "../../packages/self-test/src/index.ts";

const roots = [];
const entrypoint = resolve("apps/vestra-cli/src/self-test-full-crash-child.ts");

async function root() {
  const value = await new DisposableRootProvider({ baseDirectory: resolve(".tmp-self-test-full-crash") }).provision(
    "full"
  );
  roots.push(value.canonicalPath);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const expectedFingerprint = [
  "full.approval:pass",
  "full.capsule:pass",
  "full.context:pass",
  "full.effect:pass",
  "full.handoff:pass",
  "full.package:pass",
  "full.portable-evidence:pass",
  "full.routing:pass",
  "full.verification:pass"
];

for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS) {
  for (const phase of DURABLE_CRASH_PHASES) {
    test(`the production workflow converges after a ${phase} crash at ${boundaryId}`, async () => {
      const fact = await new DurableCrashRunner({ entrypoint }).run({ root: await root(), boundaryId, phase });
      assert.equal(fact.logicalResultCount, 1);
      assert.match(fact.logicalId, /^[-:._A-Za-z0-9]+$/u);
      assert.match(fact.resultDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.match(fact.resultStatus, /^[A-Z_-]+$/u);
      assert.match(fact.rootIdentity, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(fact.resumed, true);
      assert.equal(fact.crashExitCode, 86);
      assert.equal(fact.resumeExitCode, 0);
      assert.deepEqual(fact.semanticFingerprint, expectedFingerprint);
    });
  }
}

test("the production crash matrix satisfies the closed application verdict", async () => {
  const runner = new DurableCrashRunner({ entrypoint, timeoutMs: 60_000 });
  const disposable = await root();
  const facts = [];
  for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS) {
    for (const phase of DURABLE_CRASH_PHASES) facts.push(await runner.run({ root: disposable, boundaryId, phase }));
  }
  assert.doesNotThrow(() => assertDurableBoundaryFacts(facts, rootIdentityDigest(disposable)));
  assert.equal(new Set(facts.map(({ rootIdentity }) => rootIdentity)).size, facts.length);
  for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS) {
    const outcomes = facts.filter((fact) => fact.boundaryId === boundaryId);
    assert.equal(new Set(outcomes.map((fact) => fact.logicalId)).size, 1, `${boundaryId} logical identity diverged`);
    assert.equal(new Set(outcomes.map((fact) => fact.resultDigest)).size, 1, `${boundaryId} result digest diverged`);
    assert.equal(new Set(outcomes.map((fact) => fact.resultStatus)).size, 1, `${boundaryId} result status diverged`);
  }
});
