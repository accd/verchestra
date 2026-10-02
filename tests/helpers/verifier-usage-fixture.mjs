// invariant: the fixed pieces of the verifier usage suites: the checkpoint
// projections of one Run in a real runtime store, and a meter on that Run's
// ledger built as the task composition builds it (`meterOnRunLedger` over
// `createBudgetMeter`). The crash stand-in imports the same two, so the process
// that is killed and the process that resumes meter in exactly the same way.
import { meterOnRunLedger } from "../../apps/vestra-cli/src/task/task-budget.ts";
import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { createBudgetMeter, modelPriceTable } from "../../packages/application/src/index.ts";
import { RUN_ID, TASK_ID, WORKSPACE_ID } from "./task-run-record-fixture.mjs";

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
