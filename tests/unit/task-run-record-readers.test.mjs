// invariant: the Run record's readers return declared records (ADR2-9). The
// grant and outcome markers, the verification report, and the review record
// are each validated as they are read, a marker in either form, and a record
// of another shape is refused as malformed, never read in part. What a reader
// returns is the record as the file holds it, every member kept, because the
// Run Capsule and the review surface digest it. These cases drive the
// interface in a temporary directory; the goldens stay in the ADP-2 suites.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import {
  GRANT_ID,
  RUN_ID,
  WORKSPACE_ID,
  canonicalDigestOf,
  cleanupRunRecordFixtures,
  planRecord,
  sealedText,
  taskCommit,
  temporaryRoot,
  verificationReport
} from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);

const FORMS = Object.freeze({ legacy: {}, sealed: { markerSeal: 1 } });
const AT = "2026-07-15T15:00:00.000Z";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REPORT_REF = `verification:${"a".repeat(32)}`;
const OUTCOMES = Object.freeze({
  HUMAN_REVIEW: { status: "HUMAN_REVIEW", commit: taskCommit(), reportRef: REPORT_REF },
  VERIFICATION_FAILED: { status: "VERIFICATION_FAILED", state: "REPAIRING", reportRef: REPORT_REF },
  ESCALATED: {
    status: "ESCALATED",
    failure: { failedGateId: "gate:unit", evidenceRef: `gate-evidence:${"e".repeat(32)}` }
  },
  FAILED: { status: "FAILED", reason: "VES_TASK_GATE_FAILED" },
  ABORTED: { status: "ABORTED", reason: "VES_EXECUTOR_CANCELLED" },
  APPROVAL_INVALIDATED: { status: "APPROVAL_INVALIDATED" },
  SUSPENDED: {
    status: "SUSPENDED",
    suspension: {
      reason: "VES_DRIVER_QUOTA_EXHAUSTED",
      provider: "claude-code",
      at: "2026-10-03T12:00:00.000Z",
      scope: "five_hour",
      resetsAt: "2026-10-03T17:00:00.000Z"
    }
  }
});
const REVIEW = Object.freeze({
  schemaVersion: 1,
  runId: RUN_ID,
  reviewerActorId: "human:local-operator",
  commitId: "c".repeat(40),
  outcome: "accepted",
  findingRefs: []
});

async function opened(form) {
  const root = await temporaryRoot();
  const tasksRoot = join(root, "tasks");
  const directory = join(tasksRoot, RUN_ID);
  const runRecord = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID);
  if (form !== undefined) await runRecord.savePlan(planRecord(FORMS[form]));
  return {
    runRecord,
    fresh: () => openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID),
    plant: async (segments, content) => {
      await mkdir(join(directory, ...segments.slice(0, -1)), { recursive: true });
      await writeFile(join(directory, ...segments), content);
    }
  };
}

// why: a marker as the given form stores it, so a case plants exactly the
// file a run of that form would hold.
function stored(form, record) {
  return form === "sealed" ? sealedText(record) : `${JSON.stringify(record)}\n`;
}

function refused(reason) {
  return (error) => {
    assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
    assert.equal(error.envelope.safeDetails.reason, reason);
    return true;
  };
}

function without(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function outcome(status, change = {}) {
  return { ...OUTCOMES[status], at: AT, ...change };
}

test("a grant marker round-trips in both forms, and the record is returned whole", async () => {
  for (const form of Object.keys(FORMS)) {
    const run = await opened(form);
    await run.runRecord.saveGrant(GRANT_ID);
    assert.deepEqual(await run.runRecord.loadGrant(), { grantId: GRANT_ID }, form);
    assert.deepEqual(await run.fresh().loadGrant(), { grantId: GRANT_ID }, form);

    // why: the Run Capsule digests the marker as it is read, so a member the
    // declared type does not name stays in what the reader returns.
    const whole = { grantId: GRANT_ID, issuedFor: "fixture" };
    await run.plant(["grant.json"], stored(form, whole));
    const marker = await run.runRecord.loadGrant();
    assert.deepEqual(marker, whole, form);
    assert.equal(canonicalDigestOf(marker), canonicalDigestOf(whole), form);
  }
});

test("a grant marker without a text grantId is refused in both forms", async () => {
  for (const form of Object.keys(FORMS))
    for (const record of [{}, { grantId: 7 }, { grantId: "" }, { grantId: null }, { grantId: [GRANT_ID] }]) {
      const run = await opened(form);
      await run.plant(["grant.json"], stored(form, record));
      await assert.rejects(
        run.runRecord.loadGrant(),
        refused("VES_TASK_STATE_MALFORMED"),
        `${form} ${JSON.stringify(record)}`
      );
    }
});

test("every run outcome round-trips in both forms with the time it was filed", async () => {
  for (const form of Object.keys(FORMS))
    for (const [status, written] of Object.entries(OUTCOMES)) {
      const run = await opened(form);
      await run.runRecord.saveOutcome(written);
      const read = await run.fresh().loadOutcome();
      assert.match(read.at, ISO_INSTANT, `${form} ${status}`);
      assert.deepEqual(read, { ...written, at: read.at }, `${form} ${status}`);
    }
});

const MALFORMED_OUTCOMES = Object.freeze([
  ["no status", without(outcome("FAILED"), "status")],
  ["a status that is not text", outcome("FAILED", { status: 7 })],
  ["a status that is not a run outcome", outcome("FAILED", { status: "COMPLETED" })],
  ["no time", without(outcome("FAILED"), "at")],
  ["a time that is not text", outcome("FAILED", { at: 0 })],
  ["a failure without its reason", without(outcome("FAILED"), "reason")],
  ["an abort whose reason is not text", outcome("ABORTED", { reason: ["VES_EXECUTOR_CANCELLED"] })],
  ["a review outcome without its report", without(outcome("HUMAN_REVIEW"), "reportRef")],
  ["a review outcome without its commit", without(outcome("HUMAN_REVIEW"), "commit")],
  ["a review outcome whose commit is not an object", outcome("HUMAN_REVIEW", { commit: "c".repeat(40) })],
  ["a review outcome whose commit is not a commit", outcome("HUMAN_REVIEW", { commit: taskCommit({ commitId: "c" }) })],
  ["a failed verification without its state", without(outcome("VERIFICATION_FAILED"), "state")],
  ["a failed verification with an empty report", outcome("VERIFICATION_FAILED", { reportRef: "" })],
  ["an escalation without its failure", without(outcome("ESCALATED"), "failure")],
  ["an escalation whose failure is not an object", outcome("ESCALATED", { failure: "gate:unit" })],
  [
    "an escalation that names no gate",
    outcome("ESCALATED", { failure: without(OUTCOMES.ESCALATED.failure, "failedGateId") })
  ],
  [
    "an escalation whose evidence is not text",
    outcome("ESCALATED", { failure: { ...OUTCOMES.ESCALATED.failure, evidenceRef: 7 } })
  ],
  // invariant: SSI-61 and SSI-81. A suspension holds a code, a provider,
  // instants, and a limit window, and no other member.
  ["a suspension without its record", without(outcome("SUSPENDED"), "suspension")],
  ["a suspension whose record is not an object", outcome("SUSPENDED", { suspension: "quota" })],
  [
    "a suspension without its provider",
    outcome("SUSPENDED", { suspension: without(OUTCOMES.SUSPENDED.suspension, "provider") })
  ],
  [
    "a suspension whose reason is not a code",
    outcome("SUSPENDED", { suspension: { ...OUTCOMES.SUSPENDED.suspension, reason: "quota exhausted" } })
  ],
  [
    "a suspension whose window is provider text",
    outcome("SUSPENDED", { suspension: { ...OUTCOMES.SUSPENDED.suspension, scope: "Five hours, buy more" } })
  ],
  [
    "a suspension whose reset is not an instant",
    outcome("SUSPENDED", { suspension: { ...OUTCOMES.SUSPENDED.suspension, resetsAt: "tomorrow" } })
  ],
  [
    "a suspension holding an account member",
    outcome("SUSPENDED", { suspension: { ...OUTCOMES.SUSPENDED.suspension, email: "owner@example.invalid" } })
  ]
]);

test("a run outcome of another shape is refused in both forms", async () => {
  for (const form of Object.keys(FORMS))
    for (const [label, record] of MALFORMED_OUTCOMES) {
      const run = await opened(form);
      await run.plant(["outcome.json"], stored(form, record));
      await assert.rejects(run.runRecord.loadOutcome(), refused("VES_TASK_STATE_MALFORMED"), `${form}: ${label}`);
    }
});

test("a verification report round-trips with both verdicts and both object formats, returned whole", async () => {
  for (const change of [{}, { verdict: "FAIL" }, { commitId: "c".repeat(64) }]) {
    const run = await opened();
    const report = verificationReport(change);
    await run.runRecord.saveReport(report);
    assert.deepEqual(await run.runRecord.loadReport(), report, JSON.stringify(change));
  }
});

test("a verification report without a verdict or a commit ID is refused, also where a review reads it", async () => {
  for (const change of [
    { verdict: undefined },
    { verdict: "pass" },
    { verdict: true },
    { commitId: undefined },
    { commitId: "c".repeat(39) },
    { commitId: "C".repeat(40) },
    { commitId: 7 }
  ]) {
    const run = await opened();
    const report = JSON.parse(JSON.stringify(verificationReport(change)));
    await run.plant(["verification", "report.json"], sealedText(report));
    await assert.rejects(run.runRecord.loadReport(), refused("VES_TASK_STATE_MALFORMED"), JSON.stringify(change));
    await run.runRecord.saveCommit(taskCommit());
    await assert.rejects(run.runRecord.verifiedCommit(), refused("VES_TASK_STATE_MALFORMED"), JSON.stringify(change));
  }
});

test("a review record round-trips with either outcome, returned whole", async () => {
  for (const outcome of ["accepted", "rejected"]) {
    const run = await opened();
    await run.runRecord.saveReview({ ...REVIEW, outcome });
    assert.deepEqual(await run.runRecord.loadReview(), { ...REVIEW, outcome }, outcome);
  }
});

test("a review record without an outcome a human can give is refused", async () => {
  for (const record of [without(REVIEW, "outcome"), { ...REVIEW, outcome: "ACCEPTED" }, { ...REVIEW, outcome: true }]) {
    const run = await opened();
    await run.plant(["review.json"], sealedText(record));
    await assert.rejects(run.runRecord.loadReview(), refused("VES_TASK_STATE_MALFORMED"), JSON.stringify(record));
  }
});
