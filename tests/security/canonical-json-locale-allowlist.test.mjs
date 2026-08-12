import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

// CJ4-10: fails closed when a new ambient-locale sort appears anywhere in
// packages/*/src. Two ceiling groups:
//
// - MATRIX_CEILINGS: owners docs/canonical-json-compatibility.md classifies
//   trust/persistent. Each ceiling is a ratchet, not a pin: the true target
//   for every migrated owner is 0. A count above its ceiling fails (a
//   regression); a count at or below is allowed so T4a-T4j migrations can
//   lower ceilings independently of this file without editing it on every
//   slice. T9 tightens the four T4a owners to 0.
// - UNCLASSIFIED_CEILINGS: every other packages/*/src occurrence found by a
//   full census while building this sensor (48 files, 133 sites total,
//   2026-08-09). The matrix has not audited these; freezing at the discovered
//   count still catches a *new* occurrence anywhere, without silently
//   expanding this slice's scope to classify and migrate them.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// Two entries are intentionally NOT zero even after full migration:
// workspace/scanner-primitives.ts's two sites are inside the V1 `canonical()`
// helper the matrix requires kept byte-identical for `buildInventoryFingerprint`
// (docs/canonical-json-compatibility.md, "Compatibility rules" row 1).
const MATRIX_CEILINGS = Object.freeze({
  "packages/evidence/src/integrity/canonical.ts": 0,
  // T4b owners: migrated (issue #58), ceiling tightened to 0.
  "packages/application/src/authority/authority.ts": 0,
  "packages/application/src/coordination/work-claims.ts": 0,
  // T4c owner: migrated (issue #58), ceiling tightened to 0.
  "packages/application/src/execution/gate-commit.ts": 0,
  "packages/application/src/egress/trust-egress.ts": 1,
  "packages/application/src/handoff/validation.ts": 1,
  "packages/application/src/execution/gate-commit.ts": 1,
  // T4f owners: migrated (issue #58), ceilings tightened to 0.
  "packages/application/src/egress/trust-egress.ts": 0,
  "packages/application/src/handoff/validation.ts": 0,
  "packages/application/src/sync/workspace-reconcile.ts": 7,
  // T4g owner: migrated (issue #58), ceiling tightened to 0.
  "packages/application/src/sync/workspace-reconcile.ts": 0,
  "packages/application/src/effects/effect-contract.ts": 0,
  "packages/agent-runtime/src/context/context-compiler.ts": 10,
  "packages/agent-runtime/src/context/source-snapshots.ts": 9,
  // T4d owners: migrated (issue #58), ceilings tightened to 0.
  "packages/policy/src/cedar-policy.ts": 0,
  // T4e owners: migrated (issue #58), ceilings tightened to 0.
  "packages/agent-runtime/src/context/context-compiler.ts": 0,
  "packages/agent-runtime/src/context/source-snapshots.ts": 0,
  "packages/agent-runtime/src/context/backend-serializers.ts": 0,
  "packages/policy/src/cedar-policy.ts": 2,
  // T4h owners: migrated (issue #58), ceilings tightened to 0.
  "packages/data-probe/src/database-knowledge.ts": 0,
  "packages/data-probe/src/sqlserver-adapter.ts": 0,
  "packages/data-probe/src/sqlite-adapter.ts": 0,
  "packages/data-probe/src/sap-ase-adapter.ts": 0,
  "packages/data-probe/src/postgresql-adapter.ts": 0,
  "packages/data-probe/src/oracle-adapter.ts": 0,
  "packages/data-probe/src/mysql-family-adapter.ts": 0,
  "packages/data-probe/src/mongodb-adapter.ts": 0,
  "packages/data-probe/src/index.ts": 0,
  "packages/distribution/src/hermetic-bundle.ts": 2,
  "packages/distribution/src/transactional-activation.ts": 1,
  "packages/platform-node/src/runtime-store/runtime-store.ts": 0,
  "packages/workspace/src/scanner/scanner-primitives.ts": 2,
  "packages/evidence/src/execution-package/execution-package.ts": 11,
  // T4a owners: migrated (T4/T5/T6/T7), ceiling tightened to 0 in T9.
  "packages/application/src/promotion/promotion-gate.ts": 0,
  "packages/application/src/regression/campaigns.ts": 0,
  "packages/application/src/doctor/doctor.ts": 0,
  "packages/application/src/self-test/self-test.ts": 0
});

const UNCLASSIFIED_CEILINGS = Object.freeze({
  "packages/agent-runtime/src/discovery/discovery-router.ts": 1,
  "packages/agent-runtime/src/models/model-router.ts": 4,
  "packages/agent-runtime/src/models/passport-registry.ts": 2,
  "packages/agent-runtime/src/skills/governed-skill-registry.ts": 1,
  "packages/application/src/bootstrap/machine-bootstrap.ts": 6,
  "packages/connectors/src/confluence/architecture-source.ts": 5,
  "packages/connectors/src/confluence/delivery-projection.ts": 1,
  "packages/connectors/src/jira/jira.ts": 1,
  "packages/distribution/src/tuf-update-client.ts": 0,
  "packages/drivers/src/index.ts": 1,
  "packages/drivers/src/opencode-driver.ts": 1,
  "packages/effects/src/effect-kernel.ts": 2,
  "packages/evidence/src/recovery-bundle/recovery-bundle.ts": 5,
  "packages/evidence/src/run-capsule/run-capsule.ts": 3,
  "packages/evidence/src/support-bundle/support-bundle.ts": 2,
  "packages/extension-host/src/index.ts": 1,
  "packages/memory/src/memory-lifecycle.ts": 2,
  "packages/memory/src/memory-retriever.ts": 2,
  "packages/memory/src/memory-store.ts": 5,
  "packages/memory/src/memory-vector-index.ts": 3,
  "packages/policy/src/policy-bundle.ts": 2,
  "packages/platform-node/src/git-worktree-adapter.ts": 0
});

const CEILINGS = Object.freeze({ ...MATRIX_CEILINGS, ...UNCLASSIFIED_CEILINGS });

// Other discrimination sensors (e.g. canonical-json-sensor.test.mjs) write
// disposable `*.mutant-<uuid>.ts` fixtures beside their source under test
// while tests run in parallel; skip that naming convention so a concurrent
// sensor's transient fixture never flakes this scan.
const DISPOSABLE_FIXTURE = /\.mutant-[0-9a-f-]+\.ts$/u;

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts") && !DISPOSABLE_FIXTURE.test(entry.name)) files.push(path);
  }
  return files;
}

function localeCompareCount(source) {
  return (source.match(/\.localeCompare\(/gu) ?? []).length;
}

// Exported shape kept small and pure so the discrimination test below can
// exercise it directly against a disposable fixture tree instead of the real
// repository.
export async function findLocaleAllowlistViolations(root, ceilings) {
  const violations = [];
  const seen = new Set();
  for (const relativePath of Object.keys(ceilings)) {
    const absolutePath = join(root, relativePath);
    let source;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    seen.add(relativePath);
    const count = localeCompareCount(source);
    if (count > ceilings[relativePath]) violations.push({ file: relativePath, count, ceiling: ceilings[relativePath] });
  }
  const packagesRoot = join(root, "packages");
  let packageDirs = [];
  try {
    packageDirs = await readdir(packagesRoot, { withFileTypes: true });
  } catch {
    packageDirs = [];
  }
  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue;
    const srcDir = join(packagesRoot, entry.name, "src");
    let files;
    try {
      files = await sourceFiles(srcDir);
    } catch {
      continue;
    }
    for (const file of files) {
      const relativePath = file.slice(root.length).replace(/\\/gu, "/").replace(/^\//u, "");
      if (seen.has(relativePath)) continue;
      const source = await readFile(file, "utf8");
      const count = localeCompareCount(source);
      if (count > 0) violations.push({ file: relativePath, count, ceiling: 0 });
    }
  }
  return violations;
}

test("every tracked trust/persistent owner is at or below its declared ambient-locale ceiling", async () => {
  const violations = await findLocaleAllowlistViolations(repoRoot, CEILINGS);
  assert.deepEqual(violations, []);
});

test("every tracked owner file still exists (no silent removal desyncing the allowlist)", async () => {
  for (const relativePath of Object.keys(CEILINGS)) {
    await assert.doesNotReject(readFile(join(repoRoot, relativePath), "utf8"));
  }
});

const disposableDirs = [];
afterEach(async () => {
  await Promise.all(disposableDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("mutation: a new localeCompare in an untracked packages/*/src file is caught", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "canonical-json-allowlist-"));
  disposableDirs.push(scratchRoot);
  const srcDir = join(scratchRoot, "packages", `mutant-package-${randomUUID().slice(0, 8)}`, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(srcDir, "digest.ts"), "export function order(a, b) { return a.localeCompare(b); }\n", "utf8");
  const violations = await findLocaleAllowlistViolations(scratchRoot, {});
  assert.equal(violations.length, 1);
  assert.equal(violations[0].count, 1);
  assert.equal(violations[0].ceiling, 0);
});

test("mutation: exceeding a tracked owner's ceiling is caught", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "canonical-json-allowlist-"));
  disposableDirs.push(scratchRoot);
  const srcDir = join(scratchRoot, "packages", "application", "src", "authority");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    join(srcDir, "authority.ts"),
    "export function order(a, b) { return a.localeCompare(b) + a.localeCompare(b); }\n",
    "utf8"
  );
  const violations = await findLocaleAllowlistViolations(scratchRoot, {
    "packages/application/src/authority/authority.ts": 1
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "packages/application/src/authority/authority.ts");
  assert.equal(violations[0].count, 2);
  assert.equal(violations[0].ceiling, 1);
});

test("a count at exactly the ceiling is not a violation", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "canonical-json-allowlist-"));
  disposableDirs.push(scratchRoot);
  const srcDir = join(scratchRoot, "packages", "application", "src", "authority");
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(srcDir, "authority.ts"), "export function order(a, b) { return a.localeCompare(b); }\n", "utf8");
  const violations = await findLocaleAllowlistViolations(scratchRoot, {
    "packages/application/src/authority/authority.ts": 1
  });
  assert.deepEqual(violations, []);
});
