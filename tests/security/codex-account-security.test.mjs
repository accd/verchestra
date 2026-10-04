// invariant: SSI-49, SSI-53, and SSI-81 for what T9's remediation reads of a
// Codex account. A session that reads the account reports its plan type as a
// closed value and nothing else: no e-mail address, account identifier, or
// account text reaches the report, an event, or the refusal the owner is
// shown. The App Server is the labelled DETERMINISTIC FAKE of the Codex driver
// suites; no provider is contacted.
import assert from "node:assert/strict";
import { test } from "node:test";

import { requireStatedPlanType } from "../../apps/vestra-cli/src/task/task-billing.ts";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";

const EMAIL = "owner@example.invalid";
const ACCOUNT_ID = "private-account-id-5d1e";

async function accountSession(execution, account) {
  const fixture = codexFixture({
    environment: { FAKE_CODEX_MODE: "success", FAKE_CODEX_ACCOUNT: JSON.stringify(account) },
    ...execution
  });
  const events = [];
  const reports = [];
  const driver = new CodexDriver(
    fixture.dependencies({
      minimumVersion: undefined,
      probeEnvironment: { FAKE_CODEX_VERSION: "0.159.3" },
      onAccount: (report) => reports.push(report)
    })
  );
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  return { events, reports };
}

test("an account read keeps its plan type as a closed value and nothing else of the account", async () => {
  for (const execution of [{ accountOnly: true }, { subscriptionOnly: true }])
    for (const planType of ["plus", `Plus for ${EMAIL}`]) {
      const account = { type: "chatgpt", email: EMAIL, planType, accountId: ACCOUNT_ID };
      const { events, reports } = await accountSession(execution, account);
      const label = `${JSON.stringify(execution)} ${planType}`;
      assert.equal(reports.length, 1, label);
      assert.deepEqual(Object.keys(reports[0]), ["planType"], label);
      for (const text of [JSON.stringify(reports), JSON.stringify(events)]) {
        assert.equal(text.includes(EMAIL), false, `${label} kept the e-mail address`);
        assert.equal(text.includes(ACCOUNT_ID), false, `${label} kept the account identifier`);
      }
    }
});

test("the refusal of another plan type tells the owner the two closed values only", () => {
  const lines = [];
  assert.throws(() => requireStatedPlanType("plus", "unknown", (line) => lines.push(line)));
  const told = lines.join("");
  assert.match(told, /plan type unknown .* names plus/u);
  assert.equal(told.includes(EMAIL), false);
});
