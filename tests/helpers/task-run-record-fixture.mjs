// invariant: the fixed inputs of the Run record suites (ADP-2). The golden
// digests those suites assert were recorded from these exact inputs, so a
// change here moves a golden for a reason that is not a change of bytes on
// disk. Nothing here is a credential, a machine-local path, or provider state.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { systemGit } from "./system-git.mjs";
import { validTaskRequest } from "./task-request-fixture.mjs";

export const WORKSPACE_ID = "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
export const OTHER_WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
export const RUN_ID = "run_018f0b6d-7b1a-7abc-8def-112345678902";
export const OTHER_RUN_ID = "run_018f0b6d-7b1a-7abc-8def-112345678903";
export const TASK_ID = "T1";
export const GRANT_ID = "grant_018f0b6d-7b1a-7abc-8def-112345678904";
export const CREATED_AT = "2026-07-15T15:00:00.000Z";
// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement these suites do not test.
const REQUIREMENT_ID = ["VES", "EXE", "001"].join("-");

const roots = [];

export async function cleanupRunRecordFixtures() {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
}

export async function temporaryRoot(prefix = "verchestra-run-record-") {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

// why: the suites compute every expected digest here, from the declared V2
// canonical contract and SHA-256 alone, never with the module under test.
export function bytesDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalDigestOf(value) {
  return bytesDigest(canonicalizeJsonV2(value));
}

export function filled(character) {
  return `sha256:${character.repeat(64)}`;
}

export function sealedText(record) {
  return `${canonicalizeJsonV2({ record, digest: canonicalDigestOf(record) })}\n`;
}

export function taskRequest(sourceRevision = "a".repeat(40)) {
  const request = validTaskRequest();
  return normalizeTaskRequest({ ...request, sourceRevision, task: { ...request.task, taskId: TASK_ID } });
}

export function contextManifest() {
  const unsigned = {
    schemaVersion: 1,
    tokenizer: { estimatorId: "fixture-estimator", version: "1" },
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    recipeId: "recipe_3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    recipeDigest: filled("a"),
    snapshotId: "snapshot_3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5c",
    fragments: [
      {
        fragmentId: "fragment_3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5d",
        content: "Task T1: set the value.",
        classification: "internal",
        trust: "untrusted-data"
      }
    ],
    omissions: [],
    sourceFindings: [],
    contradictions: [],
    retrievalGenerationRefs: [],
    policyDecisionRefs: ["policy:fixture"],
    estimatedTokens: 12,
    mandatoryTokens: 12,
    semanticObligations: ["preserve-requirement-ids", "respect-change-scope"],
    semanticObligationsDigest: filled("b"),
    serializedMeaningDigest: filled("c"),
    egressDigest: filled("d"),
    compiledAt: CREATED_AT
  };
  return { ...unsigned, manifestId: canonicalDigestOf(unsigned), keyId: "workspace-task-evidence", signature: "c2ln" };
}

export function planRecord(overrides = {}) {
  const request = overrides.request ?? taskRequest();
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    workspaceId: WORKSPACE_ID,
    createdAt: CREATED_AT,
    request,
    requestDigest: canonicalDigestOf(request),
    sourceStateDigest: filled("1"),
    contextManifestDigest: contextManifest().manifestId,
    policyViewDigest: filled("3"),
    gatePlanDigest: filled("4"),
    packageId: "f".repeat(64),
    packageDigest: filled("5"),
    approvalIntent: { action: "execution", runId: RUN_ID },
    approvalRequest: {
      approvalId: "approval_018f0b6d-7b1a-7abc-8def-112345678905",
      bindingDigest: filled("6"),
      expiresAt: "2026-07-22T15:00:00.000Z"
    },
    ...overrides
  };
}

export function taskCommit(overrides = {}) {
  return {
    commitId: "c".repeat(40),
    baseCommit: "b".repeat(40),
    gateEvidenceDigest: filled("5"),
    gateEvidenceRefs: [`gate-evidence:${"e".repeat(32)}`],
    ...overrides
  };
}

export function verificationReport(overrides = {}) {
  return {
    schemaVersion: 2,
    runId: RUN_ID,
    verdict: "PASS",
    commitId: "c".repeat(40),
    criteria: [{ criterionId: `AC-${REQUIREMENT_ID}`, satisfied: true }],
    ...overrides
  };
}

const FIXED_IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: "Verchestra Qualification",
  GIT_AUTHOR_EMAIL: "qualification@verchestra.invalid",
  GIT_AUTHOR_DATE: "1767225600 +0000",
  GIT_COMMITTER_NAME: "Verchestra Qualification",
  GIT_COMMITTER_EMAIL: "qualification@verchestra.invalid",
  GIT_COMMITTER_DATE: "1767225600 +0000"
});

function fixedGit(cwd, ...args) {
  return execFileSync(systemGit(), args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...FIXED_IDENTITY }
  }).trim();
}

// invariant: a repository whose two commits have the same object IDs on every
// machine: fixed content, identity, dates, and messages. The task commit sits
// on the task branch of the fixed run, as a verified run leaves it.
export async function deterministicTaskRepository(objectFormat) {
  const root = await temporaryRoot(`verchestra-surface-${objectFormat}-`);
  const repositoryRoot = join(root, "repository");
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  fixedGit(repositoryRoot, "init", "--quiet", `--object-format=${objectFormat}`, "-b", "main");
  if (fixedGit(repositoryRoot, "rev-parse", "--show-object-format") !== objectFormat)
    throw new Error(`the installed git did not create a ${objectFormat} repository`);
  fixedGit(repositoryRoot, "config", "core.autocrlf", "false");
  fixedGit(repositoryRoot, "config", "commit.gpgsign", "false");
  await writeFile(join(repositoryRoot, "src", "value.txt"), "base\n");
  fixedGit(repositoryRoot, "add", ".");
  fixedGit(repositoryRoot, "commit", "--quiet", "--no-verify", "-m", "base");
  const baseCommit = fixedGit(repositoryRoot, "rev-parse", "HEAD");
  await writeFile(join(repositoryRoot, "src", "value.txt"), "implemented\n");
  fixedGit(repositoryRoot, "commit", "--quiet", "--no-verify", "-am", "feat(src): implement the task");
  const commitId = fixedGit(repositoryRoot, "rev-parse", "HEAD");
  fixedGit(repositoryRoot, "update-ref", `refs/heads/vestra/${RUN_ID}/${TASK_ID}`, commitId);
  fixedGit(repositoryRoot, "reset", "--quiet", "--hard", baseCommit);
  return { root, repositoryRoot, baseCommit, commitId };
}

// hazard: the product's git keeps HOME, so a user's global git configuration
// could change the diff text a golden digest covers. Product code runs inside
// this scope with an empty configuration home; fixture git runs outside it.
export async function withEmptyGitHome(callback) {
  const home = await temporaryRoot("verchestra-git-home-");
  const keys = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = home;
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
