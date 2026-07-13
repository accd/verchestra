import { buildIdempotencyKey, createEffectIntent } from "../../packages/effects/src/index.ts";
import { bindingDigest, now, runId } from "./runtime-store-fixture.mjs";

export const effectBase = Object.freeze({
  effectId: "effect_018f0b6d-7b1a-7abc-8def-0123456789ab",
  operationKind: "jira.issue.upsert",
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab",
  runId,
  logicalTarget: "jira:project/KEY/issue/external-42",
  canonicalInputDigest: bindingDigest,
  semanticIdentity: "project:KEY:external-42",
  riskTier: "high",
  grantRef: "grant_018f0b6d-7b1a-7abc-8def-3123456789ab",
  createdAt: now
});

export function effectIntent(overrides = {}) {
  const input = { ...effectBase, ...overrides };
  return createEffectIntent({ ...input, idempotencyKey: buildIdempotencyKey(input) });
}
