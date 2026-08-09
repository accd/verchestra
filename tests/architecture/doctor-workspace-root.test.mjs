import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// #207 finding (2026-08-09): the seven presence-only doctor checks watched
// ".vestra" while `vestra init` (packages/workspace/src/init/safe-init.ts)
// only ever writes ".verchestra" — the probes observed a directory nothing
// on the machine could ever create. doctor-composition.ts keeps its own
// WORKSPACE_ROOT_DIRNAME literal (see that file's comment for why it does
// not import @verchestra/workspace: SafeInitService is a genuine filesystem
// writer, and importing it would widen the doctor's read-only reachable
// graph past what tests/architecture/doctor-readonly-graph.test.mjs allows).
// This test proves the two literals cannot drift apart again, at the source
// level, without either file importing the other.

const doctorSource = readFileSync(new URL("../../apps/vestra-cli/src/doctor-composition.ts", import.meta.url), "utf8");
const safeInitSource = readFileSync(new URL("../../packages/workspace/src/init/safe-init.ts", import.meta.url), "utf8");

function constDeclaration(source, name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*"([^"]+)"`, "u"));
  assert.ok(match, `expected a \`const ${name} = "..."\` declaration`);
  return match[1];
}

test("the doctor's watched workspace root equals the root init actually writes", () => {
  const doctorRoot = constDeclaration(doctorSource, "WORKSPACE_ROOT_DIRNAME");
  const initRoot = constDeclaration(safeInitSource, "WORKSPACE_ROOT_DIRNAME");
  assert.equal(
    doctorRoot,
    initRoot,
    "apps/vestra-cli/src/doctor-composition.ts and packages/workspace/src/init/safe-init.ts " +
      "must declare the identical WORKSPACE_ROOT_DIRNAME literal"
  );
});

test("the doctor's watched root is exactly one path segment (a bare dotdir, never a nested or empty path)", () => {
  const doctorRoot = constDeclaration(doctorSource, "WORKSPACE_ROOT_DIRNAME");
  assert.match(doctorRoot, /^\.[a-z]+$/u);
});
