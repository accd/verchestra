// invariant: the task worktree module is the one place that knows the handle
// encoding, the task branch name, and the commit trailers (ADP-1). These cases
// pin each of them at that interface for SHA-1 and SHA-256 object IDs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  encodeWorktreeHandle,
  isGitObjectId,
  isTaskBranchComponent,
  parseTaskCommitTrailers,
  parseWorktreeHandle,
  registeredWorktrees,
  taskBranchName,
  taskBranchRef,
  taskCommitMessage
} from "../../packages/platform-node/src/task-worktree.ts";

const ID = "0123456789abcdef0123456789abcdef";
const BASES = Object.freeze({ sha1: "a".repeat(40), sha256: "b".repeat(64) });
const digest = (character) => `sha256:${character.repeat(64)}`;
// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement this suite does not test.
const requirement = (suffix) => ["VES", suffix].join("-");
const UNSORTED_REQUIREMENTS = Object.freeze(["EXE-002", "APP-010", "EXE-001"].map(requirement));

const REQUEST = Object.freeze({
  subject: "feat(app): implement the task",
  taskId: "T405.3",
  runId: "run_405",
  requirementIds: UNSORTED_REQUIREMENTS,
  gatePlanDigest: digest("1"),
  gateEvidenceDigest: digest("2"),
  expectedChangeDigest: digest("4"),
  idempotencyKey: digest("3")
});

// invariant: recorded from the message NodeAtomicGitCommitAdapter wrote before
// the writer moved here; a reconciled commit is compared against these bytes.
const GOLDEN_MESSAGE =
  "feat(app): implement the task\n" +
  "\n" +
  "Verchestra-Task: T405.3\n" +
  "Verchestra-Run: run_405\n" +
  `Verchestra-Requirements: ${["APP-010", "EXE-001", "EXE-002"].map(requirement).join(",")}\n` +
  `Verchestra-Gate-Plan: sha256:${"1".repeat(64)}\n` +
  `Verchestra-Gate-Evidence: sha256:${"2".repeat(64)}\n` +
  `Verchestra-Change: sha256:${"4".repeat(64)}\n` +
  `Verchestra-Idempotency-Key: sha256:${"3".repeat(64)}`;

for (const [format, baseCommit] of Object.entries(BASES)) {
  test(`a handle with a ${format} base round-trips through encode and parse`, () => {
    const worktreeRef = encodeWorktreeHandle({ id: ID, baseCommit });
    assert.equal(worktreeRef, `worktree:${ID}:${baseCommit}`);
    assert.deepEqual(parseWorktreeHandle(worktreeRef), { id: ID, baseCommit });
    assert.equal(isGitObjectId(baseCommit), true);
  });

  test(`a ${format} base that is one digit short or long is rejected by encode and parse`, () => {
    for (const base of [baseCommit.slice(1), `${baseCommit}a`]) {
      assert.equal(encodeWorktreeHandle({ id: ID, baseCommit: base }), undefined, base);
      assert.equal(parseWorktreeHandle(`worktree:${ID}:${base}`), undefined, base);
      assert.equal(isGitObjectId(base), false, base);
    }
  });

  test(`a ${format} base that is not lowercase hexadecimal is rejected`, () => {
    for (const base of [baseCommit.toUpperCase(), `g${baseCommit.slice(1)}`, `${baseCommit.slice(1)}\n`]) {
      assert.equal(encodeWorktreeHandle({ id: ID, baseCommit: base }), undefined);
      assert.equal(parseWorktreeHandle(`worktree:${ID}:${base}`), undefined);
    }
  });

  test(`a malformed handle around a valid ${format} base is rejected`, () => {
    for (const id of [ID.slice(1), `${ID}0`, ID.toUpperCase(), "../../../../../../../../escape-0000"])
      assert.equal(encodeWorktreeHandle({ id, baseCommit }), undefined, id);
    for (const worktreeRef of [
      `worktree:${ID.slice(1)}:${baseCommit}`,
      `worktree:${ID}0:${baseCommit}`,
      `worktree:${ID}:${baseCommit}:extra`,
      `Worktree:${ID}:${baseCommit}`,
      ` worktree:${ID}:${baseCommit}`,
      `worktree:${ID}:${baseCommit}\n`,
      `worktree:${ID}`,
      "worktree:self-test",
      ""
    ])
      assert.equal(parseWorktreeHandle(worktreeRef), undefined, JSON.stringify(worktreeRef));
  });
}

test("a 64-digit base is never read as its last 40 digits", () => {
  const baseCommit = `${"c".repeat(24)}${"d".repeat(40)}`;
  const parsed = parseWorktreeHandle(encodeWorktreeHandle({ id: ID, baseCommit }));
  assert.equal(parsed.baseCommit, baseCommit);
  assert.notEqual(parsed.baseCommit, baseCommit.slice(-40));
});

test("the task branch has one ref and one short name", () => {
  assert.equal(taskBranchName("run_405", "T405.3"), "vestra/run_405/T405.3");
  assert.equal(taskBranchRef("run_405", "T405.3"), "refs/heads/vestra/run_405/T405.3");
  assert.equal(taskBranchRef("run_405", "T405.3"), `refs/heads/${taskBranchName("run_405", "T405.3")}`);
});

test("a run or task ID names a task branch only when it is one safe ref component", () => {
  for (const component of ["run_405", "T405.3", "a", "A-b_c.9"])
    assert.equal(isTaskBranchComponent(component), true, component);
  for (const component of ["run:405", "T405/3", "T405..3", "T405.lock", ".hidden", "-flag", "", "a".repeat(129)])
    assert.equal(isTaskBranchComponent(component), false, component);
});

test("the task commit message is byte-identical to the recorded golden message", () => {
  const message = taskCommitMessage(REQUEST);
  assert.deepEqual(Buffer.from(message, "utf8"), Buffer.from(GOLDEN_MESSAGE, "utf8"));
  assert.equal(Buffer.byteLength(message), 522);
  assert.equal(
    createHash("sha256").update(message).digest("hex"),
    "ca613c03c63912a426d23db03ed4597f5abeeda39513f65b6b22d0e7dcd49882"
  );
  assert.deepEqual(
    REQUEST.requirementIds,
    ["EXE-002", "APP-010", "EXE-001"].map(requirement),
    "the input is not reordered"
  );
});

test("the trailers the writer wrote are the trailers the parser reads", () => {
  assert.deepEqual(parseTaskCommitTrailers(taskCommitMessage(REQUEST)), {
    runId: "run_405",
    taskId: "T405.3",
    idempotencyKey: digest("3"),
    gateEvidenceDigest: digest("2")
  });
  assert.deepEqual(parseTaskCommitTrailers(`${taskCommitMessage(REQUEST).replaceAll("\n", "\r\n")}\r\n`), {
    runId: "run_405",
    taskId: "T405.3",
    idempotencyKey: digest("3"),
    gateEvidenceDigest: digest("2")
  });
});

test("a message without the trailers yields empty identities and no gate evidence", () => {
  assert.deepEqual(parseTaskCommitTrailers("an unexplained commit\n"), {
    runId: "",
    taskId: "",
    idempotencyKey: "",
    gateEvidenceDigest: undefined
  });
});

test("a subject that imitates a trailer cannot shadow the trailer block", () => {
  const message = taskCommitMessage({ ...REQUEST, subject: `Verchestra-Gate-Evidence: ${digest("9")}` });
  assert.equal(parseTaskCommitTrailers(message).gateEvidenceDigest, digest("2"));
  const run = taskCommitMessage({ ...REQUEST, subject: "Verchestra-Run: run_other" });
  assert.equal(parseTaskCommitTrailers(run).runId, "run_405");
});

test("a gate evidence trailer that is not exactly one digest is not gate evidence", () => {
  for (const value of [
    "sha256:short",
    `sha256:${"2".repeat(64)} `,
    `sha256:${"2".repeat(65)}`,
    `SHA256:${"2".repeat(64)}`
  ])
    assert.equal(
      parseTaskCommitTrailers(`subject\n\nVerchestra-Gate-Evidence: ${value}`).gateEvidenceDigest,
      undefined
    );
});

test("the registration listing maps every worktree directory to its HEAD and skips bare entries", () => {
  const listing = [
    "worktree /repository",
    "bare",
    "",
    "worktree /state/worktrees/0123",
    `HEAD ${BASES.sha256}`,
    "detached",
    "",
    "worktree /state/worktrees/4567",
    `HEAD ${BASES.sha1}`,
    "branch refs/heads/main",
    ""
  ].join("\n");
  const entries = registeredWorktrees(listing.replaceAll("\n", "\r\n"));
  assert.equal(entries.size, 2);
  assert.deepEqual([...entries.values()], [BASES.sha256, BASES.sha1]);
  assert.deepEqual([...registeredWorktrees(listing).values()], [BASES.sha256, BASES.sha1]);
});
