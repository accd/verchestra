import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS,
  MachineBootstrapService,
  bootstrapPublicErrorRegistry
} from "../../packages/application/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";
import {
  MemoryProfileStore,
  canonicalConfig,
  claude,
  codex,
  executeInput,
  machineId,
  passport,
  qwen,
  serviceOptions,
  workspaceId
} from "../helpers/machine-bootstrap-fixture.mjs";

test("incompatible minimum CLI fails before discovery or profile mutation", async () => {
  let discoveries = 0;
  const store = new MemoryProfileStore();
  const service = new MachineBootstrapService({
    discovery: { discover: async () => ((discoveries += 1), []) },
    secrets: { expectedStore: "store", isBound: async () => false },
    profiles: store,
    now: () => "2026-07-13T00:00:00.000Z"
  });
  await assert.rejects(service.execute(executeInput(canonicalConfig({ minimumCliVersion: "2.0.0" }))), {
    code: "VES_BOOTSTRAP_CONFIG_INCOMPATIBLE",
    minimumCliVersion: "2.0.0"
  });
  assert.equal(discoveries, 0);
  assert.equal(store.writes, 0);
});

test("unsupported canonical config generation fails before discovery", async () => {
  const { service, store } = serviceOptions(MachineBootstrapService, [claude()]);
  await assert.rejects(service.execute(executeInput(canonicalConfig({ configVersion: 2 }))), {
    code: "VES_BOOTSTRAP_CONFIG_INCOMPATIBLE"
  });
  assert.equal(store.writes, 0);
});

for (const [name, overrides] of [
  ["workspace identity", { workspaceId: "workspace_invalid" }],
  [
    "duplicate roles",
    {
      roles: [
        { roleId: "same", requiredCapabilities: ["plan"], independence: "none" },
        { roleId: "same", requiredCapabilities: ["review"], independence: "none" }
      ]
    }
  ],
  [
    "unknown independence role",
    {
      roles: [
        {
          roleId: "validator",
          requiredCapabilities: ["review"],
          independence: "required",
          independentFromRole: "missing"
        }
      ]
    }
  ]
]) {
  test(`invalid canonical ${name} is rejected`, async () => {
    const { service } = serviceOptions(MachineBootstrapService, [claude()]);
    await assert.rejects(service.execute(executeInput(canonicalConfig(overrides))), {
      code: "VES_BOOTSTRAP_INPUT_INVALID"
    });
  });
}

test("qualified local drivers and Passports are detected in stable order", async () => {
  const { service, store } = serviceOptions(MachineBootstrapService, [codex(), claude()]);
  const result = await service.execute(executeInput());
  assert.deepEqual(result.detectedDriverIds, ["claude-code", "codex"]);
  assert.deepEqual(
    store.profile.drivers.map((driver) => driver.driverId),
    ["claude-code", "codex"]
  );
});

test("unqualified Passport is detected but excluded from local eligibility", async () => {
  const unqualified = claude();
  unqualified.passport.qualificationStatus = "unqualified";
  const { service, store } = serviceOptions(MachineBootstrapService, [unqualified]);
  const result = await service.execute(executeInput());
  assert.deepEqual(result.detectedDriverIds, ["claude-code"]);
  assert.deepEqual(store.profile.drivers, []);
  assert.equal(result.status, "blocked");
});

test("expired Passport is excluded before role resolution", async () => {
  const expired = claude();
  expired.passport.validUntil = "2026-01-01T00:00:00.000Z";
  const { service, store } = serviceOptions(MachineBootstrapService, [expired]);
  const result = await service.execute(executeInput());
  assert.deepEqual(store.profile.drivers, []);
  assert.equal(
    result.roles.every((role) => role.status === "blocked"),
    true
  );
});

test("missing required capability blocks the exact role", async () => {
  const candidate = passport("claude-code", "anthropic", "claude-opus", ["plan"]);
  const { service } = serviceOptions(MachineBootstrapService, [candidate]);
  const result = await service.execute(executeInput());
  assert.deepEqual(
    result.roles.find((role) => role.roleId === "validator"),
    {
      roleId: "validator",
      status: "blocked",
      eligiblePassportIds: [],
      failedRequirements: ["capability:review"]
    }
  );
});

test("Claude plus Codex satisfies preferred independent planning and validation", async () => {
  const { service } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const result = await service.execute(executeInput());
  assert.equal(result.status, "ready");
  assert.equal(result.roles.find((role) => role.roleId === "validator").status, "ready");
});

test("Claude-only machine reports degraded preferred independence", async () => {
  const { service } = serviceOptions(MachineBootstrapService, [claude()]);
  const result = await service.execute(executeInput());
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.roles.find((role) => role.roleId === "validator").failedRequirements, [
    "preferred-independence:orchestrator"
  ]);
});

test("mandatory independence blocks a single-provider machine", async () => {
  const roles = canonicalConfig().roles.map((role) =>
    role.roleId === "validator" ? { ...role, independence: "required" } : role
  );
  const { service } = serviceOptions(MachineBootstrapService, [claude()]);
  const result = await service.execute(executeInput(canonicalConfig({ roles })));
  assert.equal(result.status, "blocked");
  assert.equal(result.roles.find((role) => role.roleId === "validator").status, "blocked");
});

test("OpenCode Qwen-only machine remains eligible and reports degraded independence", async () => {
  const { service, store } = serviceOptions(MachineBootstrapService, [qwen()]);
  const result = await service.execute(executeInput());
  assert.equal(result.status, "degraded");
  assert.deepEqual(
    store.profile.drivers.map((driver) => [driver.driverId, driver.passport.modelId]),
    [["opencode", "qwen3-coder"]]
  );
});

test("missing mandatory secret reports only safe logical binding guidance", async () => {
  const requiredSecrets = [
    { logicalName: "jira.token", purpose: "Publish Jira projection", blockedCapability: "jira-write", required: true }
  ];
  const { service } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const result = await service.execute(executeInput(canonicalConfig({ requiredSecrets })));
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missingBindings, [
    {
      logicalName: "jira.token",
      expectedStore: "OS secret store: verchestra/<workspace>/<logical-name>",
      purpose: "Publish Jira projection",
      blockedCapability: "jira-write",
      required: true
    }
  ]);
});

test("missing optional secret is reported without blocking readiness", async () => {
  const requiredSecrets = [
    { logicalName: "optional.token", purpose: "Optional integration", blockedCapability: "optional", required: false }
  ];
  const { service } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const result = await service.execute(executeInput(canonicalConfig({ requiredSecrets })));
  assert.equal(result.status, "ready");
  assert.equal(result.missingBindings[0].required, false);
});

test("bound secret produces no missing-binding record", async () => {
  const requiredSecrets = [{ logicalName: "jira.token", purpose: "Jira", blockedCapability: "jira", required: true }];
  const { service } = serviceOptions(MachineBootstrapService, [claude(), codex()], {
    boundSecrets: ["jira.token"]
  });
  const result = await service.execute(executeInput(canonicalConfig({ requiredSecrets })));
  assert.deepEqual(result.missingBindings, []);
  assert.equal(result.status, "ready");
});

test("database registration derives a read-only logical credential binding", async () => {
  const databases = [
    {
      databaseId: "orders-prod",
      engine: "postgresql",
      logicalEnvironment: "production",
      approvedSchemas: ["reporting"],
      classification: "confidential",
      schemaSources: ["docs/er/orders.md"],
      purposes: ["discovery"],
      credentialLogicalNames: ["db.orders.readonly"]
    }
  ];
  const { service } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const result = await service.execute(executeInput(canonicalConfig({ databases })));
  assert.deepEqual(result.missingBindings[0], {
    logicalName: "db.orders.readonly",
    expectedStore: "OS secret store: verchestra/<workspace>/<logical-name>",
    purpose: "Read-only Data Probe for orders-prod",
    blockedCapability: "data-probe:orders-prod",
    required: true
  });
});

test("database registration rejects embedded connection material", async () => {
  const database = {
    databaseId: "orders",
    engine: "postgresql",
    logicalEnvironment: "prod",
    approvedSchemas: ["public"],
    classification: "internal",
    schemaSources: ["docs/er.md"],
    purposes: ["discovery"],
    credentialLogicalNames: ["db.orders"],
    connectionString: "postgres://secret@host/db"
  };
  const { service } = serviceOptions(MachineBootstrapService, [claude()]);
  await assert.rejects(service.execute(executeInput(canonicalConfig({ databases: [database] }))), {
    code: "VES_BOOTSTRAP_INPUT_INVALID"
  });
});

test("database registration requires approved schemas and schema sources", async () => {
  const database = {
    databaseId: "orders",
    engine: "postgresql",
    logicalEnvironment: "prod",
    approvedSchemas: [],
    classification: "internal",
    schemaSources: [],
    purposes: ["discovery"],
    credentialLogicalNames: ["db.orders"]
  };
  const { service } = serviceOptions(MachineBootstrapService, [claude()]);
  await assert.rejects(service.execute(executeInput(canonicalConfig({ databases: [database] }))), {
    code: "VES_BOOTSTRAP_INPUT_INVALID"
  });
});

test("candidate input order cannot change the persisted local profile", async () => {
  const left = serviceOptions(MachineBootstrapService, [codex(), claude()]);
  const right = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const leftResult = await left.service.execute(executeInput());
  const rightResult = await right.service.execute(executeInput());
  assert.deepEqual(left.store.profile, right.store.profile);
  assert.equal(leftResult.profileDigest, rightResult.profileDigest);
});

// Issue #58: every ordering machine-bootstrap.ts produces (detected Driver
// ids, eligible Drivers, Passport capabilities, Role bindings, secret
// requirements) ends up inside the Machine Profile that is persisted and
// digested, and each of them used to be decided by
// String.prototype.localeCompare. Replacing that comparator with one that
// reverses UTF-16 code-unit order simulates a divergent locale collation
// without depending on any particular installed ICU locale disagreeing today.
async function underHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

test("the persisted Machine Profile and its digest are identical under a divergent locale collation", async () => {
  // "plan", "plan-review", and "planreview" differ only by an ASCII hyphen —
  // exactly the character a locale-aware collation is free to reorder or
  // treat as ignorable, and the reason this ordering may not be ambient.
  const capable = () => passport("opencode", "qwen", "qwen3-coder", ["plan", "planreview", "plan-review", "review"]);
  const candidates = [capable(), codex(), claude()];
  const plain = serviceOptions(MachineBootstrapService, candidates);
  const hostile = serviceOptions(MachineBootstrapService, candidates);
  const plainResult = await plain.service.execute(executeInput());
  const hostileResult = await underHostileLocaleCompare(() => hostile.service.execute(executeInput()));

  assert.deepEqual(hostile.store.profile, plain.store.profile);
  assert.equal(hostileResult.profileDigest, plainResult.profileDigest);
  assert.deepEqual(hostileResult.detectedDriverIds, plainResult.detectedDriverIds);
  // Code-unit order specifically, so the assertion fails if the ordering is
  // ever re-derived from something other than the identifiers themselves.
  assert.deepEqual(plainResult.detectedDriverIds, ["claude-code", "codex", "opencode"]);
  assert.deepEqual(
    plain.store.profile.drivers.map((entry) => entry.driverId),
    ["claude-code", "codex", "opencode"]
  );
  assert.deepEqual(plain.store.profile.drivers.find((entry) => entry.driverId === "opencode").passport.capabilities, [
    "plan",
    "plan-review",
    "planreview",
    "review"
  ]);
  assert.deepEqual(
    plain.store.profile.roles.map((entry) => entry.roleId),
    ["orchestrator", "validator"]
  );
});

test("one logical secret declared twice in a different member order is the same declaration", async () => {
  const declaration = {
    logicalName: "api.token",
    purpose: "Driver provider access",
    blockedCapability: "driver:anthropic",
    required: true
  };
  const config = canonicalConfig({
    requiredSecrets: [declaration, Object.fromEntries(Object.entries(declaration).reverse())]
  });
  const { service, store } = serviceOptions(MachineBootstrapService, [claude(), codex()], {
    boundSecrets: ["api.token"]
  });
  const result = await service.execute(executeInput(config));
  assert.deepEqual(
    store.profile.secretBindings.map((entry) => entry.logicalName),
    ["api.token"]
  );
  assert.deepEqual(result.missingBindings, []);
});

test("a logical secret whose two declarations really differ still fails closed", async () => {
  const declaration = {
    logicalName: "api.token",
    purpose: "Driver provider access",
    blockedCapability: "driver:anthropic",
    required: true
  };
  const config = canonicalConfig({
    requiredSecrets: [declaration, { ...declaration, blockedCapability: "driver:openai" }]
  });
  const { service, store } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  await assert.rejects(service.execute(executeInput(config)), (error) => {
    assert.equal(error.code, "VES_BOOTSTRAP_PROFILE_FAILED");
    assert.equal(error.cause.message, "Logical secret has conflicting declarations");
    return true;
  });
  assert.equal(store.writes, 0);
});

test("repeated bootstrap writes no duplicate profile and preserves digest", async () => {
  const { service, store } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  const first = await service.execute(executeInput());
  const second = await service.execute(executeInput());
  assert.equal(store.writes, 1);
  assert.equal(first.profileDigest, second.profileDigest);
  assert.equal(second.profileChanged, false);
});

test("private discovery failure maps to a stable sanitized error", async () => {
  const privateMessage = "C:\\Users\\name token=secret";
  const { service } = serviceOptions(MachineBootstrapService, [], {
    discovery: { discover: async () => Promise.reject(new Error(privateMessage)) }
  });
  await assert.rejects(service.execute(executeInput()), (error) => {
    assert.equal(error.code, "VES_BOOTSTRAP_DISCOVERY_FAILED");
    assert.equal(JSON.stringify(error).includes(privateMessage), false);
    return true;
  });
});

test("bootstrap public error catalog is exact and schema-valid", async () => {
  assert.equal(BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS.length, 4);
  assert.deepEqual(bootstrapPublicErrorRegistry.codes, [
    "VES_BOOTSTRAP_CONFIG_INCOMPATIBLE",
    "VES_BOOTSTRAP_DISCOVERY_FAILED",
    "VES_BOOTSTRAP_INPUT_INVALID",
    "VES_BOOTSTRAP_PROFILE_FAILED"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of bootstrapPublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", bootstrapPublicErrorRegistry.create(code, {})).code, code);
  }
});

test("profile binds exact Workspace and machine identities", async () => {
  const { service, store } = serviceOptions(MachineBootstrapService, [claude(), codex()]);
  await service.execute(executeInput());
  assert.equal(store.profile.workspaceId, workspaceId);
  assert.equal(store.profile.machineId, machineId);
});
