import { isPricedModel } from "@verchestra/application";

import type { ProviderAuth } from "../task-provider-auth.ts";
import { notConfigured } from "./task-errors.ts";
import type { PlannedTaskRequest } from "./task-plan-record.ts";

// invariant: the models each provider runs: Claude Code the implementer, or
// every Claude Code node; Codex the verifier and every Codex node.
export function providerModels(request: PlannedTaskRequest) {
  if (request.schemaVersion === 1) return { claude: [request.driver.model], codex: [request.verifier.model] };
  const models = (driverId: string) =>
    request.execution.nodes.filter((node) => node.driver.driverId === driverId).map((node) => node.driver.model);
  return { claude: models("claude-code"), codex: [...models("codex"), request.verifier.model] };
}

// invariant: AD-084. A model with no price is reachable only on a subscription,
// where nothing is billed per token. On an API key it would stop the run at its
// first usage event with `VES_BUDGET_MODEL_UNKNOWN`, after the implementer's
// allowance was spent, so it is refused before any effect.
export function requireModelsPricedForApiKey(auth: ProviderAuth, request: PlannedTaskRequest): void {
  const { claude, codex } = providerModels(request);
  const unpriced = [
    ...(auth.implementer === "api-key" ? claude : []),
    ...(auth.verifier === "api-key" ? codex : [])
  ].filter((model) => !isPricedModel(model));
  if (unpriced.length > 0)
    throw notConfigured(
      "model-unpriced-for-api-key",
      `${[...new Set(unpriced)].join(", ")} has no price, so it runs on a subscription only`
    );
}
