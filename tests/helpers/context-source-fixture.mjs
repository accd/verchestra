import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";

export const digest = new NodeContentDigest();
export const workspaceId = "workspace_018f0000-0000-7000-8000-000000000101";
export const evaluatedAt = "2026-07-13T14:00:00.000Z";

export function stable(kind, value) {
  return `${kind}_018f0000-0000-7000-8000-${String(value).padStart(12, "0")}`;
}

export function selector(kind, index, overrides = {}) {
  return {
    selectorId: stable("selector", index),
    sourceKind: kind,
    sourceId: `${kind}:primary`,
    query: { scope: "project:core", terms: ["architecture", "requirements"] },
    maximumAgeSeconds: 7200,
    classification: "internal",
    ...overrides
  };
}

export function recipe(overrides = {}) {
  return {
    schemaVersion: 1,
    recipeId: stable("recipe", 1),
    taskId: stable("task", 2),
    requiredSources: [selector("repository", 11), selector("tracker", 12)],
    optionalSources: [selector("knowledge", 13), selector("memory", 14)],
    semanticObligations: ["preserve-requirement-ids", "report-uncertainty"],
    priorityBudgets: [{ priority: "mandatory", maximumTokens: 8000 }],
    freshnessPolicy: { defaultMaximumAgeSeconds: 7200 },
    trustPolicyRef: "trust-policy:workspace-v1",
    egressPurpose: "model-inference",
    ...overrides
  };
}

export function observation(kind, index, overrides = {}) {
  return {
    source: { kind, identity: `${kind}:primary`, revision: `revision-${index}` },
    retrievedAt: "2026-07-13T13:00:00.000Z",
    scope: "project:core",
    fragments: [
      {
        fragmentId: stable("fragment", index),
        content: `${kind} evidence ${index}`,
        classification: "internal",
        trust: kind === "repository" ? "verified-evidence" : "untrusted-data",
        claims: [{ factKey: "system:runtime", value: "node-24" }]
      }
    ],
    ...overrides
  };
}

export function ports(overrides = {}) {
  const calls = [];
  const result = {};
  for (const [index, kind] of ["repository", "tracker", "knowledge", "memory"].entries()) {
    result[kind] = {
      async resolve(query) {
        calls.push({ kind, query });
        return observation(kind, 100 + index);
      }
    };
  }
  return { ...result, ...overrides, calls };
}
