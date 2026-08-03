import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, afterEach, test } from "node:test";

import {
  DURABLE_CRASH_PHASES,
  FULL_DURABLE_BOUNDARY_IDS,
  assertDurableBoundaryFacts
} from "../../packages/application/src/index.ts";
import { DurableCrashRunner, probeRootFacts } from "../../packages/self-test/src/index.ts";

const roots = [];
const entrypoint = resolve("tests/helpers/self-test-durable-crash-child.mjs");
process.env.VERCHESTRA_TEST_FORBIDDEN_MARKER = "synthetic-self-test-value";

async function root() {
  const path = await mkdtemp(join(process.cwd(), ".tmp-self-test-crash-"));
  roots.push(path);
  return probeRootFacts(path);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

after(() => {
  delete process.env.VERCHESTRA_TEST_FORBIDDEN_MARKER;
});

for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS) {
  for (const phase of DURABLE_CRASH_PHASES) {
    test(`${phase} crash at ${boundaryId} resumes exactly once`, async () => {
      const facts = await new DurableCrashRunner({ entrypoint }).run({ root: await root(), boundaryId, phase });
      assert.equal(facts.boundaryId, boundaryId);
      assert.equal(facts.phase, phase);
      assert.equal(facts.logicalResultCount, 1);
      assert.equal(facts.resumed, true);
      assert.equal(facts.crashExitCode, 86);
      assert.equal(facts.resumeExitCode, 0);
      assert.deepEqual(facts.semanticFingerprint, ["environment.clean:pass", "full.boundaries:pass"]);
    });
  }
}

test("the complete child-process matrix satisfies the application verdict", async () => {
  const runner = new DurableCrashRunner({ entrypoint });
  const disposable = await root();
  const facts = [];
  for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS) {
    for (const phase of DURABLE_CRASH_PHASES) facts.push(await runner.run({ root: disposable, boundaryId, phase }));
  }
  assert.doesNotThrow(() => assertDurableBoundaryFacts(facts));
});

test("a relative child entrypoint is refused", () => {
  assert.throws(() => new DurableCrashRunner({ entrypoint: "tests/helpers/child.mjs" }), {
    code: "VES_SELFTEST_CRASH_ENTRYPOINT_INVALID"
  });
});

test("a child that produces no persisted facts fails closed", async () => {
  const runner = new DurableCrashRunner({
    entrypoint: resolve("tests/helpers/self-test-durable-crash-no-facts-child.mjs")
  });
  await assert.rejects(runner.run({ root: await root(), boundaryId: FULL_DURABLE_BOUNDARY_IDS[0], phase: "before" }), {
    code: "VES_SELFTEST_CRASH_FACTS_INVALID"
  });
});

test("an unavailable child executable fails closed", async () => {
  const runner = new DurableCrashRunner({ entrypoint, executable: resolve("tests/helpers/does-not-exist.exe") });
  await assert.rejects(runner.run({ root: await root(), boundaryId: FULL_DURABLE_BOUNDARY_IDS[0], phase: "before" }), {
    code: "VES_SELFTEST_CRASH_PROCESS_FAILED"
  });
});
