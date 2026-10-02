// invariant: the fixed pieces of the run usage suites: the checkpoint
// projections of one Run in a real runtime store, a meter on that Run's ledger
// built as the task composition builds it (`meterOnRunLedger` and
// `recordingMeter` over `createBudgetMeter`), and a task run composed from
// them. The crash stand-in imports the same pieces, so the process that is
// killed and the process that resumes meter in exactly the same way.
import { meterOnRunLedger, recordingMeter } from "../../apps/vestra-cli/src/task/task-budget.ts";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import {
  TaskRunCoordinator,
  TaskRunError,
  createBudgetMeter,
  modelPriceTable
} from "../../packages/application/src/index.ts";
import { WorkflowMachine } from "../../packages/domain/src/index.ts";
import { RUN_ID, TASK_ID, WORKSPACE_ID, filled } from "./task-run-record-fixture.mjs";

// why: the models and the usage of the labeled fakes in tests/helpers/task-cli-fakes.
// The implementer reports 11 input and 7 output tokens, the verifier 5 and 3.
export const IMPLEMENTER = Object.freeze({ model: "claude-sonnet-5", inputTokens: 11, outputTokens: 7 });
export const VERIFIER = Object.freeze({ model: "gpt-5.2-codex", inputTokens: 5, outputTokens: 3 });
export const IMPLEMENTER_TOKENS = IMPLEMENTER.inputTokens + IMPLEMENTER.outputTokens;
export const VERIFIER_TOKENS = VERIFIER.inputTokens + VERIFIER.outputTokens;
export const BUDGETS = Object.freeze({ maximumCostUsd: 10, maximumTokens: 1_000_000, maximumDurationMs: 600_000 });

// why: the cost the product's own price table gives one usage event, computed
// here from the table's rates and never read back from a meter.
export function priced({ model, inputTokens, outputTokens }) {
  const { inputPerMToken, outputPerMToken } = modelPriceTable.models[model];
  return (inputTokens * inputPerMToken + outputTokens * outputPerMToken) / 1_000_000;
}

export function runCheckpoints(store, tasksRoot) {
  return openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID).checkpoints(store, TASK_ID);
}

export function meterOptions(metering = {}) {
  return {
    budgets: { ...BUDGETS, ...metering.budgets },
    priceTable: modelPriceTable,
    ...(metering.unbilledModels === undefined ? {} : { unbilledModels: metering.unbilledModels }),
    ...(metering.now === undefined ? {} : { now: metering.now })
  };
}

// invariant: `work` gets the meter the task composition hands the verifier.
export function meteredOnLedger(checkpoints, metering, work) {
  return meterOnRunLedger(
    checkpoints,
    (resume) => createBudgetMeter({ ...meterOptions(metering), ...(resume === undefined ? {} : { resume }) }),
    work
  );
}

const BINDING = filled("a");
const EXECUTION = Object.freeze({
  worktreeRef: `worktree:${"1".repeat(32)}:${"b".repeat(40)}`,
  baseCommit: "b".repeat(40),
  coordinationRef: "lease:1",
  changeDigest: filled("9"),
  changedPaths: ["src/value.txt"],
  checkpointRef: "checkpoint:executor:1"
});
const COMMIT = Object.freeze({
  commitId: "d".repeat(40),
  baseCommit: "b".repeat(40),
  gateEvidenceDigest: filled("e"),
  gateEvidenceRefs: ["gate-evidence:1"]
});

// why: the gate checkpoint a committed task leaves, written through the
// store's own port as the gate coordinator writes it.
export function commitGate(checkpoints) {
  return checkpoints.gatePort().save({
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    taskId: TASK_ID,
    gatePlanDigest: filled("4"),
    changeDigest: EXECUTION.changeDigest,
    stage: "committed",
    commitId: COMMIT.commitId,
    idempotencyKey: filled("3")
  });
}

// why: the workflow state of one run, kept outside a composition so the
// composition that resumes the run finds the state the interrupted one left.
export function workflowOf(state = "EXECUTION_AUTHORIZED") {
  return {
    current: Object.freeze({
      runId: RUN_ID,
      runKind: "feature",
      state,
      version: 2,
      repairCycles: 0,
      approval: { bindingDigest: BINDING }
    })
  };
}

// invariant: a task run composed in this process the way `TaskRunComposition`
// composes it: the production task run coordinator, repair loop, workflow
// machine and budget module over the Run record's checkpoint projections in a
// real runtime store. The loop's meter records on the Run's ledger and
// verification is the metered work, exactly as in the composition. Only the
// two providers and the gate are scripted: `implement` and `verify` receive
// the meter a provider's usage is reported to.
// why: a new composition over the same store and workflow is a resumed run.
export function composedRun(checkpoints, workflow, script = {}) {
  const calls = { implemented: 0, gated: 0, verified: 0, released: 0 };
  const gateResults = [...(script.gateResults ?? [])];
  const create = (resume) =>
    createBudgetMeter({ ...meterOptions(script.metering), ...(resume === undefined ? {} : { resume }) });
  const decide = (command) => {
    const decision = WorkflowMachine.decide(workflow.current, {
      ...command,
      expectedVersion: workflow.current.version
    });
    if (!decision.accepted) throw new TaskRunError("VES_TASK_RUN_WORKFLOW_REJECTED", decision.code);
    workflow.current = decision.snapshot;
    return decision;
  };
  const ports = {
    workflow: { current: async () => workflow.current, apply: async (command) => decide(command).snapshot },
    execution: {
      resumable: async () => (script.resumable === true ? EXECUTION : undefined),
      execute: async ({ budgetMeter }) => {
        calls.implemented += 1;
        await script.implement?.(budgetMeter, calls.implemented);
        return EXECUTION;
      }
    },
    gates: {
      committed: async () => (checkpoints.gate()?.stage === "committed" ? COMMIT : undefined),
      commit: async () => {
        calls.gated += 1;
        if ((gateResults.shift() ?? "pass") !== "pass")
          return { passed: false, failure: { failedGateId: "gate:test", evidenceRef: "gate-evidence:fail" } };
        await commitGate(checkpoints);
        return { passed: true, commit: COMMIT };
      }
    },
    repair: {
      ...checkpoints.repairPort(),
      budget: { create: (resume) => recordingMeter(checkpoints, create(resume)) },
      buildFeedback: async () => ({ feedbackRef: "feedback:1", feedbackDigest: filled("7"), bytes: 32 }),
      sealAttempt: async ({ attempt }) => ({ capsuleDigest: filled(String(attempt)) })
    },
    verification: {
      verify: () =>
        meterOnRunLedger(checkpoints, create, async (meter) => {
          calls.verified += 1;
          await script.verify?.(meter);
          const decision = decide({
            type: "PASS_VERIFICATION",
            actorRole: "verifier",
            actorId: "actor:codex-verifier",
            evidence: ["verification-evidence"]
          });
          return { verdict: "PASS", nextState: decision.nextState, reportRef: "verification:report:1" };
        })
    },
    release: async () => {
      calls.released += 1;
    }
  };
  const run = () =>
    new TaskRunCoordinator(ports).run({
      bindingDigest: BINDING,
      implementerActorId: "actor:claude-code-implementer",
      cancelActorId: "human:local-operator",
      ...(script.onGateFailure === undefined ? {} : { onGateFailure: script.onGateFailure }),
      signal: new AbortController().signal
    });
  return { calls, run };
}
