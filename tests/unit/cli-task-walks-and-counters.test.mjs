import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { runDriverScenario } from "../../apps/vestra-cli/src/self-test-driver-scenario.ts";
import { codexLoginSecrets } from "../../apps/vestra-cli/src/task/task-codex-identity.ts";
import { TaskEvidenceStore } from "../../apps/vestra-cli/src/task/task-evidence.ts";
import { canonicalDigest } from "../../apps/vestra-cli/src/task/task-files.ts";
import { MutationSensor } from "../../apps/vestra-cli/src/task/task-mutation-sensor.ts";
import { scratchSegments } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  git,
  objectFormatRepository,
  registeredWorktreeCount
} from "../helpers/git-object-format-fixture.mjs";

// SonarCloud S7721, S4138, S7765, S1121 (T8): the OpenCode Self-Test event
// stream moved to module scope, the ID-token claim walk became a for...of, the
// missing-evidence check became `includes`, and the mutation sensor's run
// counter left its template literal. These pin what each one produces.

const roots = [];
after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await cleanupObjectFormatRepositories();
});

async function temporaryDirectory() {
  const root = await mkdtemp(join(tmpdir(), "vcli-"));
  roots.push(root);
  return root;
}

test("the OpenCode Self-Test boundary completes its session from the module-scope event stream", async () => {
  const result = await runDriverScenario();
  const openCode = result.invocations.find((entry) => entry.review.providerId === "opencode");
  assert.equal(openCode.providerBoundaryEntries, 1);
  assert.equal(result.events.filter((event) => event.type === "session.closed").length, 3);
  assert.equal(
    result.facts.checks.every((entry) => entry.status === "pass"),
    true
  );
});

const base64url = (text) => Buffer.from(text, "utf8").toString("base64url");

test("the ID-token claim walk reaches every nested claim, breadth first, and survives deep nesting", async () => {
  const directory = await temporaryDirectory();
  // why: spelled as text, since JSON.stringify itself recurses and cannot
  // write a value this deep.
  const deep = `${"[".repeat(5000)}{"sub":"deep-subject"}${"]".repeat(5000)}`;
  const shallow = JSON.stringify({
    email: "top@example.invalid",
    nested: { org_id: "org-1", list: [{ id: "listed" }, "plain"] },
    plan: "plus"
  });
  const payload = `${shallow.slice(0, -1)},"deep":${deep}}`;
  const tokens = {
    access_token: "access",
    refresh_token: "refresh",
    id_token: `header.${base64url(payload)}.signature`,
    account_id: "account"
  };
  await writeFile(join(directory, "auth.json"), JSON.stringify({ tokens, OPENAI_API_KEY: "key" }));
  assert.deepEqual(await codexLoginSecrets(directory), [
    "access",
    "refresh",
    tokens.id_token,
    "account",
    "key",
    "top@example.invalid",
    "org-1",
    "listed",
    "deep-subject"
  ]);
});

function gateEntry(gateId, marker) {
  return { gateId, verdict: "PASS", marker };
}

test("recovered gate evidence is the latest passing entry per gate, and a missing gate is refused", async () => {
  const directory = await temporaryDirectory();
  const store = new TaskEvidenceStore(async () => directory);
  store.judging("change-1");
  await store.record(gateEntry("gate:a", 1));
  const latest = await store.record(gateEntry("gate:a", 2));
  await store.record({ gateId: "gate:b", verdict: "FAIL", marker: 3 });
  const expected = canonicalDigest({ evidenceDigests: [latest.evidenceDigest], evidenceRefs: [latest.evidenceRef] });
  assert.deepEqual(await store.recover("change-1", ["gate:a"], expected), [latest.evidenceRef]);
  await assert.rejects(store.recover("change-1", ["gate:a", "gate:b"], expected), (error) => {
    assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
    assert.equal(error.envelope.safeDetails.reason, "VES_TASK_EVIDENCE_MISSING");
    return true;
  });
  await assert.rejects(store.recover("change-2", ["gate:a"], expected), (error) => {
    assert.equal(error.envelope.safeDetails.reason, "VES_TASK_EVIDENCE_MISSING");
    return true;
  });
});

// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement this suite does not test.
const REQUIREMENT = ["VES", "EXE", "001"].join("-");

test("one mutation sensor runs the same mutation twice, each in its own scratch checkout", async () => {
  const repository = await objectFormatRepository(OBJECT_FORMATS[0]);
  const { repositoryRoot } = repository;
  await writeFile(join(repositoryRoot, "src", "value.txt"), "implemented\n");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "the task");
  const commitId = git(repositoryRoot, "rev-parse", "HEAD");
  const verificationRoot = join(repository.root, "verification");
  const sensor = new MutationSensor({
    workspace: { repositoryRoot, verificationRoot },
    runId: "run_counter",
    sourceRevision: repository.baseCommit,
    changeScope: ["src"],
    gates: [
      {
        gateId: "gate:value",
        requirementIds: [REQUIREMENT],
        declaredCommand: "node gate:value",
        commandRef: "node",
        args: [
          "-e",
          'process.exit(require("node:fs").readFileSync("src/value.txt", "utf8") === "implemented\\n" ? 0 : 1)'
        ],
        cwd: ".",
        timeoutMs: 60_000,
        outputLimitBytes: 1_000_000,
        resultProtocol: "exit-code",
        minimumTests: 0
      }
    ],
    profiles: { node: { executable: process.execPath, protocols: ["exit-code"] } }
  });
  const criterionId = `AC-${REQUIREMENT}`;
  const request = {
    commitId,
    criterion: { criterionId, requirementId: REQUIREMENT },
    mutation: {
      mutationId: `mutation:${REQUIREMENT}`,
      criterionId,
      operator: "revert-implementation",
      targetRef: "path:src/value.txt",
      expectedFailureRef: `gates:${REQUIREMENT}`
    },
    expectedOutcomeDigest: `sha256:${"0".repeat(64)}`
  };
  for (let run = 0; run < 2; run += 1) {
    const result = await sensor.run(request);
    assert.equal(result.killed, true);
    assert.equal(result.scratchIsolationVerified, true);
  }
  assert.equal(registeredWorktreeCount(repositoryRoot), 1);
  assert.deepEqual(await readdir(join(verificationRoot, ...scratchSegments("run_counter", "mutations"))), []);
});
