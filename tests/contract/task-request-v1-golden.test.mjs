// invariant: Task Request v1 is frozen (SSI-20, SSI-21, SSI-22). Every value
// below was recorded on revision dc35c52, before Task Request v2 existed, from
// the unchanged schema, generator, normalizer, and Run record writer. A byte
// that moves in any of them for a v1 request fails here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { planSurface } from "../../apps/vestra-cli/src/task/task-plan.ts";
import { canonicalTaskRequest, normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { cleanupTaskCommandFixtures, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { boundPlan } from "../helpers/task-plan-fixture.mjs";
import { validTaskRequest } from "../helpers/task-request-fixture.mjs";
import { contextManifest, planRecord, taskRequest } from "../helpers/task-run-record-fixture.mjs";

after(cleanupTaskCommandFixtures);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const repository = new URL("../../", import.meta.url);

test("the v1 schema keeps its bytes", async () => {
  assert.equal(
    sha256(await readFile(new URL("schemas/task-request/1.schema.json", repository))),
    "sha256:9bfc24cec02371649ef58c67370e9b631f6d8fbc563ab33363e505213d048d62"
  );
});

test("the generated contracts keep every byte they had before version 2 was appended", async () => {
  const text = await readFile(new URL("packages/contracts/src/generated.ts", repository), "utf8");
  const appended = text.lastIndexOf("/**", text.indexOf("export interface TaskRequestV2 {"));
  assert.ok(appended > 0, "TaskRequestV2 is generated after the version 1 contracts");
  assert.equal(text.slice(appended - 2, appended), "\n\n");
  assert.equal(
    sha256(text.slice(0, appended - 1)),
    "sha256:341983f6ffe969ccff397457284597d7a36e54732115291414326be77ba38512"
  );
});

test("a v1 request keeps its normalized form and its execution-contract digest", () => {
  assert.equal(
    sha256(canonicalTaskRequest(validTaskRequest())),
    "sha256:e1040b2826bf1725293fa29b017a09694ae5c9919b08ababd25b58ea43496d68"
  );
  const withoutRepair = validTaskRequest();
  delete withoutRepair.onGateFailure;
  assert.equal(
    sha256(canonicalTaskRequest(withoutRepair)),
    "sha256:cd24f69dc148d13e8d85e811f8968cb5708b065f00b4152032e3160f59673464"
  );
  // why: `task plan` seals canonicalDigest(normalized request) as the
  // Execution Package's executionContractDigest.
  assert.equal(
    sha256(canonicalizeJsonV2(normalizeTaskRequest(taskRequest()))),
    "sha256:2b4dd994497595fb01d37ea747af6ca34bfe6dc85c01fc7b02c6da7ccdd1a196"
  );
});

test("a v1 plan record is written with the same bytes and loads unchanged", async () => {
  const fixture = await taskCommandFixture();
  const { directory, runRecord } = await fixture.planned("AWAITING_EXECUTION_APPROVAL");
  assert.equal(
    sha256(await readFile(join(directory, "plan.json"))),
    "sha256:e6c97cd79c6eb7a6ea93d954e9c098cc8205a4cece0318615b51b7eabed0272f"
  );
  assert.deepEqual(await runRecord.loadPlan(), planRecord());
});

test("a v1 plan seals the same Execution Package, binds the same approval, and presents the same surface", async () => {
  const { pkg, intent, approvalRequest } = await boundPlan(taskRequest());
  assert.equal(
    `sha256:${pkg.payloadDigest}`,
    "sha256:13f2bc46466cabfb74f678f3913e5838cd838ef20b1f2f5ceea1a06be93a11db"
  );
  assert.equal(
    approvalRequest.bindingDigest,
    "sha256:9a6d82f4cc3fe2109fea2ef033b2334eef11d6f09c92eb3f3a5df616dc0f87a5"
  );
  const surface = planSurface({ ...planRecord(), approvalIntent: intent, approvalRequest }, contextManifest(), false, {
    implementer: "subscription",
    verifier: "subscription"
  });
  assert.equal(
    sha256(canonicalizeJsonV2(surface)),
    "sha256:5056fc0cf5335975fbcda1a748b2aeeca4b4313f4418926cf87bbea0ad47ec83"
  );
});
