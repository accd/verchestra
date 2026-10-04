// invariant: SSI-33, SSI-66, and D4 at the resume's own interface. A suspended
// run resumes only on a still valid approval and the worktree it left; an
// unsettled node that may have landed effects is refused until the owner types
// back the digest of its uncertainty record; a digest that names nothing is
// refused, never ignored; and every refusal is the task's failure envelope
// with a stable reason. The facts are stand-ins; the rules are the module's.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inspectMarkedWorktree,
  nodeUncertainties,
  parseReconcile,
  revalidateResume
} from "../../apps/vestra-cli/src/task/task-resumption.ts";
import { uncertaintyRecord } from "../../packages/application/src/index.ts";
import { canonicalRecordDigest } from "../helpers/coordinated-driver-fixture.mjs";

const RUN = "run_018f0b6d-7b1a-7abc-8def-612345678901";
const LEFT = `sha256:${"a".repeat(64)}`;
const MOVED = `sha256:${"b".repeat(64)}`;
const START = "2026-10-03T11:00:00.000Z";

function visit(nodeId, state, change = {}) {
  return { round: 1, nodeId, visit: 1, state, startedAt: START, receiptCount: 0, changeDigestBefore: LEFT, ...change };
}

function ledger(...visits) {
  return { schemaVersion: 1, mode: "graph", round: 1, roundState: "running", visits };
}

const PLANNED = visit("plan", "completed", { resultDigest: MOVED, resultBytes: 10, endedAt: START });
const QUOTA = visit("build", "failed", { endedAt: START, failureCode: "VES_DRIVER_QUOTA_EXHAUSTED" });
const PARTIAL = visit("build", "partial", { endedAt: START, receiptCount: 1 });

function facts(change = {}) {
  const asked = { approval: 0, worktree: 0 };
  const lines = [];
  return {
    asked,
    lines,
    facts: {
      runId: RUN,
      coordinated: true,
      suspended: { changeDigest: LEFT },
      ledger: ledger(PLANNED, QUOTA),
      approval: async () => {
        asked.approval += 1;
        return { valid: true, bindingDigest: MOVED };
      },
      worktree: async () => {
        asked.worktree += 1;
        return { changeDigest: LEFT, commitCountSinceBase: 0 };
      },
      reconcile: undefined,
      stderr: (line) => lines.push(line),
      ...change
    }
  };
}

function refusedFor(reason) {
  return (error) => {
    assert.equal(error?.envelope?.code, "VES_TASK_FAILED", String(error?.message));
    assert.deepEqual(error.envelope.safeDetails, { reason });
    return true;
  };
}

test("a suspended run whose approval holds and whose worktree is the one it left resumes", async () => {
  const { asked, lines, facts: given } = facts();
  assert.deepEqual(await revalidateResume(given), { fromSuspension: true });
  assert.deepEqual(asked, { approval: 1, worktree: 1 });
  assert.deepEqual(lines, []);
});

for (const [label, code] of [
  ["expired while it was suspended", "VES_APPROVAL_EXPIRED"],
  ["made stale by a changed Workspace policy", "VES_APPROVAL_STALE"],
  ["revoked", "VES_APPROVAL_REVOKED"]
])
  test(`a suspended run whose approval was ${label} is refused with that reason`, async () => {
    const { facts: given } = facts({ approval: async () => ({ valid: false, code }) });
    await assert.rejects(revalidateResume(given), refusedFor(code));
  });

for (const [label, worktree] of [
  ["changed", { changeDigest: MOVED, commitCountSinceBase: 0 }],
  ["committed to", { changeDigest: LEFT, commitCountSinceBase: 1 }],
  ["gone", undefined]
])
  test(`a suspended run whose worktree was ${label} while it waited is refused as drift`, async () => {
    const { facts: given } = facts({ worktree: async () => worktree });
    await assert.rejects(revalidateResume(given), refusedFor("VES_EXECUTOR_WORKTREE_DRIFT"));
  });

test("SSI-67: a node that left no effect needs no reconciliation", async () => {
  const uncertain = nodeUncertainties(RUN, ledger(PLANNED, QUOTA), LEFT);
  assert.deepEqual(
    uncertain.map((node) => [node.nodeId, node.effect]),
    [["build", "none"]]
  );
  assert.equal(uncertain[0].digest, canonicalRecordDigest(uncertaintyRecord(RUN, QUOTA)));
});

test("SSI-66: a partial node is refused, and the owner is shown the one command that reconciles it", async () => {
  const { lines, facts: given } = facts({ ledger: ledger(PLANNED, PARTIAL) });
  await assert.rejects(revalidateResume(given), refusedFor("VES_TASK_NODE_UNCERTAIN"));
  const [digest] = nodeUncertainties(RUN, ledger(PLANNED, PARTIAL), LEFT).map((node) => node.digest);
  assert.ok(lines.join("").includes(`vestra task resume --run-id ${RUN} --reconcile ${digest}`));
  assert.match(lines.join(""), /node build \(visit 1, partial, 1 receipts\)/u);
});

test("D4: the typed-back digest of the partial node lets the resume run it again", async () => {
  const [node] = nodeUncertainties(RUN, ledger(PLANNED, PARTIAL), LEFT);
  const { facts: given } = facts({ ledger: ledger(PLANNED, PARTIAL), reconcile: node.digest });
  assert.deepEqual(await revalidateResume(given), { fromSuspension: true });
});

test("a digest that names no unsettled node of this run is refused, even when nothing needs it", async () => {
  const otherRun = canonicalRecordDigest(uncertaintyRecord("run_other", PARTIAL));
  for (const ledgered of [ledger(PLANNED, PARTIAL), ledger(PLANNED, QUOTA)]) {
    const { facts: given } = facts({ ledger: ledgered, reconcile: otherRun });
    await assert.rejects(revalidateResume(given), refusedFor("VES_TASK_RECONCILE_UNMATCHED"));
  }
  const { facts: single } = facts({ coordinated: false, ledger: undefined, reconcile: otherRun });
  await assert.rejects(revalidateResume(single), refusedFor("VES_TASK_RECONCILE_UNMATCHED"));
});

test("two nodes that may have landed effects: reconciling one still refuses the other", async () => {
  const left = visit("left", "started");
  const right = visit("right", "started", { startedAt: "2026-10-03T11:00:01.000Z" });
  const both = ledger(left, right);
  const [first] = nodeUncertainties(RUN, both, LEFT);
  const { facts: given } = facts({ suspended: undefined, ledger: both, reconcile: first.digest });
  await assert.rejects(revalidateResume(given), refusedFor("VES_TASK_NODE_UNCERTAIN"));
});

test("an interrupted coordinated run is settled against its marked worktree, with no approval asked", async () => {
  let inspected = 0;
  const absent = async () => {
    inspected += 1;
    return undefined;
  };
  const { asked, facts: given } = facts({ suspended: undefined, worktree: absent });
  // why: without a worktree to compare, a failed node cannot be shown to have
  // left no effect, so it is uncertain.
  await assert.rejects(revalidateResume(given), refusedFor("VES_TASK_NODE_UNCERTAIN"));
  assert.equal(asked.approval, 0);
  assert.equal(inspected, 1);
});

test("a single-session run, and a coordinated one with no open round, resume as before, unasked", async () => {
  for (const change of [
    { coordinated: false, suspended: undefined, ledger: undefined },
    { suspended: undefined, ledger: { ...ledger(PLANNED), roundState: "completed" } }
  ]) {
    const { asked, facts: given } = facts(change);
    assert.deepEqual(await revalidateResume(given), { fromSuspension: false });
    assert.deepEqual(asked, { approval: 0, worktree: 0 });
  }
});

test("a reconcile digest is a SHA-256 digest or the command's argument is invalid", () => {
  assert.equal(parseReconcile(undefined), undefined);
  assert.equal(parseReconcile(LEFT), LEFT);
  for (const value of [true, "", "sha256:ABC", `sha256:${"a".repeat(63)}`, `${LEFT}\n`, `md5:${"a".repeat(32)}`])
    assert.throws(
      () => parseReconcile(value),
      (error) =>
        error.envelope.code === "VES_CLI_ARGUMENT_INVALID" && error.envelope.safeDetails.argument === "--reconcile"
    );
});

test("the marked worktree is inspected at the plan's base, and one that cannot be read is absent", async () => {
  const seen = [];
  const worktrees = {
    inspect: async (handle) => {
      seen.push(handle);
      if (handle.worktreeRef === "worktree:gone") throw new Error("VES_GIT_WORKTREE_NOT_FOUND");
      return { changeDigest: LEFT, commitCountSinceBase: 0, changedPaths: [] };
    }
  };
  const marked = (worktreeRef) => ({ loadWorktreeRef: async () => worktreeRef });
  assert.equal((await inspectMarkedWorktree(marked("worktree:kept"), worktrees, "c".repeat(40))).changeDigest, LEFT);
  assert.equal(await inspectMarkedWorktree(marked("worktree:gone"), worktrees, "c".repeat(40)), undefined);
  assert.equal(await inspectMarkedWorktree(marked(undefined), worktrees, "c".repeat(40)), undefined);
  assert.deepEqual(seen, [
    { worktreeRef: "worktree:kept", baseCommit: "c".repeat(40) },
    { worktreeRef: "worktree:gone", baseCommit: "c".repeat(40) }
  ]);
});
