import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// #207 finding (2026-08-09): the seven presence-only doctor checks watched
// ".vestra" while `vestra init` (packages/workspace/src/init/safe-init.ts)
// only ever writes ".verchestra" — the probes observed a directory nothing
// on the machine could ever create.
//
// The root is now owned by one domain contract (DDL-01/DDL-02) rather than
// copied into each side. doctor-composition.ts still keeps its own literal
// (see that file's comment for why it does not import @verchestra/workspace:
// SafeInitService is a genuine filesystem writer, and importing it would
// widen the doctor's read-only reachable graph past what
// tests/architecture/doctor-readonly-graph.test.mjs allows), so this test
// pins that literal to the contract and proves safe-init holds no competing
// copy — at the source level, without either file importing the other.

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

test("the doctor's watched workspace root equals the root the layout contract owns", () => {
  assert.equal(
    constDeclaration(doctorSource, "WORKSPACE_ROOT_DIRNAME"),
    constDeclaration(contractSource, "WORKSPACE_ROOT_DIRNAME"),
    "apps/vestra-cli/src/doctor-composition.ts must watch the root declared by " +
      "packages/domain/src/workspace-layout/subsystem-layout.ts"
  );
});

test("init derives the root from the contract instead of declaring a competing literal", () => {
  assert.doesNotMatch(
    safeInitSource,
    /const\s+WORKSPACE_ROOT_DIRNAME\s*=\s*"/u,
    "packages/workspace/src/init/safe-init.ts must not redeclare the workspace root; " +
      "it re-exports the value from @verchestra/domain so the doctor and init cannot drift"
  );
  assert.match(
    safeInitSource,
    /import\s*\{[^}]*\bWORKSPACE_ROOT_DIRNAME\b[^}]*\}\s*from\s*"@verchestra\/domain"/u,
    "packages/workspace/src/init/safe-init.ts must import the root from @verchestra/domain"
  );
});

test("the doctor's watched root is exactly one path segment (a bare dotdir, never a nested or empty path)", () => {
  assert.match(constDeclaration(doctorSource, "WORKSPACE_ROOT_DIRNAME"), /^\.[a-z]+$/u);
});
