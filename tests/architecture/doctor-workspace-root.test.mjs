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
