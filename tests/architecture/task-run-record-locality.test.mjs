// invariant: one module owns the layout, sealing, and validation of a Run's
// durable record (ADP-2): apps/vestra-cli/src/task/task-run-record.ts. Any other
// task source that spells out a path under the Run directory, opens one of its
// stores, or reads a sealed record itself has taken a second copy of that
// knowledge.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const taskRoot = fileURLToPath(new URL("../../apps/vestra-cli/src/task/", import.meta.url));
const OWNER = "task-run-record.ts";
const ARTIFACT_FILES = Object.freeze([
  "plan.json",
  "context-manifest.json",
  "commit.json",
  "report.json",
  "review.json",
  "grant.json",
  "active.json",
  "worktree.json",
  "cancel.json",
  "outcome.json"
]);
const ARTIFACT_DIRECTORIES = Object.freeze(["packages", "capsules", "gate-evidence", "attempts", "lessons"]);

// why: a comment may name an artifact to explain a decision; only code that
// would have to change with the layout counts as a second copy.
function code(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

const sources = readdirSync(taskRoot)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, source: code(readFileSync(join(taskRoot, name), "utf8")) }));
const owner = sources.find(({ name }) => name === OWNER)?.source ?? "";
const others = sources.filter(({ name }) => name !== OWNER);

const quoted = (names) =>
  new RegExp(`["'\`](?:${names.map((name) => name.replaceAll(".", "\\.")).join("|")})["'\`]`, "u");
const offenders = (pattern, scanned = others) =>
  scanned.filter(({ source }) => pattern.test(source)).map(({ name }) => name);

test("the scan reads the task sources and the Run record module spells out the whole layout", () => {
  assert.ok(sources.length >= 25, `only ${sources.length} task sources were scanned`);
  for (const name of [...ARTIFACT_FILES, ...ARTIFACT_DIRECTORIES])
    assert.match(owner, quoted([name]), `${OWNER} no longer names ${name}`);
});

test("no other task source names a file of the Run directory", () => {
  assert.deepEqual(offenders(quoted(ARTIFACT_FILES)), []);
});

test("no other task source joins a path into a directory of the Run directory", () => {
  const joined = new RegExp(`join\\([^)]*${quoted(ARTIFACT_DIRECTORIES).source}`, "u");
  assert.deepEqual(offenders(joined), []);
  assert.deepEqual(offenders(/\brunDirectory\b/u), [], "a Run directory is passed around outside the Run record");
});

test("only the Run record module opens the Run's stores and reads or writes a sealed record", () => {
  assert.deepEqual(offenders(/\bnew\s+(?:FileExecutionPackageStore|FileRunCapsuleStore|TaskEvidenceStore)\b/u), []);
  const sealed = /\b(?:readSealedRecord|writeSealedRecord)\b/u;
  // why: task-files.ts defines the seal and task-evidence.ts is the gate
  // evidence store the Run record opens; both are reached only through it.
  assert.deepEqual(offenders(sealed), ["task-evidence.ts", "task-files.ts"]);
  for (const pattern of [/\bnew\s+FileExecutionPackageStore\b/u, /\bnew\s+FileRunCapsuleStore\b/u, sealed])
    assert.match(owner, pattern);
});

// invariant: commands reach a Run's state through the Run record, never
// through another command's module.
test("the task commands do not import one another for Run state", () => {
  const imports = (name) =>
    [...(sources.find((entry) => entry.name === name)?.source ?? "").matchAll(/from\s+"\.\/(task-[a-z-]+)\.ts"/gu)].map(
      (match) => match[1]
    );
  for (const [name, forbidden] of [
    ["task-status.ts", ["task-run", "task-verifier", "task-evidence", "task-files"]],
    ["task-surface.ts", ["task-verifier", "task-evidence", "task-run"]],
    ["task-review.ts", ["task-verifier", "task-evidence", "task-run"]],
    ["task-approve.ts", ["task-evidence", "task-files"]]
  ]) {
    const imported = imports(name);
    assert.ok(imported.length > 0, `${name} was not scanned`);
    assert.deepEqual(
      imported.filter((entry) => forbidden.includes(entry)),
      [],
      `${name} imports another command's module`
    );
  }
});

// invariant: the runtime store returns checkpoint rows of unknown shape; the
// Run record module turns them into typed projections, and no command reads
// or casts a row itself.
test("only the Run record module opens the checkpoint store or reads a checkpoint row", () => {
  const store = /\bRuntimeCheckpointStore\b|\.(?:inspectGate|executorCheckpoints|gateCheckpoints|repairState)\(/u;
  assert.deepEqual(offenders(store), []);
  assert.match(owner, store);
  const cast = /\bas\s+(?:Readonly<)?\{[^}]*\b(?:budgetLedger|toolReceiptRefs|changeDigest|changedPaths|stage)\??:/u;
  assert.deepEqual(offenders(cast, sources), [], "a checkpoint row is cast instead of read through a projection");
  assert.deepEqual(offenders(/\[\s*["'`](?:budgetLedger|toolReceiptRefs)["'`]\s*\]/u), []);
});

// invariant: the three task state roots beside the Workspace layout are named
// in task-workspace.ts, which checks that each resolves inside the Workspace
// state root; every other source takes them from the opened Workspace.
test("only the task Workspace module names and checks a task state root", () => {
  const workspace = sources.find(({ name }) => name === "task-workspace.ts")?.source ?? "";
  for (const name of ["tasks", "keys", "verification"])
    assert.match(workspace, quoted([name]), `task-workspace.ts no longer names ${name}`);
  assert.match(workspace, /VES_STATE_ROOT_ESCAPE/u);
  const joined = /workspaceRoot\s*,\s*["'`](?:tasks|keys|verification)["'`]/u;
  assert.deepEqual(offenders(joined, sources), [], "a task state root is joined onto the Workspace root by hand");
});
