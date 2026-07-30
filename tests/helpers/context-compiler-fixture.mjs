import { ContextSnapshotResolver } from "../../packages/agent-runtime/src/index.ts";
import {
  digest,
  evaluatedAt,
  observation,
  ports,
  recipe,
  selector,
  stable,
  workspaceId
} from "./context-source-fixture.mjs";

export const runId = stable("run", 802);

export function compilerRecipe(overrides = {}) {
  return recipe({
    requiredSources: [selector("repository", 11, { priority: "mandatory" })],
    optionalSources: [
      selector("tracker", 12, { priority: "high" }),
      selector("knowledge", 13, { priority: "medium" }),
      selector("memory", 14, { priority: "low" })
    ],
    priorityBudgets: [
      { priority: "mandatory", maximumTokens: 100 },
      { priority: "high", maximumTokens: 100 },
      { priority: "medium", maximumTokens: 100 },
      { priority: "low", maximumTokens: 100 }
    ],
    ...overrides
  });
}

export async function snapshotFixture(options = {}) {
  const inputRecipe = options.recipe ?? compilerRecipe();
  const sourcePorts = ports(options.ports ?? {});
  const snapshot = await new ContextSnapshotResolver({ digest, sources: sourcePorts }).resolve({
    workspaceId,
    recipe: inputRecipe,
    evaluatedAt
  });
  return { inputRecipe, snapshot };
}

export function compilerFixture(overrides = {}) {
  const calls = [];
  const egress = {
    async authorize(input) {
      calls.push({ kind: "egress", input });
      return {
        allowed: true,
        code: "VES_EGRESS_ALLOWED",
        egressDigest: digest.sha256(JSON.stringify(input.fragments.map((entry) => entry.fragmentId))),
        policyEvidenceDigest: digest.sha256("policy")
      };
    }
  };
  const signer = {
    async sign(input) {
      calls.push({ kind: "sign", input });
      return { keyId: "context-key:1", signature: digest.sha256(JSON.stringify(input)) };
    }
  };
  return {
    digest,
    egress,
    signer,
    estimateTokens: (content) => Math.max(1, Math.ceil(content.length / 4)),
    tokenEstimatorId: "chars-div-4@1",
    calls,
    ...overrides
  };
}

export function compileInput(inputRecipe, snapshot, overrides = {}) {
  return {
    workspaceId,
    runId,
    recipe: inputRecipe,
    snapshot,
    capacityTokens: 1000,
    networkMode: "online",
    destinationId: "destination:model-api",
    retention: "none",
    approvalRef: "approval:context",
    capabilityRef: "capability:context",
    ...overrides
  };
}

export function manyFragments(kind, count, content = (index) => `${kind} fragment ${index}`) {
  return observation(kind, 900, {
    fragments: Array.from({ length: count }, (_, index) => ({
      fragmentId: stable("fragment", 900 + index),
      content: content(index),
      classification: "internal",
      trust: kind === "repository" ? "verified-evidence" : "untrusted-data",
      claims: []
    }))
  });
}
