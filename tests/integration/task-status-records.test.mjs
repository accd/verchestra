// invariant: `task status` reads the Run record's declared records (ADR2-9).
// It names a reason only for an outcome that carries one, and a grant or
// outcome marker of another shape stops it in either form, also in a legacy
// Run, whose markers were read as whatever the file held before. The command
// runs in this process on a real Workspace.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { statusTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { cleanupTaskCommandFixtures, refusedState, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { RUN_ID, planRecord, sealedText } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

const RUN = Object.freeze({ runId: RUN_ID });
const FORMS = Object.freeze({ legacy: {}, sealed: { markerSeal: 1 } });

async function planned(form) {
  const fixture = await taskCommandFixture();
  const run = await fixture.planned("IMPLEMENTING", planRecord(FORMS[form]));
  const plant = (name, record) =>
    writeFile(join(run.directory, name), form === "sealed" ? sealedText(record) : `${JSON.stringify(record)}\n`);
  return { fixture, ...run, plant, status: () => statusTask(fixture.io, RUN) };
}

test("status names the reason of a failed or aborted run and no reason for any other outcome", async () => {
  const outcomes = [
    [{ status: "FAILED", reason: "VES_TASK_GATE_FAILED" }, "VES_TASK_GATE_FAILED"],
    [{ status: "ABORTED", reason: "VES_EXECUTOR_CANCELLED" }, "VES_EXECUTOR_CANCELLED"],
    [{ status: "ESCALATED", failure: { failedGateId: "gate:unit", evidenceRef: "repair:escalated" } }, null],
    [{ status: "APPROVAL_INVALIDATED" }, null]
  ];
  for (const [outcome, reason] of outcomes) {
    const run = await planned("sealed");
    await run.runRecord.saveOutcome(outcome);
    const status = await run.status();
    assert.equal(status.lastOutcome, outcome.status);
    assert.equal(status.lastReason, reason, outcome.status);
  }
  const none = await planned("sealed");
  const status = await none.status();
  assert.equal(status.lastOutcome, null);
  assert.equal(status.lastReason, null);
});

test("status refuses a grant or outcome marker of another shape in either form", async () => {
  for (const form of Object.keys(FORMS)) {
    const grant = await planned(form);
    await grant.plant("grant.json", { grantId: 7 });
    await assert.rejects(grant.status(), refusedState("VES_TASK_STATE_MALFORMED"), `${form} grant`);

    const outcome = await planned(form);
    await outcome.plant("outcome.json", { status: "FAILED", at: "2026-07-15T15:00:00.000Z" });
    await assert.rejects(outcome.status(), refusedState("VES_TASK_STATE_MALFORMED"), `${form} outcome`);
  }
});
