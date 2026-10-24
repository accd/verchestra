// invariant: the pure pieces of the `vestra task` composition (#405) that
// decide authority and trust: the task Cedar policy view, the verifier verdict
// parser, and the typed-back human confirmation.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { after, afterEach, test } from "node:test";

import { confirmDigest } from "../../apps/vestra-cli/src/task/task-confirm.ts";
import { parseVerdict } from "../../apps/vestra-cli/src/task/task-codex.ts";
import { WORKSPACE_POLICY_PATH, loadTaskPolicy } from "../../apps/vestra-cli/src/task/task-policy.ts";
import { gateAllowlistPath } from "../../apps/vestra-cli/src/task/task-gates.ts";
import { planTask } from "../../apps/vestra-cli/src/task/task-plan.ts";
import { runTask } from "../../apps/vestra-cli/src/task/task-run.ts";
import { modelPriceTable } from "../../packages/application/src/index.ts";
import { cleanupTaskCommandFixtures, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { boundPlanRecord } from "../helpers/task-plan-fixture.mjs";
import { validTaskRequest } from "../helpers/task-request-fixture.mjs";
import { RUN_ID, taskRequest } from "../helpers/task-run-record-fixture.mjs";

const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
afterEach(cleanupTaskCommandFixtures);

async function controlRoot(policy) {
  const root = await mkdtemp(join(tmpdir(), "vestra-task-policy-"));
  roots.push(root);
  if (policy !== undefined) {
    const path = join(root, ...WORKSPACE_POLICY_PATH.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(policy));
  }
  return root;
}

const context = (overrides = {}) => ({
  approved: true,
  capabilityGranted: true,
  workspaceId: "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
  risk: "medium",
  taskId: "T1",
  ...overrides
});

test("the built-in task policy permits only approved actions and writes only with a grant", async () => {
  const policy = await loadTaskPolicy(await controlRoot());
  assert.match(policy.digest, /^sha256:[a-f0-9]{64}$/u);
  for (const action of ["task-start", "tool-effect", "gate-commit", "human-review"]) {
    assert.equal(policy.decide(action, context()).decision, "allow", action);
    assert.equal(policy.decide(action, context({ approved: false })).decision, "deny", action);
  }
  assert.equal(policy.decide("tool-effect", context({ capabilityGranted: false })).decision, "deny");
  assert.equal(policy.decide("task-start", context({ capabilityGranted: false })).decision, "allow");
});

test("a Workspace forbid narrows the policy and changes its digest", async () => {
  const open = await loadTaskPolicy(await controlRoot());
  const narrowed = await loadTaskPolicy(
    await controlRoot({
      schemaVersion: 1,
      forbid: { noCritical: 'forbid(principal, action, resource) when { context.risk == "critical" };' }
    })
  );
  assert.notEqual(narrowed.digest, open.digest);
  assert.equal(narrowed.decide("task-start", context()).decision, "allow");
  const denied = narrowed.decide("task-start", context({ risk: "critical" }));
  assert.equal(denied.decision, "deny");
  assert.equal(denied.code, "VES_POLICY_FORBID_DENY");
});

test("a Workspace policy can never widen authority or smuggle other shapes", async () => {
  const widen = await controlRoot({ schemaVersion: 1, forbid: { widen: "permit(principal, action, resource);" } });
  await assert.rejects(loadTaskPolicy(widen), (error) => {
    assert.equal(error.envelope.safeDetails.reason, "VES_POLICY_NON_MONOTONIC");
    return true;
  });
  for (const shape of [{ schemaVersion: 2, forbid: {} }, { schemaVersion: 1, forbid: { x: 1 } }, { forbid: {} }]) {
    await assert.rejects(loadTaskPolicy(await controlRoot(shape)), (error) => {
      assert.equal(error.envelope.code, "VES_TASK_FAILED");
      return true;
    });
  }
});

const BLOCK = (body) => `noise\nVERCHESTRA-VERDICT-BEGIN\n${JSON.stringify(body)}\nVERCHESTRA-VERDICT-END\n`;

test("the verifier verdict is read from one delimited block and validated field by field", () => {
  const ids = ["VES-EXE-001", "VES-EXE-002"];
  const claims = parseVerdict(
    BLOCK({
      requirements: [
        {
          requirementId: "VES-EXE-001",
          satisfied: true,
          evidence: { file: "tests/a.test.mjs", lineStart: 3, lineEnd: 4 },
          implementationFile: "src/a.ts"
        },
        { requirementId: "VES-EXE-002", satisfied: true, evidence: { file: "/etc/passwd", lineStart: 1, lineEnd: 1 } },
        { requirementId: "VES-VFY-001", satisfied: true, evidence: { file: "a", lineStart: 1, lineEnd: 1 } }
      ]
    }),
    ids
  );
  assert.deepEqual(claims, [
    {
      requirementId: "VES-EXE-001",
      satisfied: true,
      evidence: { file: "tests/a.test.mjs", lineStart: 3, lineEnd: 4 },
      implementationFile: "src/a.ts"
    },
    { requirementId: "VES-EXE-002", satisfied: false }
  ]);
});

test("a malformed, missing, or reversed verdict covers nothing", () => {
  const ids = ["VES-EXE-001"];
  assert.deepEqual(parseVerdict("no block at all", ids), []);
  assert.deepEqual(parseVerdict("VERCHESTRA-VERDICT-BEGIN\n{not json}\nVERCHESTRA-VERDICT-END", ids), []);
  assert.deepEqual(parseVerdict("VERCHESTRA-VERDICT-END VERCHESTRA-VERDICT-BEGIN", ids), []);
  assert.deepEqual(parseVerdict(BLOCK({ requirements: "all" }), ids), []);
  const reversed = parseVerdict(
    BLOCK({
      requirements: [
        { requirementId: "VES-EXE-001", satisfied: true, evidence: { file: "a", lineStart: 5, lineEnd: 2 } }
      ]
    }),
    ids
  );
  assert.deepEqual(reversed, [{ requirementId: "VES-EXE-001", satisfied: false }]);
});

function input(text, isTTY = false) {
  const stream = new EventEmitter();
  stream.isTTY = isTTY;
  stream.resume = () =>
    setImmediate(() => {
      if (text !== undefined) stream.emit("data", Buffer.from(text));
      stream.emit("end");
    });
  stream.pause = () => undefined;
  return stream;
}

function io(stdin) {
  const prompts = [];
  return { io: { stdin, stderr: (value) => prompts.push(value) }, prompts };
}

test("a human decision needs the exact digest typed back from a terminal or --confirm-stdin", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const refused = (error) => {
    assert.equal(error.envelope.code, "VES_TASK_CONFIRMATION_REQUIRED");
    return true;
  };
  await assert.rejects(
    confirmDigest(io(input(`${digest}\n`)).io, digest, { confirmStdin: false, label: "binding" }),
    refused
  );
  await confirmDigest(io(input(`${digest}\n`)).io, digest, { confirmStdin: true, label: "binding" });
  await assert.rejects(
    confirmDigest(io(input(`${digest}x\n`)).io, digest, { confirmStdin: true, label: "binding" }),
    refused
  );
  await assert.rejects(confirmDigest(io(input("")).io, digest, { confirmStdin: true, label: "binding" }), refused);
  const terminal = io(input(`${digest}\n`, true));
  await confirmDigest(terminal.io, digest, { confirmStdin: false, label: "binding" });
  assert.deepEqual(terminal.prompts, ["Type the binding digest to confirm: "]);
});

// invariant: a refusal a tester can fix alone says where the missing file goes
// and what it holds. The path is machine-local, so it reaches the terminal
// only, never the public error.
async function plannedRequest(fixture, request) {
  const path = join(fixture.repositoryRoot, "task-request.json");
  await writeFile(path, JSON.stringify(request));
  return path;
}

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("the command was not refused");
}

function assertGateAllowlistExplained(fixture, error) {
  assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
  assert.deepEqual(error.envelope.safeDetails, { requirement: "gate-allowlist" });
  const text = fixture.stderr.join("");
  assert.ok(text.includes(gateAllowlistPath(fixture.workspace)), text);
  const template = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  assert.equal(template.schemaVersion, 1);
  assert.equal(typeof template.commands, "object");
  assert.deepEqual(Object.keys(template.commands).sort(), ["command:node", "command:node-test"]);
}

test("a missing gate allowlist is explained with its path and template on plan", async () => {
  const fixture = await taskCommandFixture();
  await rm(gateAllowlistPath(fixture.workspace));
  const path = await plannedRequest(fixture, validTaskRequest());
  assertGateAllowlistExplained(fixture, await refusal(planTask(fixture.io, path, false)));
});

test("a missing gate allowlist is explained with its path and template on start", async () => {
  const fixture = await taskCommandFixture();
  await rm(gateAllowlistPath(fixture.workspace));
  const { record, pkg } = await boundPlanRecord(taskRequest());
  const run = await fixture.planned("EXECUTION_AUTHORIZED", record);
  await run.runRecord.savePackage(pkg);
  // why: the allowlist is read with the run's own settings, before the
  // machine is probed or a credential is read, so `start` refuses here and
  // the deny guard of the fixture is never reached.
  assertGateAllowlistExplained(
    fixture,
    await refusal(runTask(fixture.io, { runId: RUN_ID, resume: false }, { platform: "linux" }))
  );
  assert.equal(fixture.state(), "EXECUTION_AUTHORIZED");
});

test("an unpriced model refusal lists the accepted models", async () => {
  const fixture = await taskCommandFixture();
  const request = validTaskRequest();
  const path = await plannedRequest(fixture, { ...request, verifier: { driverId: "codex", model: "gpt-unpriced-9" } });
  const error = await refusal(planTask(fixture.io, path, false));
  assert.equal(error.envelope.code, "VES_TASK_REQUEST_REJECTED");
  assert.deepEqual(error.envelope.safeDetails, { reason: "VES_TASK_REQUEST_MODEL_UNPRICED" });
  const text = fixture.stderr.join("");
  const line = (driver) => text.split("\n").find((entry) => entry.startsWith(`${driver} accepts: `)) ?? "";
  const listed = (driver) => line(driver).slice(`${driver} accepts: `.length).split(", ");
  assert.ok(listed("codex").includes("gpt-5.5"), text);
  for (const model of Object.keys(modelPriceTable.models).filter((entry) => entry.startsWith("claude-")))
    assert.ok(listed("claude-code").includes(model), `${model} in ${text}`);
});
