import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityModelRouter, ModelRouterError } from "../../packages/agent-runtime/src/index.ts";
import { IDS, passports, resolver, role, routeInput } from "../helpers/model-router-fixture.mjs";
import { withHostileLocaleCompare } from "../helpers/hostile-locale.mjs";

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [value, ...tail])
  );
}

const invalidRoles = [
  ["machine", { machineId: "machine-bad" }],
  ["empty roles", { roles: [] }],
  ["role id", { roles: [role("Planning")] }],
  ["capabilities", { roles: [role("planning", { requiredCapabilities: [] })] }],
  ["risk", { roles: [role("planning", { riskTier: "critical" })] }],
  ["input capacity", { roles: [role("planning", { minimumInputTokens: 0 })] }],
  ["output capacity", { roles: [role("planning", { minimumOutputTokens: -1 })] }],
  ["transport", { roles: [role("planning", { allowedTransports: ["browser"] })] }],
  [
    "retention",
    { roles: [role("planning", { dataHandling: { ...role("planning").dataHandling, allowedRetention: [] } })] }
  ],
  ["independence mode", { roles: [role("planning", { independence: { mode: "maybe" } })] }],
  [
    "missing independence role",
    { roles: [role("planning", { independence: { mode: "required", fromRole: "validator" } })] }
  ],
  ["duplicate role", { roles: [role("planning"), role("planning")] }]
];

for (const [name, override] of invalidRoles) {
  test(`router rejects invalid ${name}`, async () => {
    await assert.rejects(
      new CapabilityModelRouter({ passports: resolver([passports.claude()]) }).route(
        routeInput([role("planning")], override)
      ),
      (error) => error instanceof ModelRouterError && error.code === "VES_MODEL_ROUTE_INVALID"
    );
  });
}

const hardFilters = [
  [
    "capability",
    (value) => ({
      ...value,
      observedCapabilities: value.observedCapabilities.filter((entry) => entry.capability !== "planning")
    }),
    "missing-capability"
  ],
  ["risk", (value) => ({ ...value, eligibleRiskTiers: ["low"] }), "risk-tier"],
  [
    "input capacity",
    (value) => ({ ...value, contextCapacity: { ...value.contextCapacity, maximumInputTokens: 1000 } }),
    "input-capacity"
  ],
  [
    "output capacity",
    (value) => ({ ...value, contextCapacity: { ...value.contextCapacity, maximumOutputTokens: 1000 } }),
    "output-capacity"
  ],
  [
    "training",
    (value) => ({ ...value, dataHandling: { ...value.dataHandling, training: "provider-policy" } }),
    "training-policy"
  ],
  [
    "retention",
    (value) => ({ ...value, dataHandling: { ...value.dataHandling, retention: "provider-policy" } }),
    "retention-policy"
  ],
  ["region", (value) => ({ ...value, dataHandling: { ...value.dataHandling, region: "us" } }), "region"],
  [
    "transport",
    (value) => ({ ...value, endpointIdentity: { ...value.endpointIdentity, transport: "remote-api" } }),
    "transport"
  ],
  ["degraded forbidden", (value) => ({ ...value, status: "degraded" }), "degraded-status"],
  ["confidence", (value) => ({ ...value, confidence: 0.4 }), "minimum-confidence"]
];

for (const [name, mutate, code] of hardFilters) {
  test(`hard filter excludes ${name} before ranking`, async () => {
    const inputRole = role("planning", {
      allowedTransports: ["local-cli"],
      allowDegraded: false,
      minimumConfidence: 0.8,
      preferredProviders: ["anthropic"]
    });
    await assert.rejects(
      new CapabilityModelRouter({ passports: resolver([mutate(passports.claude())]) }).route(routeInput([inputRole])),
      (error) => error.code === "VES_MODEL_NO_ELIGIBLE" && error.exclusions[0].reasons.includes(code)
    );
  });
}

test("Claude plus Codex selects independent planner and validator exactly", async () => {
  const router = new CapabilityModelRouter({ passports: resolver([passports.claude(), passports.codex()]) });
  const result = await router.route(
    routeInput([
      role("planning", { preferredProviders: ["anthropic"] }),
      role("validation", { independence: { mode: "required", fromRole: "planning" }, preferredProviders: ["openai"] })
    ])
  );
  assert.deepEqual(
    result.selections.map((entry) => entry.passportId),
    [IDS.claude, IDS.codex]
  );
});

test("only Claude fails exact required independence", async () => {
  const router = new CapabilityModelRouter({ passports: resolver([passports.claude()]) });
  await assert.rejects(
    router.route(
      routeInput([
        role("planning"),
        role("implementation", { independence: { mode: "required", fromRole: "planning" } })
      ])
    ),
    (error) => error.code === "VES_MODEL_NO_ELIGIBLE" && error.roleId === "implementation"
  );
});

test("only Codex resolves all compatible non-independent roles", async () => {
  const result = await new CapabilityModelRouter({ passports: resolver([passports.codex()]) }).route(
    routeInput([role("planning"), role("validation")])
  );
  assert.deepEqual(
    result.selections.map((entry) => entry.passportId),
    [IDS.codex, IDS.codex]
  );
});

test("OpenCode Qwen is selected for implementation", async () => {
  const result = await new CapabilityModelRouter({ passports: resolver([passports.qwen()]) }).route(
    routeInput([role("implementation", { preferredProviders: ["company-qwen"] })])
  );
  assert.equal(result.selections[0].passportId, IDS.qwen);
});

test("API-only profile is selected only when remote transport and region are allowed", async () => {
  const result = await new CapabilityModelRouter({ passports: resolver([passports.api()]) }).route(
    routeInput([
      role("planning", {
        allowedTransports: ["remote-api"],
        dataHandling: { requireTrainingDisabled: true, allowedRetention: ["none"], allowedRegions: ["local"] }
      })
    ])
  );
  assert.equal(result.selections[0].passportId, IDS.api);
});

test("no-writer profile returns explainable no-eligible error", async () => {
  await assert.rejects(
    new CapabilityModelRouter({ passports: resolver([passports.claude()]) }).route(
      routeInput([role("writer", { requiredCapabilities: ["write-effects"] })])
    ),
    (error) => error.code === "VES_MODEL_NO_ELIGIBLE" && error.exclusions[0].reasons.includes("missing-capability")
  );
});

test("preferred independence degrades explicitly when only one class exists", async () => {
  const result = await new CapabilityModelRouter({ passports: resolver([passports.codex()]) }).route(
    routeInput([role("planning"), role("validation", { independence: { mode: "preferred", fromRole: "planning" } })])
  );
  assert.equal(result.selections[1].independence, "degraded");
});

test("missing local Machine index fails before Passport resolution", async () => {
  await assert.rejects(
    new CapabilityModelRouter({ passports: resolver([]) }).route({
      machineId: "machine_018f0000-0000-7000-8000-000000009999",
      roles: [role("planning")]
    }),
    (error) => error.code === "VES_MODEL_PROFILE_UNAVAILABLE"
  );
});

test("Machine Profile revision mismatch is excluded explicitly", async () => {
  const current = { ...passports.claude(), revision: 2 };
  const passportPort = {
    machineIndex: async () => ({
      schemaVersion: 1,
      machineId: routeInput([]).machineId,
      passports: [{ passportId: current.passportId, revision: 1 }]
    }),
    current: async () => current
  };
  await assert.rejects(
    new CapabilityModelRouter({ passports: passportPort }).route(routeInput([role("planning")])),
    (error) =>
      error.code === "VES_MODEL_NO_ELIGIBLE" && error.exclusions[0].reasons.includes("profile-revision-mismatch")
  );
});

test("non-current Machine Profile reference is excluded explicitly", async () => {
  const reference = passports.claude();
  const passportPort = {
    machineIndex: async () => ({
      schemaVersion: 1,
      machineId: routeInput([]).machineId,
      passports: [{ passportId: reference.passportId, revision: 1 }]
    }),
    current: async () => undefined
  };
  await assert.rejects(
    new CapabilityModelRouter({ passports: passportPort }).route(routeInput([role("planning")])),
    (error) => error.code === "VES_MODEL_NO_ELIGIBLE" && error.exclusions[0].reasons.includes("not-current")
  );
});

for (const [index, order] of permutations([passports.claude(), passports.codex(), passports.qwen()]).entries()) {
  test(`property: candidate order cannot change explainable selection ${index + 1}`, async () => {
    const result = await new CapabilityModelRouter({ passports: resolver(order) }).route(
      routeInput([role("implementation", { preferredProviders: ["company-qwen", "openai", "anthropic"] })])
    );
    assert.equal(result.selections[0].passportId, IDS.qwen);
    assert.deepEqual(result.selections[0].ranking, [0, 0, 0, 0, -0.91, -180000, IDS.qwen]);
  });
}

const rankingCases = [
  [
    "provider preference",
    [passports.claude(), passports.codex()],
    role("planning", { preferredProviders: ["openai", "anthropic"] }),
    IDS.codex
  ],
  [
    "resolved model preference",
    [
      passports.claude(),
      {
        ...passports.claude(),
        passportId: "passport_018f0000-0000-7000-8000-000000001341",
        resolvedModelId: "claude-opus-special"
      }
    ],
    role("planning", { preferredModels: ["claude-opus-special"] }),
    "passport_018f0000-0000-7000-8000-000000001341"
  ],
  [
    "qualified status",
    [
      { ...passports.claude(), confidence: 0.8 },
      {
        ...passports.claude(),
        passportId: "passport_018f0000-0000-7000-8000-000000001342",
        status: "degraded",
        confidence: 1
      }
    ],
    role("planning"),
    IDS.claude
  ],
  [
    "higher confidence",
    [
      { ...passports.claude(), confidence: 0.8 },
      { ...passports.claude(), passportId: "passport_018f0000-0000-7000-8000-000000001343", confidence: 0.9 }
    ],
    role("planning"),
    "passport_018f0000-0000-7000-8000-000000001343"
  ],
  [
    "larger verified context",
    [
      { ...passports.claude(), confidence: 0.9 },
      {
        ...passports.claude(),
        passportId: "passport_018f0000-0000-7000-8000-000000001344",
        confidence: 0.9,
        contextCapacity: { ...passports.claude().contextCapacity, maximumInputTokens: 200000 }
      }
    ],
    role("planning"),
    "passport_018f0000-0000-7000-8000-000000001344"
  ]
];

for (const [name, candidates, requirement, expected] of rankingCases) {
  test(`explainable ranking selects ${name}`, async () => {
    const result = await new CapabilityModelRouter({ passports: resolver(candidates) }).route(
      routeInput([requirement])
    );
    assert.equal(result.selections[0].passportId, expected);
  });
}

// Issue #58: a routing decision is a trust-relevant identity. model-router.ts
// used to break a rank tie, order the candidate list, and order the reported
// exclusions with ambient localeCompare, so the same Local Machine Profile
// could route the same role to a different provider on another machine. The
// twin below ties with IDS.claude on independence, status, preference,
// confidence and capacity, leaving the Passport ID as the only discriminator.
const TWIN = "passport_018f0000-0000-7000-8000-000000001300";
const twinCandidates = () => [passports.claude(), { ...passports.claude(), passportId: TWIN }];

test("a rank tie resolves to the same Passport across two divergent locale collations", async () => {
  const route = () =>
    new CapabilityModelRouter({ passports: resolver(twinCandidates()) }).route(routeInput([role("planning")]));
  const plain = await route();
  const hostile = await withHostileLocaleCompare(route);
  // Code-unit order specifically: the tie is broken by the smaller ID, never
  // by whichever candidate the machine's collation happened to place first.
  assert.equal(plain.selections[0].passportId, TWIN);
  assert.equal(hostile.selections[0].passportId, plain.selections[0].passportId);
  assert.deepEqual(hostile.selections[0].ranking, plain.selections[0].ranking);
});

test("the reported exclusion order is identical across two divergent locale collations", async () => {
  const refuse = async () => {
    try {
      await new CapabilityModelRouter({ passports: resolver(twinCandidates()) }).route(
        routeInput([role("writer", { requiredCapabilities: ["write-effects"] })])
      );
    } catch (error) {
      return error.exclusions.map((entry) => entry.passportId);
    }
    throw new Error("expected VES_MODEL_NO_ELIGIBLE");
  };
  const plain = await refuse();
  assert.deepEqual(plain, [TWIN, IDS.claude]);
  assert.deepEqual(await withHostileLocaleCompare(refuse), plain);
});
