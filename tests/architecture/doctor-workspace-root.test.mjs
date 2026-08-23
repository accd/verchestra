import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// #207 finding (2026-08-09): the seven presence-only doctor checks watched
// ".vestra" while `vestra init` (packages/workspace/src/init/safe-init.ts)
// only ever writes ".verchestra" — the probes observed a directory nothing
// on the machine could ever create.
//
// The root and every subsystem path below it are now owned by one domain
// contract (DDL-01/DDL-02, #207) instead of copied into each side. Both
// doctor-composition.ts and safe-init.ts import the value rather than
// declaring it, so this test proves neither file holds a competing literal —
// at the source level, without executing either file.

const contractSource = readFileSync(
  new URL("../../packages/domain/src/workspace-layout/subsystem-layout.ts", import.meta.url),
  "utf8"
);
const doctorSource = readFileSync(new URL("../../apps/vestra-cli/src/doctor-composition.ts", import.meta.url), "utf8");
const safeInitSource = readFileSync(new URL("../../packages/workspace/src/init/safe-init.ts", import.meta.url), "utf8");

function constDeclaration(source, name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*"([^"]+)"`, "u"));
  assert.ok(match, `expected a \`const ${name} = "..."\` declaration`);
  return match[1];
}

const COMPETING_LITERAL = /const\s+WORKSPACE_ROOT_DIRNAME\s*=\s*"/u;
const IMPORTS_ROOT_FROM_DOMAIN = /import\s*\{[^}]*\bWORKSPACE_ROOT_DIRNAME\b[^}]*\}\s*from\s*"@verchestra\/domain"/u;

for (const [label, source] of [
  ["apps/vestra-cli/src/doctor-composition.ts", doctorSource],
  ["packages/workspace/src/init/safe-init.ts", safeInitSource]
]) {
  test(`${label} derives the workspace root from the layout contract instead of declaring a competing literal`, () => {
    assert.doesNotMatch(
      source,
      COMPETING_LITERAL,
      `${label} must not redeclare the workspace root; it must import the value from @verchestra/domain ` +
        "so the doctor and init cannot drift"
    );
    assert.match(source, IMPORTS_ROOT_FROM_DOMAIN, `${label} must import the root from @verchestra/domain`);
  });
}

test("the layout contract's watched root is exactly one path segment (a bare dotdir, never a nested or empty path)", () => {
  assert.match(constDeclaration(contractSource, "WORKSPACE_ROOT_DIRNAME"), /^\.[a-z]+$/u);
});

// DDL-03 / AC1 (#207): "every path the doctor probes is owned by [the layout]
// contract." Proven statically: every fileProbe(...) call in the composition
// root must route its path through subsystemPath(metadataRoot, "<key>") with
// a key the contract actually declares — never a hand-rolled join(...) that
// bypasses the contract. This is the ownership half of T4; the provisioning
// half ("nothing provisions this path" also fails the gate) lands with T5,
// which is what provisions the paths this test would otherwise have nothing
// to check against.

function contractSubsystemKeys(source) {
  const block = source.match(/SUBSYSTEM_OBSERVATION_PATHS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\s*as const\)/u);
  assert.ok(block, "expected a SUBSYSTEM_OBSERVATION_PATHS object literal in the layout contract");
  // Object keys are either quoted ("cedar-policy") or bare identifiers (driver).
  return [...block[1].matchAll(/(?:"([a-z-]+)"|\b([a-z]+)\b)\s*:/gu)].map((match) => match[1] ?? match[2]);
}

// Every live probe that watches a metadataRoot-relative path names its
// subsystem through `subsystemPath(metadataRoot, "<key>")` or
// `availabilityProbe(metadataRoot, "<key>")` — the two call shapes that
// route a literal subsystem key through the contract — never a hand-rolled
// `join(metadataRoot, "...")` that bypasses it. `subsystemPath`'s own second
// parameter is typed `keyof typeof SUBSYSTEM_OBSERVATION_PATHS`
// (TypeScript-enforced, gated by `pnpm typecheck`), so this textual check is
// a redundant, language-independent proof of the same property, not the only
// one. secret-presence (T15) is intentionally absent here: it observes
// through a live adapter port (`DoctorLiveProbeOptions.secret`), not a
// metadataRoot-relative path, so it has nothing to route through this
// contract at all.
const SUBSYSTEM_PATH_CALL_SITE = /subsystemPath\(\s*metadataRoot\s*,\s*"([a-z-]+)"\s*\)/gu;
const AVAILABILITY_PROBE_CALL_SITE = /availabilityProbe\(\s*metadataRoot\s*,\s*"([a-z-]+)"\s*\)/gu;

test("every subsystemPath and availabilityProbe call site uses a contract-owned subsystem key", () => {
  const contractKeys = new Set(contractSubsystemKeys(contractSource));
  assert.ok(contractKeys.size > 0, "expected at least one subsystem key in the contract");

  const usedKeys = [
    ...[...doctorSource.matchAll(SUBSYSTEM_PATH_CALL_SITE)].map((match) => match[1]),
    ...[...doctorSource.matchAll(AVAILABILITY_PROBE_CALL_SITE)].map((match) => match[1])
  ];
  assert.ok(usedKeys.length > 0, "expected at least one subsystemPath/availabilityProbe call site to check");

  for (const key of usedKeys) {
    assert.ok(
      contractKeys.has(key),
      `a call site uses subsystem key "${key}", which the layout contract does not declare`
    );
  }
});

// DDL-03 / AC2 (#207): "a contract path nothing provisions fails the gate" —
// the defect the original issue comment described, one level down from the
// root-dirname fix. `scripts/provision-doctor-fixtures.mjs` is the only
// repository surface that materializes these paths (T5). Proven statically:
// the provisioner must import the contract and iterate it generically
// (`Object.entries(SUBSYSTEM_OBSERVATION_PATHS)`) rather than hand-listing
// subsystem keys — a hand-listed enumeration is exactly how a path silently
// stops being provisioned, since nothing forces it to stay in sync with the
// contract as subsystems are added.

const provisionerSource = readFileSync(new URL("../../scripts/provision-doctor-fixtures.mjs", import.meta.url), "utf8");

test("the fixture provisioner imports the layout contract", () => {
  assert.match(
    provisionerSource,
    /import\s*\{[^}]*\bSUBSYSTEM_OBSERVATION_PATHS\b[^}]*\}\s*from\s*"\.\.\/packages\/domain\/src\/index\.ts"/u,
    "scripts/provision-doctor-fixtures.mjs must import SUBSYSTEM_OBSERVATION_PATHS from the layout contract"
  );
});

test("the fixture provisioner derives every path from the contract by generic iteration, never a hand-listed subsystem", () => {
  assert.match(
    provisionerSource,
    /Object\.entries\(\s*SUBSYSTEM_OBSERVATION_PATHS\s*\)/u,
    "scripts/provision-doctor-fixtures.mjs must iterate SUBSYSTEM_OBSERVATION_PATHS generically; " +
      "a hand-listed per-subsystem case is exactly how a contract path silently stops being provisioned"
  );
});
