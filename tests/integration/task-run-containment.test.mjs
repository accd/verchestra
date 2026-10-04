// invariant: nothing below a task state root is reached through a link. ADP-2
// refuses a `tasks/`, `keys/` or `verification/` root that resolves outside the
// Workspace state root; these cases close what it left open below a per-Run
// root. A Run directory, or a directory inside it, that is a link is refused
// with VES_STATE_ROOT_ESCAPE before any read or write, and a link in the place
// of an artifact is refused as an unreadable artifact, by a reader and by a
// writer. Every link here targets a directory and is created as a junction, so
// each case asserts the same thing on Windows, where a junction needs no
// privilege, as on POSIX.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, afterEach, test } from "node:test";

import { approveTask } from "../../apps/vestra-cli/src/task/task-approve.ts";
import { reviewTask } from "../../apps/vestra-cli/src/task/task-review.ts";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { runTask, watchCancellation } from "../../apps/vestra-cli/src/task/task-run.ts";
import { cancelTask, statusTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { verifyTask } from "../../apps/vestra-cli/src/task/task-verifier.ts";
import { requireRealDirectories, scratchSegments } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import { executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";
import { capsuleHarness, capsuleInput } from "../helpers/run-capsule-fixture.mjs";
import { cleanupTaskCommandFixtures, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import {
  GRANT_ID,
  RUN_ID,
  TASK_ID,
  WORKSPACE_ID,
  canonicalDigestOf,
  cleanupRunRecordFixtures,
  contextManifest,
  filled,
  planRecord,
  taskCommit,
  temporaryRoot,
  verificationReport
} from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);
afterEach(cleanupTaskCommandFixtures);

const POSIX = process.platform !== "win32";
const ESCAPE = { name: "PlatformSecurityError", code: "VES_STATE_ROOT_ESCAPE" };
const ACTOR = "human:local-operator";
const CHANGE = filled("9");
const ENTRY = Object.freeze({ gateId: "gate:unit", verdict: "PASS", exitCode: 0 });
const EVIDENCE_NAME = canonicalDigestOf(ENTRY).slice(7, 39);
const EVIDENCE_REF = `gate-evidence:${EVIDENCE_NAME}`;
const LESSON = Object.freeze({ lessonId: "lesson:1", text: "fixture lesson" });
const WORKTREE = `worktree:${"a".repeat(32)}:${"b".repeat(40)}`;
const OUTCOME = Object.freeze({ status: "FAILED", reason: "VES_EXECUTOR_CANCELLED" });
const MANIFEST = contextManifest();
const pkg = await executionHarness().builder.build(packageInput());
const capsule = await capsuleHarness().builder.build(capsuleInput());
const BOUND = Object.freeze({ packageId: pkg.artifactId, packageDigest: `sha256:${pkg.payloadDigest}` });

function unreadable(error) {
  assert.equal(error.envelope?.code, "VES_TASK_STATE_INVALID");
  assert.equal(error.envelope.safeDetails.reason, "VES_TASK_STATE_UNREADABLE");
  return true;
}

function recordGate(record) {
  record.gateEvidence.judging(CHANGE);
  return record.gateEvidence.record(ENTRY);
}

// invariant: one entry per artifact family of the Run directory: the
// directories inside the Run directory that hold it, the file it is when it
// is a single file the Run record names, and every operation of the Run
// record's interface that reads, writes, or removes it.
const FAMILIES = Object.freeze([
  {
    name: "plan record",
    directories: [],
    file: ["plan.json"],
    read: (record) => record.loadPlan(),
    write: (record) => record.savePlan(planRecord())
  },
  {
    name: "context manifest",
    directories: [],
    file: ["context-manifest.json"],
    read: (record) => record.loadContextManifest(MANIFEST.manifestId),
    write: (record) => record.saveContextManifest(MANIFEST)
  },
  {
    name: "Execution Package",
    directories: ["packages"],
    read: (record) => record.approvedPackage(BOUND),
    write: (record) => record.savePackage(pkg),
    more: [(record) => record.loadPackage(pkg.artifactId)]
  },
  {
    name: "gate evidence",
    directories: ["gate-evidence"],
    file: ["gate-evidence", `${EVIDENCE_NAME}.json`],
    read: (record) => record.gateEvidence.load(EVIDENCE_REF),
    write: recordGate,
    more: [(record) => record.gateEvidence.recover(CHANGE, ["gate:unit"], filled("0"))]
  },
  {
    name: "task commit record",
    directories: [],
    file: ["commit.json"],
    read: (record) => record.loadCommit(),
    write: (record) => record.saveCommit(taskCommit())
  },
  {
    name: "attempt record",
    directories: ["attempts"],
    file: ["attempts", "1.json"],
    write: (record) => record.sealAttempt(TASK_ID, { attempt: 1, passed: true, failure: undefined })
  },
  {
    name: "verification report",
    directories: ["verification"],
    file: ["verification", "report.json"],
    read: (record) => record.loadReport(),
    write: (record) => record.saveReport(verificationReport()),
    more: [(record) => record.verifiedCommit()]
  },
  {
    name: "lesson",
    directories: ["verification", "lessons"],
    file: ["verification", "lessons", `${canonicalDigestOf(LESSON).slice(7, 39)}.json`],
    write: (record) => record.saveLesson(LESSON)
  },
  {
    name: "review record",
    directories: [],
    file: ["review.json"],
    read: (record) => record.loadReview(),
    write: (record) => record.saveReview({ reviewer: ACTOR, outcome: "accepted" })
  },
  {
    name: "Run Capsule",
    directories: ["capsules"],
    write: (record) => record.saveCapsule(capsule)
  },
  {
    name: "grant marker",
    directories: [],
    file: ["grant.json"],
    read: (record) => record.loadGrant(),
    write: (record) => record.saveGrant(GRANT_ID)
  },
  {
    name: "active marker",
    directories: [],
    file: ["active.json"],
    read: (record) => record.activeProcess(),
    write: (record) => record.claimActive(process.pid),
    more: [(record) => record.releaseActive()],
    // why: a marker that cannot be read names no live process (ADP-2).
    linkedRead: (value) => assert.equal(value, undefined)
  },
  {
    name: "worktree marker",
    directories: [],
    file: ["worktree.json"],
    read: (record) => record.loadWorktreeRef(),
    write: (record) => record.saveWorktreeRef(WORKTREE)
  },
  {
    name: "cancel marker",
    directories: [],
    file: ["cancel.json"],
    read: (record) => record.cancelRequested(),
    write: (record) => record.requestCancel(ACTOR),
    // why: a cancel marker is a request by being there, and a request that
    // is already there stands, so neither reads or replaces the link.
    linkedRead: (value) => assert.equal(value, true),
    linkedWrite: (value) => assert.equal(value, undefined)
  },
  {
    name: "outcome marker",
    directories: [],
    file: ["outcome.json"],
    read: (record) => record.loadOutcome(),
    write: (record) => record.saveOutcome(OUTCOME)
  }
]);

const operations = (family) =>
  [family.read, family.write, ...(family.more ?? [])].filter((operation) => operation !== undefined);

function link(target, path) {
  return symlink(target, path, "junction");
}

async function isLink(path) {
  return (await lstat(path)).isSymbolicLink();
}

// why: a listing with the digest of every file, so "nothing was written,
// created, or removed there" is one comparison.
async function snapshot(directory, prefix = "") {
  const entries = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(entries, await snapshot(path, `${prefix}${entry.name}/`));
    else
      entries[`${prefix}${entry.name}`] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
  }
  return entries;
}

// invariant: a complete Run directory that lives somewhere else: every
// artifact a run writes, each one valid, so a read that followed a link to it
// would succeed and a refusal can only come from the link.
async function elsewhere() {
  const root = await temporaryRoot("verchestra-run-elsewhere-");
  const record = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot: root }, RUN_ID);
  await record.savePackage(pkg);
  await record.saveContextManifest(MANIFEST);
  await record.savePlan(planRecord());
  await record.saveGrant(GRANT_ID);
  await record.saveWorktreeRef(WORKTREE);
  await recordGate(record);
  await record.sealAttempt(TASK_ID, { attempt: 1, passed: true, failure: undefined });
  await record.saveCommit(taskCommit());
  await record.saveReport(verificationReport());
  await record.saveLesson(LESSON);
  await record.saveReview({ reviewer: ACTOR, outcome: "accepted" });
  await record.saveCapsule(capsule);
  await record.saveOutcome(OUTCOME);
  await record.claimActive(process.pid);
  await record.requestCancel(ACTOR);
  return { root, directory: join(root, RUN_ID), record };
}

async function opened() {
  const root = await temporaryRoot();
  const tasksRoot = join(root, "tasks");
  return {
    root,
    tasksRoot,
    directory: join(tasksRoot, RUN_ID),
    record: openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID)
  };
}

test("the fixture's other Run directory holds every family, each readable where it really is", async () => {
  const other = await elsewhere();
  for (const family of FAMILIES.filter((entry) => entry.read !== undefined))
    await assert.doesNotReject(family.read(other.record), family.name);
  for (const family of FAMILIES.filter((entry) => entry.file !== undefined))
    assert.equal((await lstat(join(other.directory, ...family.file))).isFile(), true, family.name);
});

for (const family of FAMILIES) {
  test(`no ${family.name} is read or written through a Run directory that is a link`, async () => {
    const other = await elsewhere();
    const run = await opened();
    await mkdir(run.tasksRoot);
    await link(other.directory, run.directory);
    const before = await snapshot(other.root);
    for (const operation of operations(family)) await assert.rejects(operation(run.record), ESCAPE);
    assert.deepEqual(await snapshot(other.root), before, "the link's target changed");
    assert.deepEqual(await readdir(run.tasksRoot), [RUN_ID]);
    assert.equal(await isLink(run.directory), true, "the link was replaced");
  });
}

for (const family of FAMILIES.filter((entry) => entry.directories.length > 0)) {
  for (let depth = 1; depth <= family.directories.length; depth += 1) {
    const linked = family.directories.slice(0, depth);
    test(`no ${family.name} is read or written through a linked ${linked.join("/")} directory`, async () => {
      const other = await elsewhere();
      const run = await opened();
      await mkdir(join(run.directory, ...linked.slice(0, -1)), { recursive: true });
      await link(join(other.directory, ...linked), join(run.directory, ...linked));
      const before = await snapshot(other.root);
      for (const operation of operations(family)) await assert.rejects(operation(run.record), ESCAPE);
      assert.deepEqual(await snapshot(other.root), before, "the link's target changed");
      assert.equal(await isLink(join(run.directory, ...linked)), true, "the link was replaced");
    });
  }
}

for (const family of FAMILIES.filter((entry) => entry.file !== undefined)) {
  test(`a link in the place of the ${family.name} is refused by a reader and by a writer, and is not replaced`, async () => {
    const other = await elsewhere();
    const run = await opened();
    const path = join(run.directory, ...family.file);
    await mkdir(dirname(path), { recursive: true });
    await link(other.directory, path);
    const before = await snapshot(other.root);
    if (family.linkedRead !== undefined) family.linkedRead(await family.read(run.record));
    else if (family.read !== undefined) await assert.rejects(family.read(run.record), unreadable);
    if (family.linkedWrite !== undefined) family.linkedWrite(await family.write(run.record));
    else await assert.rejects(family.write(run.record), unreadable);
    assert.equal(await isLink(path), true, "the link was replaced");
    assert.deepEqual(await snapshot(other.root), before, "the link's target changed");
    assert.deepEqual(await readdir(dirname(path)), [family.file.at(-1)], "a write left a temporary file behind");

    if (!POSIX) return;
    // why: only POSIX can link to a file without a privilege; the junction
    // above already asserted the refusal on every platform.
    const target = join(other.root, "linked-file.json");
    await writeFile(target, "the file a link points to\n");
    const posix = await opened();
    const linkedPath = join(posix.directory, ...family.file);
    await mkdir(dirname(linkedPath), { recursive: true });
    await symlink(target, linkedPath);
    if (family.linkedWrite !== undefined) family.linkedWrite(await family.write(posix.record));
    else await assert.rejects(family.write(posix.record), unreadable);
    assert.equal(await readFile(target, "utf8"), "the file a link points to\n");
    assert.equal(await isLink(linkedPath), true);
  });
}

// invariant: the package and capsule stores name their own files and already
// refused a link at one; that refusal is theirs and is unchanged.
test("the package and capsule stores keep their own refusal of a link in the place of an artifact", async () => {
  const other = await elsewhere();
  const run = await opened();
  for (const [directory, artifact] of [
    ["packages", pkg],
    ["capsules", capsule]
  ]) {
    await mkdir(join(run.directory, directory), { recursive: true });
    await link(other.directory, join(run.directory, directory, `${artifact.artifactId}.json`));
  }
  const before = await snapshot(other.root);
  await assert.rejects(run.record.savePackage(pkg), { code: "VES_EXECUTION_PACKAGE_STORAGE_INVALID" });
  await assert.rejects(run.record.loadPackage(pkg.artifactId), { code: "VES_EXECUTION_PACKAGE_STORAGE_INVALID" });
  await assert.rejects(run.record.saveCapsule(capsule), { code: "VES_RUN_CAPSULE_STORAGE_INVALID" });
  assert.deepEqual(await snapshot(other.root), before);
});

test("a write refuses a directory in the place of an artifact instead of failing in the rename", async () => {
  const run = await opened();
  await mkdir(join(run.directory, "commit.json"), { recursive: true });
  await assert.rejects(run.record.saveCommit(taskCommit()), unreadable);
  assert.deepEqual(await readdir(run.directory), ["commit.json"]);
});

test("the link check reads only: a path that does not exist yet passes and nothing is created", async () => {
  const root = await temporaryRoot();
  await requireRealDirectories(join(root, "tasks"), [RUN_ID, "verification", "lessons"]);
  assert.deepEqual(await readdir(root), []);
  await mkdir(join(root, "tasks", RUN_ID, "verification"), { recursive: true });
  await requireRealDirectories(join(root, "tasks"), [RUN_ID, "verification", "lessons"]);
  assert.deepEqual(await readdir(join(root, "tasks", RUN_ID, "verification")), []);
});

test("the link check refuses a link at any depth, also one whose target is gone, and leaves a file to its reader", async () => {
  const other = await temporaryRoot();
  for (const depth of [1, 2, 3]) {
    const root = await temporaryRoot();
    const names = [RUN_ID, "verification", "lessons"];
    await mkdir(join(root, ...names.slice(0, depth - 1)), { recursive: true });
    await link(other, join(root, ...names.slice(0, depth)));
    await assert.rejects(requireRealDirectories(root, names), ESCAPE, `depth ${depth}`);
    if (depth > 1) await requireRealDirectories(root, names.slice(0, depth - 1));
  }
  const dangling = await temporaryRoot();
  await link(join(other, "gone"), join(dangling, RUN_ID));
  await assert.rejects(requireRealDirectories(dangling, [RUN_ID]), ESCAPE);

  const blocked = await temporaryRoot();
  await writeFile(join(blocked, RUN_ID), "a file where the Run directory belongs");
  await requireRealDirectories(blocked, [RUN_ID, "verification"]);
});

// invariant: verification deletes its scratch checkouts recursively. A link
// at the run's scratch root, or at the checkout, stops verification before it
// creates or deletes anything.
test("verification refuses a linked scratch root before it deletes or creates a checkout", async () => {
  const [runSegment, review] = scratchSegments(RUN_ID, "review");
  for (const linked of [[runSegment], [runSegment, review]]) {
    const other = await temporaryRoot("verchestra-scratch-elsewhere-");
    await mkdir(join(other, review));
    await writeFile(join(other, review, "keep.txt"), "not a scratch checkout\n");
    await writeFile(join(other, "keep.txt"), "not a scratch checkout\n");
    const root = await temporaryRoot();
    const verificationRoot = join(root, "verification");
    await mkdir(join(verificationRoot, ...linked.slice(0, -1)), { recursive: true });
    await link(linked.length === 1 ? other : join(other, review), join(verificationRoot, ...linked));
    const before = await snapshot(other);
    const context = { workspace: { verificationRoot, repositoryRoot: root }, plan: { runId: RUN_ID } };
    await assert.rejects(
      verifyTask(context, taskCommit(), {}, new AbortController().signal),
      ESCAPE,
      `a link at ${linked.join("/")}`
    );
    assert.deepEqual(await snapshot(other), before, "verification deleted or created something through the link");
  }
});

async function linkedRun(state) {
  const fixture = await taskCommandFixture();
  const run = await fixture.planned(state);
  const other = await temporaryRoot("verchestra-run-moved-");
  await rename(run.directory, join(other, RUN_ID));
  await link(join(other, RUN_ID), run.directory);
  return { fixture, other, before: await snapshot(other) };
}

// invariant: every command reads the plan record first, so a Run directory
// that is a link stops it before it opens the runtime store, reads a
// credential, or changes anything. The plan behind the link is valid: without
// the check each command would go on.
const COMMANDS = Object.freeze([
  ["approve", "AWAITING_EXECUTION_APPROVAL", (io) => approveTask(io, { ...RUN, bindingDigest: filled("6") })],
  ["start", "EXECUTION_AUTHORIZED", (io) => runTask(io, { ...RUN, resume: false })],
  ["resume", "IMPLEMENTING", (io) => runTask(io, { ...RUN, resume: true })],
  ["status", "IMPLEMENTING", (io) => statusTask(io, RUN)],
  ["cancel", "IMPLEMENTING", (io) => cancelTask(io, RUN)],
  ["review", "HUMAN_REVIEW", (io) => reviewTask(io, { ...RUN, outcome: "accepted", surfaceDigest: filled("0") })]
]);
const RUN = Object.freeze({ runId: RUN_ID, confirmStdin: false });

for (const [name, state, command] of COMMANDS) {
  test(`task ${name} refuses a Run directory that is a link before any effect`, async () => {
    const { fixture, other, before } = await linkedRun(state);
    await assert.rejects(command(fixture.io), ESCAPE);
    assert.equal(fixture.state(), state, "a refused command moved the run");
    assert.deepEqual(await snapshot(other), before, "a refused command wrote through the link");
  });
}

// hazard: the watcher may stop the run before a case starts to wait for it,
// and an abort that already happened raises no event.
function stopped(controller, timeoutMs) {
  if (controller.signal.aborted) return Promise.resolve(controller.signal.reason);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    controller.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(controller.signal.reason);
    });
  });
}

// hazard: a watcher that is not stopped keeps its timer, and with it the test
// process, alive; every case stops its watcher whether or not it passes.
async function watched(record, observe) {
  const controller = new AbortController();
  const stop = watchCancellation(record, controller, { running: () => false });
  try {
    return await observe(controller);
  } finally {
    stop();
  }
}

test("a run whose driver cannot read its cancel request is stopped, and one with no request runs on", async () => {
  const quiet = await opened();
  await mkdir(quiet.directory, { recursive: true });
  await watched(quiet.record, async (controller) => {
    assert.equal(await stopped(controller, 1_000), undefined, "a run nobody cancelled was stopped");
    await quiet.record.requestCancel(ACTOR);
    assert.equal(await stopped(controller, 5_000), "cancel requested");
  });

  const other = await elsewhere();
  const moved = await opened();
  await mkdir(moved.tasksRoot);
  await link(other.directory, moved.directory);
  await watched(moved.record, async (controller) => {
    assert.equal(await stopped(controller, 5_000), "cancel request unreadable");
  });

  // why: a directory that cannot be searched is a POSIX permission fact, and
  // it does not hold for a privileged user.
  if (!POSIX || process.getuid() === 0) return;
  const closed = await opened();
  await mkdir(closed.directory, { recursive: true });
  await chmod(closed.directory, 0o000);
  try {
    await assert.rejects(closed.record.cancelRequested(), { code: "EACCES" });
    await watched(closed.record, async (controller) => {
      assert.equal(await stopped(controller, 5_000), "cancel request unreadable");
    });
  } finally {
    await chmod(closed.directory, 0o700);
  }
});
