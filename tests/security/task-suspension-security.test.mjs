// invariant: SSI-53 and SSI-81 for the records T6 adds. The owner's
// extra-usage statement can hold no secret, account, person, or path, and a
// refusal of one never echoes what it held; a suspension's record, the
// executor's `suspended` checkpoint, and the node ledger carry no session,
// account data, provider text, credential, or machine-local path, whatever a
// provider's signal carried. Providers and engines are labelled fakes.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { requireSubscriptionPreflight } from "../../apps/vestra-cli/src/task/task-billing.ts";
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

test("a suspension keeps none of what a hostile quota signal carried, in any record it leaves", async () => {
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
});
