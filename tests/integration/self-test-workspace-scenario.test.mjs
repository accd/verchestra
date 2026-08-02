// T70 T5: the workspace scenario drives placement, initialization,
// bootstrap, sync, and reconciliation across all five workspace shapes
// (.specs/features/self-test-profiles/spec.md PRF-02/PRF-03, acceptance
// criterion 7).
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { WORKSPACE_CHECK_IDS, semanticFingerprint } from "../../packages/application/src/index.ts";
import { BoundedFixtureFactory, DisposableRootProvider } from "../../packages/self-test/src/index.ts";
import { createWorkspaceScenario } from "../../apps/vestra-cli/src/index.ts";

const roots = [];

async function provisionedRoot() {
  const provider = new DisposableRootProvider({ baseDirectory: join(process.cwd(), ".tmp-selftest-workspace") });
  const root = await provider.provision("workspace");
  roots.push(root.canonicalPath);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function run() {
  const root = await provisionedRoot();
  return createWorkspaceScenario().run({
    root,
    fixtures: new BoundedFixtureFactory(root, 16_777_216),
    materials: []
  });
}

test("the workspace scenario produces every declared check id, all passing", async () => {
  const facts = await run();
  const ids = facts.checks.map((check) => check.checkId).sort();
  assert.deepEqual(ids, [...WORKSPACE_CHECK_IDS].sort());
  assert.ok(
    facts.checks.every((check) => check.status === "pass"),
    JSON.stringify(facts.checks.filter((check) => check.status !== "pass"))
  );
  assert.deepEqual(facts.failureCodes, []);
});

test("the workspace scenario registers at least 25 checks and makes no network attempt", async () => {
  const facts = await run();
  assert.ok(facts.checkCount >= 25, `expected >=25 checks, got ${facts.checkCount}`);
  assert.deepEqual(facts.failureCodes, []);
});

test("placement checks distinguish ignored projects from visible ones", async () => {
  const facts = await run();
  const ignoredCheck = facts.checks.find((check) => check.checkId === "workspace.ignored.placement");
  const colocatedCheck = facts.checks.find((check) => check.checkId === "workspace.colocated.placement");
  assert.equal(ignoredCheck.status, "pass");
  assert.equal(colocatedCheck.status, "pass");
});

test("two independent workspace runs against fresh roots converge to the same fingerprint (PRF-04)", async () => {
  const first = await run();
  const second = await run();
  assert.deepEqual(semanticFingerprint(first.checks), semanticFingerprint(second.checks));
});

test("sync and reconcile checks run for every shape", async () => {
  const facts = await run();
  for (const shape of ["standalone", "colocated", "centralized", "nested", "ignored"]) {
    assert.ok(
      facts.checks.some((check) => check.checkId === `workspace.${shape}.sync` && check.status === "pass"),
      `missing or failed sync check for ${shape}`
    );
    assert.ok(
      facts.checks.some((check) => check.checkId === `workspace.${shape}.reconcile` && check.status === "pass"),
      `missing or failed reconcile check for ${shape}`
    );
  }
});
