import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join, relative, sep, isAbsolute } from "node:path";

import {
  IndependentVerificationCoordinator,
  type BudgetMeter,
  type TaskRunCommit,
  type TaskRunVerification,
  type VerificationPorts
} from "@verchestra/application";
import { WorkflowMachine, type RunSnapshot, type WorkflowCommand, type WorkflowDecision } from "@verchestra/domain";
import {
  NodeGateProcessRunner,
  scratchWorktreeHandle,
  type GateCommandProfile,
  type RuntimeStore
} from "@verchestra/platform-node";

import { parseVerdict, runCodexVerifier, verifierPrompt, type VerifierClaim } from "./task-codex.ts";
import { canonicalDigest, sha256, writeSealedRecord } from "./task-files.ts";
import { addDetachedWorktree, git, gitBuffer, removeWorktree } from "./task-git.ts";
import { IMPLEMENTER_ACTOR, VERIFIER_ACTOR, type TaskPlanRecord } from "./task-plan-record.ts";
import { applyWorkflow, verificationRun } from "./task-workflow.ts";
import type { TaskWorkspace } from "./task-workspace.ts";
import { readOptionalRecord } from "./task-evidence.ts";

type Row = Readonly<Record<string, unknown>>;
const MAXIMUM_EVIDENCE_FILE_BYTES = 1024 * 1024;

export interface VerifierContext {
  readonly workspace: TaskWorkspace;
  readonly plan: TaskPlanRecord;
  readonly runtime: RuntimeStore;
  readonly runDirectory: string;
  readonly gates: Readonly<Record<string, GateCommandProfile>>;
  readonly verifier:
    | { readonly executable: string; readonly credential: string }
    | { readonly executable: string; readonly identityDirectory: string };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly meter: BudgetMeter | undefined;
}

function verificationRoot(context: VerifierContext): string {
  return join(context.workspace.layout.workspaceRoot, "verification", context.plan.runId);
}

export function reportPath(runDirectory: string): string {
  return join(runDirectory, "verification", "report.json");
}

// invariant: the verification sensor compares this digest before and after
// every mutation run; the user's checkout (HEAD, index, and working tree
// status) must not move while Verchestra verifies.
async function activeStateDigest(repositoryRoot: string): Promise<`sha256:${string}`> {
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]).catch(() => "unborn");
  const status = await git(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return canonicalDigest({ head: head.trim(), status });
}

function gatePassed(result: Awaited<ReturnType<NodeGateProcessRunner["run"]>>, minimumTests: number): boolean {
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) return false;
  const tests = result.tests;
  return tests === undefined || (tests.failed === 0 && tests.passed >= minimumTests && tests.skipped === 0);
}

function within(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

class VerificationSensor {
  readonly #context: VerifierContext;
  #runs = 0;

  constructor(context: VerifierContext) {
    this.#context = context;
  }

  async run(request: Parameters<VerificationPorts["sensor"]["run"]>[0]): Promise<Row> {
    const repositoryRoot = this.#context.workspace.repositoryRoot;
    const before = await activeStateDigest(repositoryRoot);
    const id = createHash("sha256")
      .update(`${request.mutation.mutationId}:${(this.#runs += 1)}`)
      .digest("hex")
      .slice(0, 32);
    const root = join(verificationRoot(this.#context), "mutations");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const scratch = join(root, id);
    try {
      await addDetachedWorktree(repositoryRoot, scratch, request.commitId);
      const isolated = within(await realpath(root), await realpath(scratch));
      await this.#mutate(scratch, request.mutation.targetRef);
      const killed = await this.#gatesFail(root, id, request.commitId, request.criterion.requirementId);
      return {
        scratchIsolationVerified: isolated,
        killed,
        expectedFailureObserved: killed,
        evidenceRef: `mutation:${sha256(`${request.mutation.mutationId}:${String(killed)}`).slice(7, 39)}`,
        activeStateBeforeDigest: before,
        activeStateAfterDigest: await activeStateDigest(repositoryRoot)
      };
    } finally {
      await removeWorktree(repositoryRoot, scratch);
    }
  }

  // why: the mutation is the reversal of the implementation file the verifier
  // named: restore its base content, or remove it when the task created it.
  async #mutate(scratch: string, targetRef: string): Promise<void> {
    const path = targetRef.slice("path:".length);
    const scope = this.#context.plan.request.task.changeScope;
    if (!scope.some((root) => path === root || path.startsWith(`${root}/`)))
      throw Object.assign(new Error("mutation target outside scope"), { code: "VES_TASK_MUTATION_INVALID" });
    const base = this.#context.plan.request.sourceRevision;
    const existed = await git(scratch, ["cat-file", "-e", `${base}:${path}`]).then(
      () => true,
      () => false
    );
    if (existed) await git(scratch, ["checkout", base, "--", path]);
    else await git(scratch, ["rm", "-q", "--ignore-unmatch", "-f", "--", path]);
  }

  async #gatesFail(root: string, id: string, commitId: string, requirementId: string): Promise<boolean> {
    const runner = new NodeGateProcessRunner({
      repositoryRoot: this.#context.workspace.repositoryRoot,
      worktreesRoot: root,
      commands: this.#context.gates
    });
    for (const gate of this.#context.plan.request.gates.filter((entry) =>
      entry.requirementIds.includes(requirementId)
    )) {
      const result = await runner.run({ ...gate, worktreeRef: scratchWorktreeHandle({ id, commitId }) });
      if (!gatePassed(result, gate.minimumTests)) return true;
    }
    return false;
  }
}

async function inspectEvidence(
  context: VerifierContext,
  request: Parameters<VerificationPorts["evidence"]["inspect"]>[0]
) {
  let text: string;
  try {
    text = (
      await gitBuffer(
        context.workspace.repositoryRoot,
        ["cat-file", "blob", `${request.commitId}:${request.claim.file}`],
        MAXIMUM_EVIDENCE_FILE_BYTES
      )
    ).toString("utf8");
  } catch {
    return { valid: false };
  }
  const lines = text.split(/\r?\n/u);
  if (request.claim.lineEnd > lines.length) return { valid: false };
  const cited = lines.slice(request.claim.lineStart - 1, request.claim.lineEnd).join("\n");
  if (cited.trim().length === 0) return { valid: false };
  return {
    valid: true,
    commitId: request.commitId,
    expectedOutcomeDigest: request.expectedOutcomeDigest,
    assertionDigest: sha256(cited)
  };
}

function workflowPort(context: VerifierContext): VerificationPorts["workflow"] {
  return {
    apply: async (snapshot: RunSnapshot, command: WorkflowCommand): Promise<WorkflowDecision> => {
      const decided = WorkflowMachine.decide(snapshot, command);
      if (!decided.accepted) return decided;
      applyWorkflow(context.runtime, context.plan.runId, {
        type: command.type,
        actorRole: command.actorRole,
        actorId: command.actorId,
        evidence: command.evidence
      });
      return decided;
    }
  };
}

// invariant: the expected outcome is derived from the approved task alone
// (criterion, requirement, done criteria, and the commit under review), never
// from anything the verifier model said.
function expectedOutcome(plan: TaskPlanRecord, commit: TaskRunCommit, criterionId: string, requirementId: string) {
  return canonicalDigest({
    criterionId,
    requirementId,
    commitId: commit.commitId,
    doneCriteria: plan.request.task.doneCriteria
  });
}

function ports(context: VerifierContext, commit: TaskRunCommit): VerificationPorts {
  const expected = (criterion: { readonly criterionId: string; readonly requirementId: string }) =>
    expectedOutcome(context.plan, commit, criterion.criterionId, criterion.requirementId);
  const sensor = new VerificationSensor(context);
  return {
    expectations: {
      derive: async (criterion) => ({
        expectedOutcomeRef: `expected:${criterion.criterionId}`,
        expectedOutcomeDigest: expected(criterion)
      })
    },
    evidence: { inspect: (request) => inspectEvidence(context, request) },
    sensor: {
      activeStateDigest: () => activeStateDigest(context.workspace.repositoryRoot),
      run: (request) => sensor.run(request)
    },
    lessons: {
      record: async (lesson) => {
        const digest = canonicalDigest(lesson);
        await writeSealedRecord(
          join(context.runDirectory, "verification", "lessons", `${digest.slice(7, 39)}.json`),
          lesson
        );
        return { lessonRef: `lesson:${digest.slice(7, 39)}` };
      }
    },
    reports: {
      save: async (report) => {
        await writeSealedRecord(reportPath(context.runDirectory), report);
        const reportDigest = canonicalDigest(report);
        return { reportRef: `verification:${reportDigest.slice(7, 39)}`, reportDigest };
      }
    },
    workflow: workflowPort(context)
  };
}

export async function verifyReport(runDirectory: string, verification: Row): Promise<Row> {
  const report = await readOptionalRecord(reportPath(runDirectory), "verification report");
  if (report === undefined) return { valid: false, reportRef: "", reportDigest: "", verdict: "", commitId: "" };
  const reportDigest = canonicalDigest(report);
  return {
    valid:
      `verification:${reportDigest.slice(7, 39)}` === verification["reportRef"] &&
      reportDigest === verification["reportDigest"],
    reportRef: `verification:${reportDigest.slice(7, 39)}`,
    reportDigest,
    verdict: report["verdict"],
    commitId: report["commitId"]
  };
}

function verificationInput(
  context: VerifierContext,
  commit: TaskRunCommit,
  run: RunSnapshot,
  claims: readonly VerifierClaim[]
) {
  const { plan } = context;
  const criterionFor = (requirementId: string) => `AC-${requirementId}`;
  const expected = (requirementId: string) => expectedOutcome(plan, commit, criterionFor(requirementId), requirementId);
  const satisfied = claims.filter((entry) => entry.satisfied && entry.evidence !== undefined);
  return {
    schemaVersion: 2,
    workspaceId: plan.workspaceId,
    run: verificationRun(run),
    verifier: {
      actorId: VERIFIER_ACTOR,
      actorKind: "model",
      passportRef: `passport:codex:${plan.request.verifier.model}`
    },
    implementerDriverId: plan.request.driver.driverId,
    verifierDriverId: plan.request.verifier.driverId,
    packageDigest: plan.packageDigest,
    commit: {
      commitId: commit.commitId,
      authorActorId: IMPLEMENTER_ACTOR,
      gateEvidenceDigest: commit.gateEvidenceDigest
    },
    criteria: plan.request.task.requirementIds.map((requirementId) => ({
      criterionId: criterionFor(requirementId),
      requirementId,
      whenRef: `task:${plan.request.task.taskId}:delivered`,
      thenRef: `done:${requirementId}`,
      independentTestRef: `gates:${requirementId}`
    })),
    evidenceClaims: satisfied.map((entry) => ({
      criterionId: criterionFor(entry.requirementId),
      evidenceRef: `evidence:${entry.requirementId}`,
      file: entry.evidence!.file,
      lineStart: entry.evidence!.lineStart,
      lineEnd: entry.evidence!.lineEnd,
      assertionRef: `assertion:${entry.requirementId}`,
      expectedOutcomeDigest: expected(entry.requirementId)
    })),
    mutations: satisfied
      .filter((entry) => entry.implementationFile !== undefined)
      .map((entry) => ({
        mutationId: `mutation:${entry.requirementId}`,
        criterionId: criterionFor(entry.requirementId),
        operator: "revert-implementation",
        targetRef: `path:${entry.implementationFile!}`,
        expectedFailureRef: `gates:${entry.requirementId}`
      }))
  };
}

export async function verifyTask(
  context: VerifierContext,
  commit: TaskRunCommit,
  run: RunSnapshot,
  signal: AbortSignal
): Promise<TaskRunVerification> {
  const root = verificationRoot(context);
  const review = join(root, "review");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const repositoryRoot = context.workspace.repositoryRoot;
  try {
    await addDetachedWorktree(repositoryRoot, review, commit.commitId);
    const diff = await git(repositoryRoot, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      commit.baseCommit,
      commit.commitId
    ]);
    const text = await runCodexVerifier({
      workspaceId: context.plan.workspaceId,
      runId: context.plan.runId,
      manifestId: context.plan.contextManifestDigest,
      request: context.plan.request,
      ...context.verifier,
      env: context.env,
      sessionRoot: join(context.workspace.layout.sessionsRoot, `codex-${context.plan.runId}`),
      cwd: await realpath(review),
      prompt: verifierPrompt(context.plan.request, diff, commit.commitId),
      meter: context.meter,
      signal
    });
    const claims = parseVerdict(text, context.plan.request.task.requirementIds);
    const result = await new IndependentVerificationCoordinator(ports(context, commit)).verify(
      verificationInput(context, commit, run, claims)
    );
    return {
      verdict: result["verdict"] === "PASS" ? "PASS" : "FAIL",
      nextState: String(result["nextState"]),
      reportRef: String(result["reportRef"])
    };
  } finally {
    await removeWorktree(repositoryRoot, review);
  }
}
