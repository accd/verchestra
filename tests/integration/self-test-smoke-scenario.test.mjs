// T70 T4: the smoke scenario drives the real controller/CLI path
// (.specs/features/self-test-profiles/spec.md PRF-05/PRF-07).
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { SMOKE_CHECK_IDS } from "../../packages/application/src/index.ts";
import { BoundedFixtureFactory, DisposableRootProvider } from "../../packages/self-test/src/index.ts";
import { createSmokeScenario } from "../../apps/vestra-cli/src/index.ts";

const roots = [];

async function provisionedRoot() {
  const provider = new DisposableRootProvider({ baseDirectory: join(process.cwd(), ".tmp-selftest-smoke") });
  const root = await provider.provision("smoke");
  roots.push(root.canonicalPath);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function run() {
  const root = await provisionedRoot();
  const facts = await createSmokeScenario().run({
    root,
    fixtures: new BoundedFixtureFactory(root, 1_048_576),
    materials: []
  });
  return facts;
}

test("the smoke scenario produces every declared check id, all passing", async () => {
  const facts = await run();
  const ids = facts.checks.map((check) => check.checkId).sort();
  assert.deepEqual(ids, [...SMOKE_CHECK_IDS].sort());
  assert.ok(
    facts.checks.every((check) => check.status === "pass"),
    JSON.stringify(facts.checks.filter((check) => check.status !== "pass"))
  );
  assert.deepEqual(facts.failureCodes, []);
  assert.equal(facts.checkCount, SMOKE_CHECK_IDS.length);
});

test("the smoke scenario makes no network attempt", async () => {
  const facts = await run();
  assert.deepEqual(facts.failureCodes, []);
});

test("two independent smoke runs against fresh roots produce the same check ids and statuses", async () => {
  const first = await run();
  const second = await run();
  const fingerprint = (facts) => facts.checks.map((check) => `${check.checkId}:${check.status}`).sort();
  assert.deepEqual(fingerprint(first), fingerprint(second));
});
