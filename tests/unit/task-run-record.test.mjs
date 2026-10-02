// invariant: the Run record module (ADP-2) is the one owner of a Run's durable
// record under `<workspace>/tasks/<runId>/`: where each artifact lives, whether
// it is sealed, and what a reader may trust about it. These cases drive the
// module's interface in a temporary directory. The golden values were recorded
// from the task sources as they stood before the module existed (revision
// 0158e48), so a moved byte, path, or digest fails here.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";
import { capsuleHarness, capsuleInput } from "../helpers/run-capsule-fixture.mjs";
import {
  GRANT_ID,
  OTHER_RUN_ID,
  OTHER_WORKSPACE_ID,
  RUN_ID,
  TASK_ID,
  WORKSPACE_ID,
  bytesDigest,
  canonicalDigestOf,
  cleanupRunRecordFixtures,
  contextManifest,
  filled,
  planRecord,
  sealedText,
  taskCommit,
  temporaryRoot,
  verificationReport
} from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);

const POSIX = process.platform !== "win32";
const GATE_FAILURE = Object.freeze({ failedGateId: "gate:unit", evidenceRef: `gate-evidence:${"e".repeat(32)}` });
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

async function opened(runId = RUN_ID, workspaceId = WORKSPACE_ID) {
  const root = await temporaryRoot();
  const tasksRoot = join(root, "tasks");
  const directory = join(tasksRoot, runId);
  return {
    root,
    tasksRoot,
    runRecord: openRunRecord({ workspaceId, tasksRoot }, runId),
    file: (...segments) => join(directory, ...segments),
    text: (...segments) => readFile(join(directory, ...segments), "utf8"),
    plant: async (segments, content) => {
      await mkdir(join(directory, ...segments.slice(0, -1)), { recursive: true });
      await writeFile(join(directory, ...segments), content);
    }
  };
}

async function listing(directory, prefix = "") {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) names.push(...(await listing(join(directory, entry.name), `${prefix}${entry.name}/`)));
    else names.push(`${prefix}${entry.name}`);
  }
  return names.sort((left, right) => Number(left > right) - Number(left < right));
}

function refused(reason) {
  return (error) => {
    assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
    assert.equal(error.envelope.safeDetails.reason, reason);
    return true;
  };
}

function publicCode(code) {
  return (error) => {
    assert.equal(error.envelope.code, code);
    return true;
  };
}

test("the seal format is byte-identical to the recorded golden", async () => {
  const run = await opened();
  await run.runRecord.saveCommit(taskCommit());
  const text = await run.text("commit.json");
  assert.equal(
    text,
    '{"digest":"sha256:4d4f994f7dc8ab043a4dc7b8767d9a3324bcaee79a8cf4f4e1773f0eac41b0e1",' +
      '"record":{"baseCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",' +
      '"commitId":"cccccccccccccccccccccccccccccccccccccccc",' +
      '"gateEvidenceDigest":"sha256:5555555555555555555555555555555555555555555555555555555555555555",' +
      '"gateEvidenceRefs":["gate-evidence:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]}}\n'
  );
  assert.equal(bytesDigest(text), "sha256:32e4a622c4989372a0d3852710d5bb8fa5b6bb834ac851f810dbfb9697ca90a2");
  assert.equal(text, sealedText(taskCommit()), "the seal is the canonical digest of the canonical record");
  assert.deepEqual(await run.runRecord.loadCommit(), taskCommit());
});

test("the grant marker and the digest a Run Capsule binds are the recorded goldens", async () => {
  const run = await opened();
  assert.equal(await run.runRecord.loadGrant(), undefined);
  await run.runRecord.saveGrant(GRANT_ID);
  const text = await run.text("grant.json");
  assert.equal(text, '{"grantId":"grant_018f0b6d-7b1a-7abc-8def-112345678904"}\n');
  assert.equal(bytesDigest(text), "sha256:ec76ee9de58f3e5add449993c48457067beda2719ef5af3f9a041e8a389ec820");
  const marker = await run.runRecord.loadGrant();
  assert.deepEqual(marker, { grantId: GRANT_ID });
  assert.equal(canonicalDigestOf(marker), "sha256:383c2a3c9d35b931e88fb4bb3685249f2c355af52280fd9273d68344ff9d0473");
});

test("attempt records and the digests that chain them are the recorded goldens", async () => {
  const run = await opened();
  const failed = await run.runRecord.sealAttempt(TASK_ID, {
    attempt: 1,
    passed: false,
    failure: GATE_FAILURE,
    feedbackWithheld: false,
    previousAttemptDigest: null
  });
  assert.equal(failed.capsuleDigest, "sha256:f88c73d0076a29199536b86c5f6c9bbc55b9bb64ac3c2bc456368b8c548fb27a");
  const passed = await run.runRecord.sealAttempt(TASK_ID, {
    attempt: 2,
    passed: true,
    failure: undefined,
    feedbackWithheld: true,
    previousAttemptDigest: failed.capsuleDigest
  });
  assert.equal(passed.capsuleDigest, "sha256:0c78c773ad3917d8aee24113b39706338fb8d962439aa071e5a5e5a97efe90a8");
  assert.equal(
    bytesDigest(await run.text("attempts", "1.json")),
    "sha256:2d524ebc9ca3638f970f465e09456684a3dbc7a99fc190e5c6b4389a5cf3cd78"
  );
  const second = await run.text("attempts", "2.json");
  assert.equal(bytesDigest(second), "sha256:091a70f80c39430be5c0b09aec0c31b3b95a4b0221049ee9965e593b22747340");
  const stored = JSON.parse(second);
  assert.equal(stored.digest, passed.capsuleDigest, "the digest returned is the seal of the file");
  assert.equal(Object.hasOwn(stored.record, "failure"), false, "an undefined member is absent, not null");
  assert.deepEqual(stored.record, {
    attempt: 2,
    feedbackWithheld: true,
    passed: true,
    previousAttemptDigest: failed.capsuleDigest,
    runId: RUN_ID,
    taskId: TASK_ID
  });
});

test("the context manifest file and its recomputed identity are the recorded goldens", async () => {
  const run = await opened();
  const manifest = contextManifest();
  assert.equal(manifest.manifestId, "sha256:08335bec710ab2717193347a6f8e8d3d8d0d4fd4ddefacc29c78a727001e5440");
  await run.runRecord.saveContextManifest(manifest);
  assert.equal(
    bytesDigest(await run.text("context-manifest.json")),
    "sha256:cb0c9f053143e87fd965c2b80de51752600117a7ac830e22fbd941d4ba4d7c1e"
  );
  assert.deepEqual(await run.runRecord.loadContextManifest(manifest.manifestId), manifest);
});

test("the plan record and the verification report keep their recorded bytes", async () => {
  const run = await opened();
  await run.runRecord.savePlan(planRecord());
  assert.equal(
    bytesDigest(await run.text("plan.json")),
    "sha256:e6c97cd79c6eb7a6ea93d954e9c098cc8205a4cece0318615b51b7eabed0272f"
  );
  assert.deepEqual(await run.runRecord.loadPlan(), planRecord());
  const reportDigest = await run.runRecord.saveReport(verificationReport());
  assert.equal(reportDigest, canonicalDigestOf(verificationReport()));
  assert.equal(
    bytesDigest(await run.text("verification", "report.json")),
    "sha256:cdc6377659a29525be18efe07052683d4c150e774555a21cfa41c98276b3a808"
  );
  assert.deepEqual(await run.runRecord.loadReport(), verificationReport());
});

// invariant: the layout a Run in flight was written with. Each name below is
// where the task sources wrote that artifact before the module existed.
test("every artifact is written at its recorded path, private to the user", async () => {
  const run = await opened();
  const { runRecord } = run;
  const pkg = await executionHarness().builder.build(packageInput());
  const capsule = await capsuleHarness().builder.build(capsuleInput());
  const lesson = { lessonId: "lesson:1", text: "fixture lesson" };
  await runRecord.savePackage(pkg);
  await runRecord.saveContextManifest(contextManifest());
  await runRecord.savePlan(planRecord());
  await runRecord.saveGrant(GRANT_ID);
  await runRecord.claimActive(process.pid);
  await runRecord.saveWorktreeRef(`worktree:${"a".repeat(32)}:${"b".repeat(40)}`);
  runRecord.gateEvidence.judging(filled("9"));
  const evidence = await runRecord.gateEvidence.record({ gateId: "gate:unit", verdict: "PASS", exitCode: 0 });
  await runRecord.sealAttempt(TASK_ID, { attempt: 1, passed: true, failure: undefined });
  await runRecord.saveCommit(taskCommit());
  await runRecord.saveReport(verificationReport());
  const lessonDigest = await runRecord.saveLesson(lesson);
  await runRecord.saveReview({ reviewer: "human:local-operator", outcome: "accepted" });
  await runRecord.saveCapsule(capsule);
  await runRecord.saveOutcome({ status: "FAILED", reason: "VES_EXECUTOR_CANCELLED" });
  await runRecord.requestCancel("human:local-operator");

  assert.equal(evidence.evidenceRef, "gate-evidence:32ad61a73cee76378c6771006a52cef8");
  assert.equal(lessonDigest, "sha256:308b5eaba944593fe73c55aeaf5147db10234c0c5414b3a23d8cb91a48ed88d8");
  assert.deepEqual(await listing(run.file()), [
    "active.json",
    "attempts/1.json",
    "cancel.json",
    `capsules/${capsule.artifactId}.json`,
    "commit.json",
    "context-manifest.json",
    "gate-evidence/32ad61a73cee76378c6771006a52cef8.json",
    "grant.json",
    "outcome.json",
    `packages/${pkg.artifactId}.json`,
    "plan.json",
    "review.json",
    "verification/lessons/308b5eaba944593fe73c55aeaf5147db.json",
    "verification/report.json",
    "worktree.json"
  ]);
  assert.equal(
    await run.text("gate-evidence", "32ad61a73cee76378c6771006a52cef8.json"),
    '{"digest":"sha256:a9c0fa96547a23a9f630a01a37dd4232958749b6a4ec799115414cdff7722e27",' +
      '"record":{"changeDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999",' +
      '"entry":{"exitCode":0,"gateId":"gate:unit","verdict":"PASS"},"sequence":1}}\n'
  );
  assert.equal(
    await run.text("review.json"),
    '{"digest":"sha256:9180ed020a6dc090a72bdf41066117f6c3b1e8846961881b05747bcb8de2cb3a",' +
      '"record":{"outcome":"accepted","reviewer":"human:local-operator"}}\n'
  );
  assert.equal(
    await run.text("worktree.json"),
    '{"worktreeRef":"worktree:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n'
  );
  assert.equal((await run.runRecord.loadPackage(pkg.artifactId)).payloadDigest, pkg.payloadDigest);
  if (!POSIX) return;
  for (const name of [
    "",
    "attempts",
    "verification",
    "verification/lessons",
    "gate-evidence",
    "plan.json",
    "grant.json"
  ])
    assert.equal(
      (await stat(run.file(...name.split("/")))).mode & 0o077,
      0,
      `${name || "the Run directory"} is private`
    );
});

test("the plain markers hold exactly the members a run writes", async () => {
  const run = await opened();
  await run.runRecord.claimActive(process.pid);
  const active = JSON.parse(await run.text("active.json"));
  assert.deepEqual(Object.keys(active), ["pid", "startedAt"]);
  assert.equal(active.pid, process.pid);
  assert.match(active.startedAt, ISO_INSTANT);

  await run.runRecord.requestCancel("human:local-operator");
  const cancel = JSON.parse(await run.text("cancel.json"));
  assert.deepEqual(Object.keys(cancel), ["actorId", "requestedAt"]);
  assert.equal(cancel.actorId, "human:local-operator");
  assert.match(cancel.requestedAt, ISO_INSTANT);

  await run.runRecord.saveOutcome({ status: "ESCALATED", failure: GATE_FAILURE });
  const outcome = await run.runRecord.loadOutcome();
  assert.deepEqual(Object.keys(JSON.parse(await run.text("outcome.json"))), ["at", "failure", "status"]);
  assert.equal(outcome.status, "ESCALATED");
  assert.deepEqual(outcome.failure, GATE_FAILURE);
  assert.match(outcome.at, ISO_INSTANT);
});

test("opening a Run record and reading a run that was never planned creates nothing", async () => {
  const run = await opened();
  const { runRecord } = run;
  await assert.rejects(runRecord.loadPlan(), publicCode("VES_TASK_RUN_NOT_FOUND"));
  assert.equal(await runRecord.loadGrant(), undefined);
  assert.equal(await runRecord.activeProcess(), undefined);
  assert.equal(await runRecord.cancelRequested(), false);
  assert.equal(await runRecord.loadWorktreeRef(), undefined);
  assert.equal(await runRecord.loadOutcome(), undefined);
  assert.equal(await runRecord.loadCommit(), undefined);
  assert.equal(await runRecord.loadReport(), undefined);
  assert.equal(await runRecord.loadReview(), undefined);
  assert.equal(await runRecord.gateEvidence.load(`gate-evidence:${"e".repeat(32)}`), undefined);
  await assert.rejects(runRecord.loadContextManifest(filled("a")), refused("VES_TASK_CONTEXT_MISSING"));
  await assert.rejects(runRecord.verifiedCommit(), refused("VES_TASK_REVIEW_UNAVAILABLE"));
  await runRecord.releaseActive();
  assert.deepEqual(await readdir(run.root), [], "no tasks directory exists before the first write");

  await runRecord.saveGrant(GRANT_ID);
  assert.deepEqual(await listing(run.root), [`tasks/${RUN_ID}/grant.json`]);
});

test("a run ID that is not a stable run ID never names a directory", async () => {
  const root = await temporaryRoot();
  for (const runId of ["../escape", "run_c1", "task_018f0b6d-7b1a-7abc-8def-112345678902", "", `${RUN_ID}/..`])
    assert.throws(
      () => openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot: join(root, "tasks") }, runId),
      publicCode("VES_CLI_ARGUMENT_INVALID"),
      runId
    );
  assert.deepEqual(await readdir(root), []);
});

const READERS = Object.freeze([
  { name: "plan record", segments: ["plan.json"], sealed: true, read: (record) => record.loadPlan() },
  { name: "task commit record", segments: ["commit.json"], sealed: true, read: (record) => record.loadCommit() },
  {
    name: "verification report",
    segments: ["verification", "report.json"],
    sealed: true,
    read: (record) => record.loadReport()
  },
  { name: "review record", segments: ["review.json"], sealed: true, read: (record) => record.loadReview() },
  {
    name: "gate evidence",
    segments: ["gate-evidence", `${"e".repeat(32)}.json`],
    sealed: true,
    read: (record) => record.gateEvidence.load(`gate-evidence:${"e".repeat(32)}`)
  },
  { name: "grant marker", segments: ["grant.json"], sealed: false, read: (record) => record.loadGrant() },
  { name: "worktree marker", segments: ["worktree.json"], sealed: false, read: (record) => record.loadWorktreeRef() },
  { name: "run outcome", segments: ["outcome.json"], sealed: false, read: (record) => record.loadOutcome() },
  {
    name: "context manifest",
    segments: ["context-manifest.json"],
    sealed: false,
    read: (record) => record.loadContextManifest(contextManifest().manifestId)
  }
]);

for (const reader of READERS) {
  test(`a ${reader.name} that is not a bounded regular file is unreadable`, async (t) => {
    const directory = await opened();
    await mkdir(directory.file(...reader.segments), { recursive: true });
    await assert.rejects(reader.read(directory.runRecord), refused("VES_TASK_STATE_UNREADABLE"));

    const oversized = await opened();
    await oversized.plant(reader.segments, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
    await assert.rejects(reader.read(oversized.runRecord), refused("VES_TASK_STATE_UNREADABLE"));

    if (!POSIX) return t.diagnostic("links and a file in place of a directory are exercised on POSIX");
    const linked = await opened();
    await linked.plant(["elsewhere.json"], sealedText(taskCommit()));
    await mkdir(linked.file(...reader.segments.slice(0, -1)), { recursive: true });
    await symlink(linked.file("elsewhere.json"), linked.file(...reader.segments));
    await assert.rejects(reader.read(linked.runRecord), refused("VES_TASK_STATE_UNREADABLE"));

    const blocked = await opened();
    await mkdir(blocked.tasksRoot, { recursive: true });
    await writeFile(join(blocked.tasksRoot, RUN_ID), "a file where the Run directory belongs");
    await assert.rejects(reader.read(blocked.runRecord), refused("VES_TASK_STATE_UNREADABLE"));
  });

  test(`a ${reader.name} that is not JSON is malformed`, async () => {
    const run = await opened();
    await run.plant(reader.segments, "{not json");
    await assert.rejects(reader.read(run.runRecord), refused("VES_TASK_STATE_MALFORMED"));
  });
}

for (const reader of READERS.filter((entry) => entry.sealed)) {
  test(`a ${reader.name} outside the seal envelope is malformed`, async () => {
    for (const content of [
      "null",
      "[]",
      '"text"',
      "{}",
      '{"record":{}}',
      `{"digest":"${canonicalDigestOf({})}","record":{},"extra":1}`,
      `{"digest":"${canonicalDigestOf([1])}","record":[1]}`,
      `{"digest":"${canonicalDigestOf("text")}","record":"text"}`
    ]) {
      const run = await opened();
      await run.plant(reader.segments, content);
      await assert.rejects(reader.read(run.runRecord), refused("VES_TASK_STATE_MALFORMED"), content);
    }
  });

  test(`a ${reader.name} whose content no longer matches its seal is tampered`, async () => {
    const run = await opened();
    const sealed = JSON.parse(sealedText({ entry: { gateId: "gate:unit" }, value: "sealed" }));
    await run.plant(reader.segments, JSON.stringify({ ...sealed, record: { ...sealed.record, value: "edited" } }));
    await assert.rejects(reader.read(run.runRecord), refused("VES_TASK_STATE_TAMPERED"));
    await run.plant(reader.segments, JSON.stringify({ ...sealed, digest: filled("0") }));
    await assert.rejects(reader.read(run.runRecord), refused("VES_TASK_STATE_TAMPERED"));
  });
}

for (const reader of READERS.filter((entry) => !entry.sealed && entry.name !== "context manifest")) {
  test(`a ${reader.name} that is not an object is malformed`, async () => {
    for (const content of ["null", "[]", '"text"', "7"]) {
      const run = await opened();
      await run.plant(reader.segments, content);
      await assert.rejects(reader.read(run.runRecord), refused("VES_TASK_STATE_MALFORMED"), content);
    }
  });
}

test("a plan record of another run, Workspace, or schema version is a mismatch", async () => {
  for (const foreign of [{ runId: OTHER_RUN_ID }, { workspaceId: OTHER_WORKSPACE_ID }, { schemaVersion: 2 }]) {
    const run = await opened();
    await run.plant(["plan.json"], sealedText(planRecord(foreign)));
    await assert.rejects(run.runRecord.loadPlan(), refused("VES_TASK_STATE_MISMATCH"), JSON.stringify(foreign));
  }
  // why: a whole Run directory moved under another run's ID, or into another
  // Workspace's state, carries a valid seal and must still be refused.
  const source = await opened();
  await source.runRecord.savePlan(planRecord());
  const sealed = await source.text("plan.json");
  const moved = await opened(OTHER_RUN_ID);
  await moved.plant(["plan.json"], sealed);
  await assert.rejects(moved.runRecord.loadPlan(), refused("VES_TASK_STATE_MISMATCH"));
  const otherWorkspace = await opened(RUN_ID, OTHER_WORKSPACE_ID);
  await otherWorkspace.plant(["plan.json"], sealed);
  await assert.rejects(otherWorkspace.runRecord.loadPlan(), refused("VES_TASK_STATE_MISMATCH"));
});

test("a plan is never filed under another run or Workspace", async () => {
  const run = await opened();
  await assert.rejects(run.runRecord.savePlan(planRecord({ runId: OTHER_RUN_ID })), refused("VES_TASK_STATE_MISMATCH"));
  await assert.rejects(
    run.runRecord.savePlan(planRecord({ workspaceId: OTHER_WORKSPACE_ID })),
    refused("VES_TASK_STATE_MISMATCH")
  );
  assert.deepEqual(await readdir(run.root), [], "a refused plan writes nothing");
});

test("a sealed plan record is still validated field by field", async () => {
  const cases = [
    [{ packageDigest: "sha256:short" }, "VES_TASK_STATE_MALFORMED"],
    [{ gatePlanDigest: 7 }, "VES_TASK_STATE_MALFORMED"],
    [{ packageId: "" }, "VES_TASK_STATE_MALFORMED"],
    [{ createdAt: undefined }, "VES_TASK_STATE_MALFORMED"],
    [{ approvalIntent: "execution" }, "VES_TASK_STATE_MALFORMED"],
    [{ approvalRequest: { approvalId: "approval:1", bindingDigest: "not a digest" } }, "VES_TASK_STATE_MALFORMED"],
    [{ approvalRequest: { bindingDigest: filled("6") } }, "VES_TASK_STATE_MALFORMED"],
    [{ request: { ...planRecord().request, schemaVersion: 2 } }, "VES_TASK_STATE_MALFORMED"],
    [{ requestDigest: filled("0") }, "VES_TASK_STATE_TAMPERED"]
  ];
  for (const [override, reason] of cases) {
    const run = await opened();
    const stored = JSON.parse(JSON.stringify({ ...planRecord(), ...override }));
    await run.plant(["plan.json"], sealedText(stored));
    await assert.rejects(run.runRecord.loadPlan(), refused(reason), JSON.stringify(Object.keys(override)));
  }
});

test("a context manifest that is absent or holds no object is missing", async () => {
  const absent = await opened();
  await absent.runRecord.savePlan(planRecord());
  await assert.rejects(
    absent.runRecord.loadContextManifest(contextManifest().manifestId),
    refused("VES_TASK_CONTEXT_MISSING")
  );
  for (const content of ["null", '"text"', "7"]) {
    const run = await opened();
    await run.plant(["context-manifest.json"], content);
    await assert.rejects(
      run.runRecord.loadContextManifest(contextManifest().manifestId),
      refused("VES_TASK_CONTEXT_MISSING"),
      content
    );
  }
});

test("a context manifest that is not the one the approval bound is tampered", async () => {
  const manifest = contextManifest();
  const run = await opened();
  await run.runRecord.saveContextManifest(manifest);
  await assert.rejects(run.runRecord.loadContextManifest(filled("0")), refused("VES_TASK_CONTEXT_TAMPERED"));

  const edits = [
    { estimatedTokens: manifest.estimatedTokens + 1 },
    { fragments: [{ ...manifest.fragments[0], content: "Task T1: write everywhere." }] },
    { injected: true },
    { manifestId: filled("0") }
  ];
  for (const edit of edits) {
    const edited = await opened();
    await edited.runRecord.saveContextManifest({ ...manifest, ...edit });
    await assert.rejects(
      edited.runRecord.loadContextManifest(manifest.manifestId),
      refused("VES_TASK_CONTEXT_TAMPERED"),
      JSON.stringify(Object.keys(edit))
    );
  }
  const array = await opened();
  await array.plant(["context-manifest.json"], "[]");
  await assert.rejects(array.runRecord.loadContextManifest(manifest.manifestId), refused("VES_TASK_CONTEXT_TAMPERED"));

  // invariant: the identity covers the manifest without its key ID and
  // signature, which are verified against the Workspace trust anchor instead.
  const resigned = await opened();
  await resigned.runRecord.saveContextManifest({ ...manifest, keyId: "another-key", signature: "b3RoZXI" });
  assert.equal((await resigned.runRecord.loadContextManifest(manifest.manifestId)).keyId, "another-key");
});

test("the Execution Package the plan bound is returned, and any other is invalid", async () => {
  const { builder } = executionHarness();
  const pkg = await builder.build(packageInput());
  const other = await builder.build(packageInput({ featureId: "feature:another" }));
  const bound = { packageId: pkg.artifactId, packageDigest: `sha256:${pkg.payloadDigest}` };

  const missing = await opened();
  await missing.runRecord.savePlan(planRecord());
  await assert.rejects(missing.runRecord.approvedPackage(bound), refused("VES_TASK_PACKAGE_INVALID"));

  const run = await opened();
  await run.runRecord.savePackage(pkg);
  await run.runRecord.savePackage(other);
  const approved = await run.runRecord.approvedPackage(bound);
  assert.equal(approved.artifactId, pkg.artifactId);
  assert.equal(approved.payloadDigest, pkg.payloadDigest);

  await assert.rejects(
    run.runRecord.approvedPackage({ ...bound, packageDigest: `sha256:${other.payloadDigest}` }),
    refused("VES_TASK_PACKAGE_INVALID"),
    "a package whose payload is not the one the plan bound"
  );
  await assert.rejects(
    run.runRecord.approvedPackage({ ...bound, packageId: "../plan" }),
    refused("VES_TASK_PACKAGE_INVALID"),
    "a package ID that is not an artifact ID"
  );

  const path = run.file("packages", `${pkg.artifactId}.json`);
  const stored = await readFile(path, "utf8");
  await writeFile(path, "{not json");
  await assert.rejects(run.runRecord.approvedPackage(bound), refused("VES_TASK_PACKAGE_INVALID"), "unreadable");
  await writeFile(path, await readFile(run.file("packages", `${other.artifactId}.json`), "utf8"));
  await assert.rejects(run.runRecord.approvedPackage(bound), refused("VES_TASK_PACKAGE_INVALID"), "swapped");
  await writeFile(path, stored);
  assert.equal((await run.runRecord.approvedPackage(bound)).artifactId, pkg.artifactId);
});

async function recordedEvidence() {
  const run = await opened();
  const store = run.runRecord.gateEvidence;
  const change = filled("9");
  store.judging(change);
  const failed = await store.record({ gateId: "gate:unit", verdict: "FAIL", exitCode: 1 });
  const unit = await store.record({ gateId: "gate:unit", verdict: "PASS", exitCode: 0 });
  const lint = await store.record({ gateId: "gate:lint", verdict: "PASS", exitCode: 0 });
  const expected = canonicalDigestOf({
    evidenceDigests: [unit.evidenceDigest, lint.evidenceDigest],
    evidenceRefs: [unit.evidenceRef, lint.evidenceRef]
  });
  return { run, store, change, failed, unit, lint, expected };
}

test("gate evidence is recovered only when it reproduces the digest the commit carries", async () => {
  const { store, change, unit, lint, expected } = await recordedEvidence();
  assert.deepEqual(await store.recover(change, ["gate:unit", "gate:lint"], expected), [
    unit.evidenceRef,
    lint.evidenceRef
  ]);
  await assert.rejects(
    store.recover(change, ["gate:unit", "gate:lint"], filled("0")),
    refused("VES_TASK_EVIDENCE_MISMATCH")
  );
  // why: the digest binds the gates in plan order, so the same evidence in
  // another order, or only part of it, is not the evidence the commit cites.
  await assert.rejects(
    store.recover(change, ["gate:lint", "gate:unit"], expected),
    refused("VES_TASK_EVIDENCE_MISMATCH")
  );
  await assert.rejects(store.recover(change, ["gate:unit"], expected), refused("VES_TASK_EVIDENCE_MISMATCH"));
});

test("gate evidence that is absent, failing, or recorded for another change is missing", async () => {
  const { run, store, change, failed, expected } = await recordedEvidence();
  await assert.rejects(
    store.recover(change, ["gate:unit", "gate:absent"], expected),
    refused("VES_TASK_EVIDENCE_MISSING")
  );
  await assert.rejects(
    store.recover(filled("8"), ["gate:unit", "gate:lint"], expected),
    refused("VES_TASK_EVIDENCE_MISSING")
  );
  const none = await opened();
  await assert.rejects(
    none.runRecord.gateEvidence.recover(change, ["gate:unit"], expected),
    refused("VES_TASK_EVIDENCE_MISSING")
  );

  const onlyFailing = await opened();
  onlyFailing.runRecord.gateEvidence.judging(change);
  await onlyFailing.runRecord.gateEvidence.record({ gateId: "gate:unit", verdict: "FAIL", exitCode: 1 });
  await assert.rejects(
    onlyFailing.runRecord.gateEvidence.recover(change, ["gate:unit"], expected),
    refused("VES_TASK_EVIDENCE_MISSING")
  );
  assert.deepEqual(await store.load(failed.evidenceRef), { gateId: "gate:unit", verdict: "FAIL", exitCode: 1 });
  assert.equal(
    await store.load("gate-evidence:../../plan"),
    undefined,
    "a ref that is not an evidence ref loads nothing"
  );
  assert.equal((await listing(run.file("gate-evidence"))).length, 3);
});

test("a run is reviewable only with both its task commit record and its verification report", async () => {
  const commitOnly = await opened();
  await commitOnly.runRecord.saveCommit(taskCommit());
  await assert.rejects(commitOnly.runRecord.verifiedCommit(), refused("VES_TASK_REVIEW_UNAVAILABLE"));

  const reportOnly = await opened();
  await reportOnly.runRecord.saveReport(verificationReport());
  await assert.rejects(reportOnly.runRecord.verifiedCommit(), refused("VES_TASK_REVIEW_UNAVAILABLE"));

  const both = await opened();
  await both.runRecord.saveCommit(taskCommit());
  await both.runRecord.saveReport(verificationReport());
  assert.deepEqual(await both.runRecord.verifiedCommit(), { commit: taskCommit(), report: verificationReport() });

  // invariant: a damaged record is never reported as a run with nothing to review.
  await both.plant(["verification", "report.json"], sealedText(verificationReport()).replace("PASS", "FAIL"));
  await assert.rejects(both.runRecord.verifiedCommit(), refused("VES_TASK_STATE_TAMPERED"));
});

test("one live process drives a run, and a marker that names none is no claim", async () => {
  const run = await opened();
  await run.runRecord.claimActive(process.pid);
  assert.equal(await run.runRecord.activeProcess(), process.pid);
  await assert.rejects(run.runRecord.claimActive(process.pid), publicCode("VES_TASK_RUN_ACTIVE"));
  await run.runRecord.releaseActive();
  assert.equal(await run.runRecord.activeProcess(), undefined);

  for (const content of ['{"pid":0}', '{"pid":-4}', '{"pid":1.5}', '{"pid":"7"}', "{}", "[]", "{not json"]) {
    await run.plant(["active.json"], content);
    assert.equal(await run.runRecord.activeProcess(), undefined, content);
  }
  const blocked = await opened();
  await mkdir(blocked.file("active.json"), { recursive: true });
  assert.equal(await blocked.runRecord.activeProcess(), undefined, "an unreadable marker names no process");
});

test("a process this user may not signal still counts as driving the run", async (t) => {
  if (!POSIX) return t.diagnostic("process 1 is a POSIX fact");
  const run = await opened();
  await run.plant(["active.json"], '{"pid":1}');
  assert.equal(await run.runRecord.activeProcess(), 1);
  await assert.rejects(run.runRecord.claimActive(process.pid), publicCode("VES_TASK_RUN_ACTIVE"));
  assert.equal(await run.text("active.json"), '{"pid":1}', "a refused claim leaves the marker alone");
});

test("claiming a run clears the cancel request left for its previous driver", async () => {
  const run = await opened();
  assert.equal(await run.runRecord.cancelRequested(), false);
  await run.runRecord.requestCancel("human:local-operator");
  assert.equal(await run.runRecord.cancelRequested(), true);
  await run.runRecord.claimActive(process.pid);
  assert.equal(await run.runRecord.cancelRequested(), false);
  await run.runRecord.requestCancel("human:local-operator");
  assert.equal(await run.runRecord.cancelRequested(), true, "a request made while the run is driven stays");
});

test("the worktree marker yields a handle only when it holds text", async () => {
  const run = await opened();
  const handle = `worktree:${"a".repeat(32)}:${"b".repeat(64)}`;
  await run.runRecord.saveWorktreeRef(handle);
  assert.equal(await run.runRecord.loadWorktreeRef(), handle);
  for (const content of ["{}", '{"worktreeRef":7}', '{"worktreeRef":null}', '{"worktreeRef":["x"]}']) {
    await run.plant(["worktree.json"], content);
    assert.equal(await run.runRecord.loadWorktreeRef(), undefined, content);
  }
});

test("a commit record whose fields are not IDs and a digest is malformed", async () => {
  for (const invalid of [
    { commitId: "c".repeat(39) },
    { baseCommit: "B".repeat(40) },
    { gateEvidenceDigest: "sha256:5" },
    { gateEvidenceRefs: "gate-evidence" }
  ]) {
    const run = await opened();
    await run.runRecord.saveCommit(taskCommit(invalid));
    await assert.rejects(run.runRecord.loadCommit(), refused("VES_TASK_STATE_MALFORMED"), JSON.stringify(invalid));
  }
  const sha256 = await opened();
  const commit = taskCommit({ commitId: "c".repeat(64), baseCommit: "b".repeat(64) });
  await sha256.runRecord.saveCommit(commit);
  assert.deepEqual(await sha256.runRecord.loadCommit(), commit);
});
