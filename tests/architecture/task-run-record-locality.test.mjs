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
  "outcome.json",
  "ledger.json"
]);
const ARTIFACT_DIRECTORIES = Object.freeze([
  "packages",
  "capsules",
  "gate-evidence",
  "attempts",
  "lessons",
  "coordination",
  "results"
]);

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
  const store =
    /\bRuntimeCheckpointStore\b|\.(?:inspectGate|inspectRepair|recordRepair|executorCheckpoints|gateCheckpoints|repairState)\(/u;
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

// invariant: a command acts on the Execution Package the plan bound. The Run
// record's checked reader compares the package with the plan's digest; the
// unchecked one is the store's own read and no command calls it.
test("no task command reads the Execution Package without the plan digest check", () => {
  assert.deepEqual(offenders(/\.loadPackage\(/u), []);
  for (const name of ["task-approve.ts", "task-review.ts"])
    assert.match(sources.find((entry) => entry.name === name)?.source ?? "", /\.approvedPackage\(plan\)/u, name);
});

// invariant: the refusal of a link below a task state root is defined once,
// beside the roots themselves. The Run record reaches every path of the Run
// directory through its two checked functions, and verification reaches its
// scratch checkouts through one, in the task Workspace module (ADR2-4).
test("only the task Workspace module refuses a link below a task state root, and every path below one is checked", () => {
  const elsewhere = sources.filter(({ name }) => name !== "task-workspace.ts");
  assert.deepEqual(offenders(/VES_STATE_ROOT_ESCAPE/u, elsewhere), []);
  assert.match(owner, /requireRealDirectories\(this\.#tasksRoot,/u);
  assert.equal(
    owner.match(/join\(this\.#tasksRoot\b/gu)?.length,
    2,
    "a Run path is built outside the checked functions"
  );
  assert.doesNotMatch(owner, /\btasksRoot,\s*id\b/u, "the Run directory is joined where the Run record is opened");
  const workspace = sources.find(({ name }) => name === "task-workspace.ts")?.source ?? "";
  assert.match(workspace, /requireRealDirectories\(workspace\.verificationRoot, \[runId, purpose\]\)/u);
  assert.equal(
    workspace.match(/\bjoin\(workspace\.verificationRoot\b/gu)?.length,
    1,
    "a scratch path is built outside the checked function"
  );
  assert.deepEqual(
    offenders(
      /\.verificationRoot\b/u,
      sources.filter(({ name }) => name !== "task-workspace.ts")
    ),
    [],
    "a scratch path is reached outside the task Workspace module"
  );
  for (const name of ["task-verifier.ts", "task-mutation-sensor.ts"])
    assert.match(sources.find((entry) => entry.name === name)?.source ?? "", /\bscratchCheckouts\(/u, name);
});

// invariant: which form a Run's five markers take is one fact with one
// reader. The plan record's module names the seal, `task plan` stamps it on a
// new run, and only the Run record reads it and writes a marker accordingly.
test("the marker seal is stamped by task plan and read only by the Run record", () => {
  const named = /\bmarkerSeal\b|\bMARKER_SEAL\b/u;
  const allowed = new Set([OWNER, "task-plan.ts", "task-plan-record.ts"]);
  assert.deepEqual(
    offenders(
      named,
      sources.filter(({ name }) => !allowed.has(name))
    ),
    []
  );
  assert.match(sources.find(({ name }) => name === "task-plan.ts")?.source ?? "", /markerSeal: MARKER_SEAL\b/u);
  assert.match(owner, /plan\.markerSeal === MARKER_SEAL/u);
  const plainMarkerWrite = /writeJsonAtomic\(await this\.#file\(LAYOUT\.(?:grant|active|worktree|cancel|outcome)\)/u;
  assert.doesNotMatch(owner, plainMarkerWrite, "a marker is written without asking which form the Run uses");
  for (const marker of ["grant", "active", "worktree", "cancel", "outcome"])
    assert.match(owner, new RegExp(`#writeMarker\\(LAYOUT\\.${marker},`, "u"), marker);
});

// invariant: `task review` reads everything the Run Capsule binds from the
// Run directory's markers before it asks the human or records the review.
test("task review reads the grant marker once, before the review surface", () => {
  const review = sources.find(({ name }) => name === "task-review.ts")?.source ?? "";
  assert.equal(review.match(/\.loadGrant\(\)/gu)?.length, 1);
  assert.ok(review.indexOf(".loadGrant()") < review.indexOf("await reviewSurface("), "the grant is read too late");
  assert.ok(review.indexOf(".loadGrant()") > review.indexOf("export async function reviewTask("));
});

// invariant: one run, one account of usage. Every meter the task composition
// builds records on the Run's ledger: the repair loop's is wrapped in
// `recordingMeter`, and verification is the work `meterOnRunLedger` meters.
// The budget module is the one caller that records a ledger on the Run record.
test("every meter of a run records on the Run's ledger, and only the budget module records one", () => {
  const run = sources.find(({ name }) => name === "task-run.ts")?.source ?? "";
  assert.match(run, /create: \(resume\) => recordingMeter\(this\.#checkpoints, this\.#meter\(resume\)\)/u);
  assert.match(run, /return meterOnRunLedger\(\s*this\.#checkpoints,\s*\(resume\) => this\.#meter\(resume\),/u);
  assert.equal(run.match(/this\.#meter\(/gu)?.length, 2, "a meter is built that records nothing");
  assert.equal(run.match(/\bcreateBudgetMeter\(/gu)?.length, 1, "a meter is built outside #meter");
  assert.match(run, /\(meter\)\s*=>\s*verifyTask\(/u, "verification is not the metered work");
  assert.equal(run.match(/\bverifyTask\(/gu)?.length, 1, "verification is started in more than one place");
  assert.doesNotMatch(run, /\bmeter:/u, "the verifier is handed a meter that is not on the Run's ledger");
  assert.match(owner, /\brecordBudgetLedger\(ledger: BudgetLedger\): void\b/u);
  assert.deepEqual(offenders(/\.recordBudgetLedger\(/u), ["task-budget.ts"]);
  const budget = sources.find(({ name }) => name === "task-budget.ts")?.source ?? "";
  assert.equal(budget.match(/\.recordBudgetLedger\(/gu)?.length, 2);
  assert.match(budget, /finally\s*\{\s*run\.recordBudgetLedger\(meter\.ledger\(\)\);/u, "no record when the work ends");
});
