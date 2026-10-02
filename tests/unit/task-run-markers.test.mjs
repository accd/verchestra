// invariant: the five markers of a Run directory (grant, active, worktree,
// cancel, outcome) are sealed for a run whose plan record names the marker
// seal, and stay plain canonical JSON for a run planned before that. Which
// form a run uses is read from its sealed plan record and from nowhere else,
// so a plain marker planted in a sealed Run is refused instead of believed.
// The golden values are computed here from the declared V2 canonical contract
// and SHA-256, never with the module under test; the plain ones are the values
// the ADP-2 suite recorded from the sources before the Run record existed.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import {
  GRANT_ID,
  RUN_ID,
  WORKSPACE_ID,
  bytesDigest,
  canonicalDigestOf,
  cleanupRunRecordFixtures,
  filled,
  planRecord,
  sealedText,
  temporaryRoot
} from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);

const ACTOR = "human:local-operator";
const WORKTREE = `worktree:${"a".repeat(32)}:${"b".repeat(40)}`;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
// invariant: the digest a Run Capsule binds for the capability grant, as the
// ADP-2 suite recorded it at revision 0158e48. It must not move.
const GRANT_DIGEST = "sha256:383c2a3c9d35b931e88fb4bb3685249f2c355af52280fd9273d68344ff9d0473";
const OUTCOME = Object.freeze({ status: "FAILED", reason: "VES_EXECUTOR_CANCELLED" });
// why: a process ID no process has: the largest a safe integer allows.
const DEAD_PID = Number.MAX_SAFE_INTEGER;
const FORMS = Object.freeze({ legacy: {}, sealed: { markerSeal: 1 } });

async function opened(form) {
  const root = await temporaryRoot();
  const tasksRoot = join(root, "tasks");
  const directory = join(tasksRoot, RUN_ID);
  const fresh = () => openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID);
  const runRecord = fresh();
  if (form !== undefined) await runRecord.savePlan(planRecord(FORMS[form]));
  return {
    root,
    runRecord,
    fresh,
    text: (name) => readFile(join(directory, name), "utf8"),
    plant: async (name, content) => {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, name), content);
    }
  };
}

function refused(reason) {
  return (error) => {
    assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
    assert.equal(error.envelope.safeDetails.reason, reason);
    return true;
  };
}

function runActive(error) {
  assert.equal(error.envelope.code, "VES_TASK_RUN_ACTIVE");
  return true;
}

// why: an edit that keeps the seal envelope and the record's shape, so only
// the digest can tell.
function edited(text, change) {
  const stored = JSON.parse(text);
  return JSON.stringify({ digest: stored.digest, record: { ...stored.record, ...change } });
}

test("a legacy Run writes its grant and worktree markers as the plain goldens", async () => {
  const run = await opened("legacy");
  await run.runRecord.saveGrant(GRANT_ID);
  const grant = await run.text("grant.json");
  assert.equal(grant, '{"grantId":"grant_018f0b6d-7b1a-7abc-8def-112345678904"}\n');
  assert.equal(bytesDigest(grant), "sha256:ec76ee9de58f3e5add449993c48457067beda2719ef5af3f9a041e8a389ec820");
  assert.equal(canonicalDigestOf(await run.runRecord.loadGrant()), GRANT_DIGEST);

  await run.runRecord.saveWorktreeRef(WORKTREE);
  const worktree = await run.text("worktree.json");
  assert.equal(worktree, `{"worktreeRef":"${WORKTREE}"}\n`);
  assert.equal(bytesDigest(worktree), "sha256:87ebbe4beb88197df7195ffc545f46bafb6ac0cfbffc7d19e21524988b1d0ffc");
  assert.equal(await run.runRecord.loadWorktreeRef(), WORKTREE);
});

test("a sealed Run writes its grant and worktree markers as the sealed goldens", async () => {
  const run = await opened("sealed");
  await run.runRecord.saveGrant(GRANT_ID);
  const grant = await run.text("grant.json");
  assert.equal(
    grant,
    `{"digest":"${GRANT_DIGEST}","record":{"grantId":"grant_018f0b6d-7b1a-7abc-8def-112345678904"}}\n`
  );
  assert.equal(bytesDigest(grant), "sha256:43aa632660a91bef1ac7016aab16b06158333ea537876f3a8dd1b61b2d51b9a8");
  assert.equal(grant, sealedText({ grantId: GRANT_ID }), "the seal is the canonical digest of the canonical record");

  await run.runRecord.saveWorktreeRef(WORKTREE);
  const worktree = await run.text("worktree.json");
  assert.equal(
    worktree,
    '{"digest":"sha256:b38146a55a479b6a225fdc06eb51b84185e06500e00b8aa9cc014295c34dee40",' +
      `"record":{"worktreeRef":"${WORKTREE}"}}\n`
  );
  assert.equal(bytesDigest(worktree), "sha256:e8c8dc745e0c061ce50d7f4a7ae4e1b9ad185ea083c437229b81605e01845dc3");
  assert.equal(await run.runRecord.loadWorktreeRef(), WORKTREE);
});

// invariant: the Run Capsule digests the grant record a reader returns. In
// the sealed form that is the record inside the envelope, so the digest the
// capsule binds is the ADP-2 golden in both forms, and in the sealed form it
// is also the seal written in the file.
test("the digest a Run Capsule binds for the grant is the recorded golden in both forms", async () => {
  for (const form of Object.keys(FORMS)) {
    const run = await opened(form);
    await run.runRecord.saveGrant(GRANT_ID);
    const marker = await run.runRecord.loadGrant();
    assert.deepEqual(marker, { grantId: GRANT_ID }, form);
    assert.equal(canonicalDigestOf(marker), GRANT_DIGEST, form);
  }
  const sealed = await opened("sealed");
  await sealed.runRecord.saveGrant(GRANT_ID);
  assert.equal(JSON.parse(await sealed.text("grant.json")).digest, GRANT_DIGEST);
});

test("a sealed Run seals its active, cancel, and outcome markers over the members a legacy Run writes plain", async () => {
  const records = {};
  for (const form of Object.keys(FORMS)) {
    const run = await opened(form);
    await run.runRecord.claimActive(process.pid);
    await run.runRecord.requestCancel(ACTOR);
    await run.runRecord.saveOutcome(OUTCOME);
    records[form] = {};
    for (const name of ["active.json", "cancel.json", "outcome.json"]) {
      const text = await run.text(name);
      const stored = JSON.parse(text);
      if (form === "sealed") {
        assert.deepEqual(Object.keys(stored), ["digest", "record"], name);
        assert.equal(text, sealedText(stored.record), `${name} is not the seal of its record`);
      }
      records[form][name] = form === "sealed" ? stored.record : stored;
    }
    assert.equal(await run.runRecord.activeProcess(), process.pid, form);
    assert.equal(await run.runRecord.cancelRequested(), true, form);
    assert.equal((await run.runRecord.loadOutcome()).status, "FAILED", form);
  }
  for (const form of Object.keys(FORMS)) {
    assert.deepEqual(Object.keys(records[form]["active.json"]), ["pid", "startedAt"], form);
    assert.equal(records[form]["active.json"].pid, process.pid);
    assert.match(records[form]["active.json"].startedAt, ISO_INSTANT);
    assert.deepEqual(Object.keys(records[form]["cancel.json"]), ["actorId", "requestedAt"], form);
    assert.equal(records[form]["cancel.json"].actorId, ACTOR);
    assert.match(records[form]["cancel.json"].requestedAt, ISO_INSTANT);
    assert.deepEqual(Object.keys(records[form]["outcome.json"]), ["at", "reason", "status"], form);
    assert.match(records[form]["outcome.json"].at, ISO_INSTANT);
  }
});

test("the plan record names the marker seal, and a plan record without it keeps its recorded bytes", async () => {
  const legacy = await opened("legacy");
  assert.equal(
    bytesDigest(await legacy.text("plan.json")),
    "sha256:e6c97cd79c6eb7a6ea93d954e9c098cc8205a4cece0318615b51b7eabed0272f"
  );
  assert.equal(Object.hasOwn(await legacy.fresh().loadPlan(), "markerSeal"), false);

  const sealed = await opened("sealed");
  assert.equal(
    bytesDigest(await sealed.text("plan.json")),
    "sha256:34b00af73d3bee7a2af215e28c668fcaf3fdf75981b9364f16c8676797137eca"
  );
  assert.equal((await sealed.fresh().loadPlan()).markerSeal, 1);
});

test("a plan record that names a marker seal this build does not know is refused, and so is every marker", async () => {
  for (const markerSeal of [2, 0, "1", true, null, [1]]) {
    const run = await opened();
    await run.plant("plan.json", sealedText({ ...planRecord(), markerSeal }));
    await run.plant("grant.json", `{"grantId":"${GRANT_ID}"}\n`);
    const label = JSON.stringify(markerSeal);
    await assert.rejects(run.runRecord.loadPlan(), refused("VES_TASK_STATE_MALFORMED"), label);
    await assert.rejects(run.fresh().loadGrant(), refused("VES_TASK_STATE_MALFORMED"), label);
    await assert.rejects(run.fresh().saveGrant(GRANT_ID), refused("VES_TASK_STATE_MALFORMED"), label);
    await assert.rejects(run.fresh().activeProcess(), refused("VES_TASK_STATE_MALFORMED"), label);
  }
});

// invariant: the form comes from the plan record on disk, also for a Run
// record that never loaded the plan itself.
test("a Run record learns the form from the stored plan record, without being told", async () => {
  const sealed = await opened("sealed");
  const writer = sealed.fresh();
  await writer.saveGrant(GRANT_ID);
  assert.equal(await sealed.text("grant.json"), sealedText({ grantId: GRANT_ID }));
  assert.deepEqual(await sealed.fresh().loadGrant(), { grantId: GRANT_ID });

  const legacy = await opened("legacy");
  await legacy.fresh().saveGrant(GRANT_ID);
  assert.equal(await legacy.text("grant.json"), `{"grantId":"${GRANT_ID}"}\n`);
});

const READ_MARKERS = Object.freeze([
  {
    name: "grant",
    file: "grant.json",
    write: (record) => record.saveGrant(GRANT_ID),
    read: (record) => record.loadGrant(),
    plain: { grantId: GRANT_ID },
    change: { grantId: "grant_018f0b6d-7b1a-7abc-8def-999999999999" },
    invalid: { grantId: 7 }
  },
  {
    name: "worktree",
    file: "worktree.json",
    write: (record) => record.saveWorktreeRef(WORKTREE),
    read: (record) => record.loadWorktreeRef(),
    plain: { worktreeRef: WORKTREE },
    change: { worktreeRef: `worktree:${"c".repeat(32)}:${"b".repeat(40)}` },
    invalid: { worktreeRef: null }
  },
  {
    name: "outcome",
    file: "outcome.json",
    write: (record) => record.saveOutcome(OUTCOME),
    read: (record) => record.loadOutcome(),
    plain: { ...OUTCOME, at: "2026-07-15T15:00:00.000Z" },
    change: { status: "HUMAN_REVIEW" },
    invalid: { status: "" }
  }
]);

for (const marker of READ_MARKERS) {
  test(`a sealed Run refuses a ${marker.name} marker that was edited`, async () => {
    const run = await opened("sealed");
    await marker.write(run.runRecord);
    const sealed = await run.text(marker.file);
    await run.plant(marker.file, edited(sealed, marker.change));
    await assert.rejects(marker.read(run.runRecord), refused("VES_TASK_STATE_TAMPERED"));
    await assert.rejects(marker.read(run.fresh()), refused("VES_TASK_STATE_TAMPERED"));
    await run.plant(marker.file, JSON.stringify({ ...JSON.parse(sealed), digest: filled("0") }));
    await assert.rejects(marker.read(run.runRecord), refused("VES_TASK_STATE_TAMPERED"), "a replaced digest");
    await run.plant(marker.file, sealed);
    await assert.doesNotReject(marker.read(run.runRecord), "the marker as it was written");
  });

  // invariant: no downgrade. The plain marker is the exact file a legacy Run
  // would hold, and a legacy Run reads it; a sealed Run must not.
  test(`a sealed Run refuses a plain ${marker.name} marker, which a legacy Run reads`, async () => {
    const plain = `${JSON.stringify(marker.plain)}\n`;
    const sealed = await opened("sealed");
    await marker.write(sealed.runRecord);
    await sealed.plant(marker.file, plain);
    await assert.rejects(marker.read(sealed.runRecord), refused("VES_TASK_STATE_MALFORMED"));
    await assert.rejects(marker.read(sealed.fresh()), refused("VES_TASK_STATE_MALFORMED"));

    const legacy = await opened("legacy");
    await legacy.plant(marker.file, plain);
    await assert.doesNotReject(marker.read(legacy.runRecord));
    await assert.doesNotReject(marker.read(legacy.fresh()));
  });

  test(`a sealed ${marker.name} marker whose record lacks the member its reader needs is malformed`, async () => {
    const run = await opened("sealed");
    await run.plant(marker.file, sealedText({ ...marker.plain, ...marker.invalid }));
    await assert.rejects(marker.read(run.runRecord), refused("VES_TASK_STATE_MALFORMED"));
  });
}

// invariant: an active marker of a sealed Run that is there and does not
// verify is neither "nobody drives the run" nor an error. It counts as a
// driver nobody can name, so a second driver is refused, and `cancel` (which
// gets the same answer) can still end the run.
test("a sealed Run's active marker that was edited counts as a driver and refuses a second one", async () => {
  const run = await opened("sealed");
  await run.runRecord.claimActive(process.pid);
  const sealed = await run.text("active.json");
  // why: the edit names a process that does not exist. Believed, it would
  // read as "nobody drives the run" while the real driver is alive.
  await run.plant("active.json", edited(sealed, { pid: DEAD_PID }));
  assert.equal(await run.runRecord.activeProcess(), "unverified");
  assert.equal(await run.fresh().activeProcess(), "unverified");
  await assert.rejects(run.runRecord.claimActive(process.pid), runActive);
  assert.equal(
    await run.text("active.json"),
    edited(sealed, { pid: DEAD_PID }),
    "a refused claim left the marker alone"
  );

  await run.runRecord.releaseActive();
  assert.equal(await run.runRecord.activeProcess(), undefined);
  await run.runRecord.claimActive(process.pid);
  assert.equal(await run.runRecord.activeProcess(), process.pid);
});

test("a sealed Run does not believe a plain active marker, whatever process it names", async () => {
  for (const pid of [DEAD_PID, process.pid]) {
    const run = await opened("sealed");
    await run.plant("active.json", `${JSON.stringify({ pid, startedAt: "2026-07-15T15:00:00.000Z" })}\n`);
    assert.equal(await run.runRecord.activeProcess(), "unverified", String(pid));
    await assert.rejects(run.runRecord.claimActive(process.pid), runActive);
  }
  const legacy = await opened("legacy");
  await legacy.plant("active.json", `${JSON.stringify({ pid: DEAD_PID, startedAt: "2026-07-15T15:00:00.000Z" })}\n`);
  assert.equal(await legacy.runRecord.activeProcess(), undefined, "a legacy Run reads a plain marker as before");
  await legacy.plant("active.json", `${JSON.stringify({ pid: process.pid })}\n`);
  assert.equal(await legacy.runRecord.activeProcess(), process.pid);
});

test("a sealed Run's active marker that cannot be read, or seals no process ID, counts as a driver", async () => {
  const contents = ["{not json", "[]", "null", "{}", sealedText({ pid: 0 }), sealedText({ pid: "7" }), sealedText({})];
  for (const content of contents) {
    const run = await opened("sealed");
    await run.plant("active.json", content);
    assert.equal(await run.runRecord.activeProcess(), "unverified", content);
  }
  const blocked = await opened("sealed");
  await mkdir(join(blocked.root, "tasks", RUN_ID, "active.json"));
  assert.equal(await blocked.runRecord.activeProcess(), "unverified", "a directory in the marker's place");

  const stale = await opened("sealed");
  await stale.plant("active.json", sealedText({ pid: DEAD_PID, startedAt: "2026-07-15T15:00:00.000Z" }));
  assert.equal(await stale.runRecord.activeProcess(), undefined, "a marker that verifies and names a dead process");
  assert.equal(await (await opened("sealed")).runRecord.activeProcess(), undefined, "no marker");
});

// invariant: a cancel marker can only say "stop", so one that would not
// verify still stops the run, in both forms.
test("a cancel marker that was edited, or replaced by a plain one, is still a request to stop", async () => {
  const run = await opened("sealed");
  assert.equal(await run.runRecord.cancelRequested(), false);
  await run.runRecord.requestCancel(ACTOR);
  const sealed = await run.text("cancel.json");
  for (const content of [
    edited(sealed, { actorId: "someone:else" }),
    `${JSON.stringify({ actorId: ACTOR, requestedAt: "2026-07-15T15:00:00.000Z" })}\n`,
    "{not json",
    ""
  ]) {
    await run.plant("cancel.json", content);
    assert.equal(await run.runRecord.cancelRequested(), true, content);
    await run.runRecord.requestCancel(ACTOR);
    assert.equal(await run.text("cancel.json"), content, "a request that is already there stands");
  }
  await run.runRecord.claimActive(process.pid);
  assert.equal(await run.runRecord.cancelRequested(), false, "claiming the run clears the request");
  assert.deepEqual(
    (await readdir(join(run.root, "tasks", RUN_ID))).sort((left, right) => Number(left > right) - Number(left < right)),
    ["active.json", "plan.json"]
  );
});
