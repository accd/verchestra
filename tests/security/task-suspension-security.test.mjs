// invariant: SSI-53 and SSI-81 for the records T6 adds. The owner's
// extra-usage statement can hold no secret, account, person, or path, and a
// refusal of one never echoes what it held; a suspension's record, the
// executor's `suspended` checkpoint, the node ledger, and the run's SUSPENDED
// outcome marker carry no session, account data, provider text, credential,
// or machine-local path, whatever a provider's signal carried, and a marker
// that carries one is refused when it is read. Providers and engines are
// labelled fakes.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { requireSubscriptionPreflight } from "../../apps/vestra-cli/src/task/task-billing.ts";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { CoordinatedDriver, TaskExecutionSuspended } from "../../packages/application/src/index.ts";
import { extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import {
  MemoryPayloads,
  MemoryRecords,
  coordinatedRequest,
  scriptedNodes,
  sequentialEngine
} from "../helpers/coordinated-driver-fixture.mjs";
import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";
import { RUN_ID, WORKSPACE_ID } from "../helpers/task-run-record-fixture.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const byText = (left, right) => Number(left > right) - Number(left < right);
const TOKEN = "sk-ant-oat01-fake-suspension-security-3c9d";
const EMAIL = "owner@example.invalid";
const SESSION = "private-session-id-8e21";

function holdsNone(text, forbidden, label) {
  for (const value of forbidden) assert.equal(text.includes(value), false, `${label} holds ${value}`);
}

test("a refused extra-usage statement is never echoed: not its token, e-mail address, or path", async (t) => {
  const root = await temporaryDirectory(t, "vestra-billing-security-");
  const codex = { ...extraUsageConfirmation().providers.codex, email: EMAIL, token: TOKEN, home: homedir() };
  await writeFile(join(root, "task-billing.json"), JSON.stringify(extraUsageConfirmation({ codex })));
  const lines = [];
  let refusal;
  try {
    await requireSubscriptionPreflight({
      workspaceRoot: root,
      auth: { implementer: "subscription", verifier: "subscription" },
      request: coordinatedRequest("graph"),
      stderr: (line) => lines.push(line)
    });
  } catch (error) {
    refusal = error;
  }
  assert.equal(refusal?.envelope?.code, "VES_TASK_NOT_CONFIGURED");
  const surfaced = [JSON.stringify(refusal.envelope), refusal.message, lines.join("")].join("\n");
  holdsNone(surfaced, [TOKEN, EMAIL, homedir()], "the refusal");
  holdsNone(JSON.stringify(refusal.envelope), [root], "the public envelope");
});

test("a suspension keeps none of what a hostile quota signal carried, in any record it leaves", async (t) => {
  const input = executorInput();
  const request = { ...coordinatedRequest("agent"), task: input.task };
  const payloads = new MemoryPayloads();
  const records = new MemoryRecords();
  const nodes = scriptedNodes(payloads, {
    build: async () => {
      throw Object.assign(new Error(`quota for ${EMAIL} in ${homedir()}`), {
        code: "VES_DRIVER_QUOTA_EXHAUSTED",
        quota: { scope: `five_hour ${SESSION}`, resetsAt: `${homedir()}/reset`, token: TOKEN },
        session_id: SESSION,
        email: EMAIL
      });
    }
  });
  const { state, ports } = executorPorts({
    driver: (() => {
      const driver = new CoordinatedDriver({
        request,
        engine: async () => sequentialEngine,
        nodes,
        payloads,
        records,
        context: "",
        remainingDurationMs: () => 60_000
      });
      return {
        execute: (driverRequest, control) => driver.execute(driverRequest, control),
        cancel: (worktreeRef) => driver.cancel(worktreeRef)
      };
    })()
  });
  let suspended;
  await assert.rejects(executor(ports).execute(input), (error) => {
    suspended = error;
    return error instanceof TaskExecutionSuspended;
  });
  assert.deepEqual(Object.keys(suspended.suspension).sort(byText), ["at", "provider", "reason"]);
  const forbidden = [TOKEN, EMAIL, SESSION, homedir()];
  holdsNone(JSON.stringify(suspended.suspension), forbidden, "the suspension");
  holdsNone(JSON.stringify(state.checkpoints), forbidden, "the executor checkpoints");
  holdsNone(JSON.stringify(records.ledger), forbidden, "the node ledger");
  const tasksRoot = join(await temporaryDirectory(t, "vestra-suspension-marker-"), "tasks");
  const runRecord = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID);
  await runRecord.saveOutcome({ status: "SUSPENDED", suspension: suspended.suspension });
  holdsNone(await readFile(join(tasksRoot, RUN_ID, "outcome.json"), "utf8"), forbidden, "the outcome marker");
  assert.deepEqual((await runRecord.loadOutcome()).suspension, suspended.suspension);
});

// invariant: the SUSPENDED marker is read against the grammars it was written
// in, so one carrying account data, a session, or a path is refused whole.
test("a SUSPENDED outcome marker carrying account data, a session, or a path is refused when it is read", async (t) => {
  const tasksRoot = join(await temporaryDirectory(t, "vestra-suspension-marker-"), "tasks");
  await mkdir(join(tasksRoot, RUN_ID), { recursive: true });
  const runRecord = openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID);
  const at = "2026-10-03T12:00:00.000Z";
  const closed = { reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "claude-code", at };
  await writeFile(
    join(tasksRoot, RUN_ID, "outcome.json"),
    JSON.stringify({ status: "SUSPENDED", at, suspension: closed })
  );
  assert.deepEqual((await runRecord.loadOutcome()).suspension, closed, "the closed members alone are read");
  for (const suspension of [
    { ...closed, email: EMAIL },
    { ...closed, sessionId: SESSION },
    { ...closed, scope: `${homedir()}/five_hour` },
    { ...closed, resetsAt: TOKEN },
    { ...closed, provider: `claude-code ${EMAIL}` }
  ]) {
    await writeFile(join(tasksRoot, RUN_ID, "outcome.json"), JSON.stringify({ status: "SUSPENDED", at, suspension }));
    await assert.rejects(
      runRecord.loadOutcome(),
      (error) => error?.envelope?.safeDetails?.reason === "VES_TASK_STATE_MALFORMED",
      JSON.stringify(suspension)
    );
  }
});
