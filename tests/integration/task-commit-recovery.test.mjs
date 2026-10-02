// invariant: a run that crashed after its task commit but before recording it
// is finished from durable facts on resume: the committed gate checkpoint, the
// commit's own trailers, and the recorded gate evidence. These cases run that
// recovery on real git in the SHA-1 and SHA-256 object formats, on every
// platform.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TaskEvidenceStore } from "../../apps/vestra-cli/src/task/task-evidence.ts";
import { canonicalDigest } from "../../apps/vestra-cli/src/task/task-files.ts";
import { recoverCommittedTask } from "../../apps/vestra-cli/src/task/task-run.ts";
import { loadCommit, saveCommit } from "../../apps/vestra-cli/src/task/task-surface.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  commitFixtureTask,
  git,
  registeredWorktreeCount,
  taskBranches,
  taskWorktreeFixture
} from "../helpers/git-object-format-fixture.mjs";

const links = [];
const GATE_ID = "gate:value";
const TASK_BRANCH = "refs/heads/vestra/run_c1/T1";

afterEach(async () => {
  await cleanupObjectFormatRepositories();
  await Promise.all(links.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// why: the fixture stops where a crash would: the gate passed and its evidence
// is recorded, the task commit exists in the worktree, the gate checkpoint
// says `committed`, and nothing after that happened.
async function crashedAfterCommit(format, options = {}) {
  const fixture = await taskWorktreeFixture(format, options);
  const directory = join(fixture.root, "state", "tasks", "run_c1");
  await mkdir(directory, { recursive: true });
  const evidence = new TaskEvidenceStore(directory);
  const changeDigest = (await fixture.worktrees.inspect(fixture.handle)).changeDigest;
  const released = [];
  const recovery = (gate) => ({
    repositoryRoot: fixture.repositoryRoot,
    directory,
    worktrees: fixture.worktrees,
    evidence,
    gateIds: [GATE_ID],
    inspectGate: () => gate,
    release: async () => void released.push("released")
  });
  return { ...fixture, directory, evidence, changeDigest, released, recovery };
}

async function commitWithEvidence(crash) {
  await writeFile(join(crash.worktreePath, "src", "value.txt"), "implemented\n");
  const changeDigest = (await crash.worktrees.inspect(crash.handle)).changeDigest;
  crash.evidence.judging(changeDigest);
  const { evidenceRef, evidenceDigest } = await crash.evidence.record({
    gateId: GATE_ID,
    verdict: "PASS",
    exitCode: 0
  });
  const gateEvidenceDigest = canonicalDigest({ evidenceDigests: [evidenceDigest], evidenceRefs: [evidenceRef] });
  const { commitId } = await commitFixtureTask(crash, { gateEvidenceDigest });
  const gate = { stage: "committed", record: { commitId, changeDigest } };
  return { commitId, gate, gateEvidenceDigest, evidenceRef };
}

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`a resumed ${objectFormat} run records its commit, anchors it, and removes the worktree`, async () => {
    const crash = await crashedAfterCommit(format);
    const { commitId, gate, gateEvidenceDigest, evidenceRef } = await commitWithEvidence(crash);
    assert.equal(commitId.length, format.objectIdLength);
    assert.equal(taskBranches(crash.repositoryRoot), "", "the crash left the commit unanchored");

    const commit = await recoverCommittedTask(crash.recovery(gate));
    assert.deepEqual(commit, {
      commitId,
      baseCommit: crash.baseCommit,
      gateEvidenceDigest,
      gateEvidenceRefs: [evidenceRef]
    });
    assert.deepEqual(await loadCommit(crash.directory), commit);
    assert.equal(taskBranches(crash.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    assert.equal(registeredWorktreeCount(crash.repositoryRoot), 1);
    await assert.rejects(access(crash.worktreePath), { code: "ENOENT" });
    assert.deepEqual(crash.released, ["released"]);
  });

  test(`a ${objectFormat} run that crashed after cleanup still records its commit`, async () => {
    const crash = await crashedAfterCommit(format);
    const { commitId, gate } = await commitWithEvidence(crash);
    await crash.worktrees.cleanup(crash.handle);
    assert.equal(taskBranches(crash.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    const commit = await recoverCommittedTask(crash.recovery(gate));
    assert.equal(commit.commitId, commitId);
    assert.equal(commit.baseCommit, crash.baseCommit);
    assert.equal(taskBranches(crash.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
  });

  // why: the state root is commonly reached through a link. Recovery used to
  // compare the linked path with the real one Git lists, found no worktree,
  // recorded the commit, and left it unanchored with its worktree in place.
  test(`a resumed ${objectFormat} run anchors its commit through a linked state root`, async () => {
    const linkParent = await mkdtemp(join(tmpdir(), "verchestra-task-link-"));
    links.push(linkParent);
    const crash = await crashedAfterCommit(format, {
      worktreesRoot: async (repository) => {
        await mkdir(join(repository.root, "real-state"), { recursive: true });
        await symlink(join(repository.root, "real-state"), join(linkParent, "state"), "junction");
        return join(linkParent, "state", "worktrees");
      }
    });
    const { commitId, gate } = await commitWithEvidence(crash);
    await recoverCommittedTask(crash.recovery(gate));
    assert.equal(taskBranches(crash.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    assert.equal(registeredWorktreeCount(crash.repositoryRoot), 1);
  });

  test(`a ${objectFormat} commit record that already exists is returned without touching git`, async () => {
    const crash = await crashedAfterCommit(format);
    const { gate } = await commitWithEvidence(crash);
    const first = await recoverCommittedTask(crash.recovery(gate));
    const second = await recoverCommittedTask({
      ...crash.recovery(undefined),
      repositoryRoot: join(crash.root, "absent"),
      inspectGate: () => assert.fail("a recorded commit needs no checkpoint")
    });
    assert.deepEqual(second, first);
    assert.deepEqual(crash.released, ["released"]);
  });

  test(`a ${objectFormat} run whose gate never committed has nothing to recover`, async () => {
    const crash = await crashedAfterCommit(format);
    assert.equal(await recoverCommittedTask(crash.recovery(undefined)), undefined);
    assert.equal(await recoverCommittedTask(crash.recovery({ stage: "gates-passed", record: {} })), undefined);
    assert.equal(await loadCommit(crash.directory), undefined);
    assert.equal(registeredWorktreeCount(crash.repositoryRoot), 2);
    assert.deepEqual(crash.released, []);
  });

  test(`${objectFormat} gate evidence recorded for another change is refused`, async () => {
    const crash = await crashedAfterCommit(format);
    const { gate } = await commitWithEvidence(crash);
    const tampered = { ...gate, record: { ...gate.record, changeDigest: `sha256:${"0".repeat(64)}` } };
    await assert.rejects(recoverCommittedTask(crash.recovery(tampered)), (error) => {
      assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
      assert.equal(error.envelope.safeDetails.reason, "VES_TASK_EVIDENCE_MISSING");
      return true;
    });
    assert.equal(await loadCommit(crash.directory), undefined);
  });

  test(`a ${objectFormat} commit without a gate evidence trailer is refused`, async () => {
    const crash = await crashedAfterCommit(format);
    git(crash.repositoryRoot, "commit", "--quiet", "--allow-empty", "-m", "no trailers");
    const commitId = git(crash.repositoryRoot, "rev-parse", "HEAD");
    const gate = { stage: "committed", record: { commitId, changeDigest: crash.changeDigest } };
    await assert.rejects(recoverCommittedTask(crash.recovery(gate)), (error) => {
      assert.equal(error.envelope.safeDetails.reason, "VES_TASK_EVIDENCE_MISSING");
      return true;
    });
    assert.equal(await loadCommit(crash.directory), undefined);
  });
}

test("a commit record whose IDs are not complete object IDs is refused as malformed", async () => {
  const crash = await crashedAfterCommit(OBJECT_FORMATS[1]);
  const record = {
    commitId: "c".repeat(64),
    baseCommit: crash.baseCommit,
    gateEvidenceDigest: `sha256:${"5".repeat(64)}`,
    gateEvidenceRefs: []
  };
  await saveCommit(crash.directory, record);
  assert.deepEqual(await loadCommit(crash.directory), record);
  for (const invalid of [
    { commitId: "c".repeat(63) },
    { commitId: "c".repeat(41) },
    { baseCommit: crash.baseCommit.slice(-40).slice(1) }
  ]) {
    await saveCommit(crash.directory, { ...record, ...invalid });
    await assert.rejects(loadCommit(crash.directory), (error) => {
      assert.equal(error.envelope.safeDetails.reason, "VES_TASK_STATE_MALFORMED");
      return true;
    });
  }
});
