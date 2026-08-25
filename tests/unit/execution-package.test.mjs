import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  FileExecutionPackageStore,
  derivePendingTasks,
  dsseEnvelopeOf,
  sha256Digest
} from "../../packages/evidence/src/index.ts";
import {
  currentState,
  digest,
  executionHarness,
  packageInput,
  workspaceId
} from "../helpers/execution-package-fixture.mjs";

test("builder emits a signed backend-neutral content-addressed package", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  assert.equal(sealed.schema.name, "execution-package");
  assert.equal(sealed.purpose, "execution-package");
  assert.equal(sealed.payload.schemaVersion, 2);
  assert.equal(sealed.payload.workspaceId, workspaceId);
  assert.match(sealed.artifactId, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(sealed).includes("Claude"), false);
  assert.equal(JSON.stringify(sealed).includes("OpenCode"), false);
});

test("new packages declare the V2 Execution Package attestation", async () => {
  const { builder, trust } = executionHarness();
  const input = packageInput({ requiredCapabilities: ["alpha", "Zulu"] });
  const sealed = await builder.build(input);
  const statement = JSON.parse(Buffer.from(sealed.dsse.payload, "base64").toString("utf8"));
  assert.equal(sealed.schema.version, 2);
  assert.equal(statement.predicateType, "https://accd.github.io/verchestra/attestation/execution-package/v2");
  assert.deepEqual(sealed.payload.requiredCapabilities, ["Zulu", "alpha"]);
  assert.equal((await builder.verify(sealed, trust, currentState(input))).ok, true);
});

test("a pinned V1 package remains verifiable under its V1 predicate", async () => {
  const { builder, trust } = executionHarness();
  const input = packageInput({ schemaVersion: 1 });
  const sealed = await builder.build(input);
  const statement = JSON.parse(Buffer.from(sealed.dsse.payload, "base64").toString("utf8"));
  assert.equal(sealed.schema.version, 1);
  assert.equal(sealed.artifactId, "ebbf7e4c4f28af4efc95a2515cb7d4a19edd48749da9c829f67a8a5074db668a");
  assert.equal(statement.predicateType, "https://accd.github.io/verchestra/attestation/execution-package/v1");
  assert.equal((await builder.verify(sealed, trust, currentState(input))).ok, true);
});

test("V1 preserves UTF-16 identity ordering for every versioned collection", async () => {
  const base = packageInput({ schemaVersion: 1 });
  const unorderedRefs = [
    { artifactId: "alpha", digest: digest("alpha") },
    { artifactId: "Zulu", digest: digest("Zulu") }
  ];
  const unorderedRoles = [
    { ...base.roleRequirements[0], role: "alpha" },
    { ...base.roleRequirements[1], role: "Zulu" }
  ];
  const unorderedGates = [
    { gateId: "alpha", command: "alpha", evidenceRequired: true },
    { gateId: "Zulu", command: "Zulu", evidenceRequired: true }
  ];
  const unorderedCriteria = [
    { criterionId: "alpha", requirementIds: ["VES-SPC-001"], verificationRefs: ["alpha"] },
    { criterionId: "Zulu", requirementIds: ["VES-SPC-004"], verificationRefs: ["Zulu"] }
  ];
  const input = packageInput({
    schemaVersion: 1,
    decisions: unorderedRefs,
    contextRecipes: unorderedRefs,
    discoveryEvidence: unorderedRefs,
    dataPolicies: unorderedRefs,
    seedSpecifications: unorderedRefs,
    roleRequirements: unorderedRoles,
    gates: unorderedGates,
    completionCriteria: unorderedCriteria,
    completedTaskEvidence: [],
    bindings: {
      ...base.bindings,
      sourceState: {
        alpha: digest("alpha-source"),
        Zulu: digest("Zulu-source")
      }
    }
  });
  const { builder } = executionHarness();
  const sealed = await builder.build(input);
  const expected = ["Zulu", "alpha"];
  for (const collection of [
    sealed.payload.decisions,
    sealed.payload.contextRecipes,
    sealed.payload.discoveryEvidence,
    sealed.payload.dataPolicies,
    sealed.payload.seedSpecifications
  ])
    assert.deepEqual(
      collection.map((entry) => entry.artifactId),
      expected
    );
  assert.deepEqual(
    sealed.payload.roleRequirements.map((entry) => entry.role),
    expected
  );
  assert.deepEqual(
    sealed.payload.gates.map((entry) => entry.gateId),
    expected
  );
  assert.deepEqual(
    sealed.payload.completionCriteria.map((entry) => entry.criterionId),
    expected
  );
  assert.deepEqual(Object.keys(sealed.payload.bindings.sourceState), expected);
});

test("V1 retains code-unit ordering at every legacy default-sort site", async () => {
  const base = packageInput({ schemaVersion: 1 });
  const tasks = structuredClone(base.tasks);
  tasks[0] = {
    ...tasks[0],
    componentRefs: ["alpha", "Zulu"],
    verificationCommands: ["alpha", "Zulu"],
    doneCriteria: ["alpha", "Zulu"]
  };
  const input = packageInput({
    schemaVersion: 1,
    projectIds: ["alpha", "Zulu"],
    requiredCapabilities: ["alpha", "Zulu"],
    approvalRequirements: ["alpha", "Zulu"],
    roleRequirements: [{ ...base.roleRequirements[0], capabilities: ["alpha", "Zulu"] }, base.roleRequirements[1]],
    completionCriteria: [{ ...base.completionCriteria[0], verificationRefs: ["alpha", "Zulu"] }],
    tasks
  });
  const { builder } = executionHarness();
  const sealed = await builder.build(input);
  const codeUnitOrder = ["Zulu", "alpha"];
  assert.deepEqual(sealed.payload.projectIds, codeUnitOrder);
  assert.deepEqual(sealed.payload.requiredCapabilities, codeUnitOrder);
  assert.deepEqual(sealed.payload.approvalRequirements, codeUnitOrder);
  assert.deepEqual(sealed.payload.roleRequirements[0].capabilities, codeUnitOrder);
  assert.deepEqual(sealed.payload.completionCriteria[0].verificationRefs, codeUnitOrder);
  assert.deepEqual(sealed.payload.tasks[0].componentRefs, codeUnitOrder);
  assert.deepEqual(sealed.payload.tasks[0].verificationCommands, codeUnitOrder);
  assert.deepEqual(sealed.payload.tasks[0].doneCriteria, codeUnitOrder);
  assert.deepEqual(
    derivePendingTasks([{ taskId: "T-1", sequence: 1, dependsOn: ["alpha", "Zulu"] }], [], 1)[0].blockedBy,
    codeUnitOrder
  );
});

test("pending work is derived from completed evidence and dependency closure", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  assert.deepEqual(sealed.payload.pendingTasks, [
    { taskId: "T-2", sequence: 2, blockedBy: [], ready: true },
    { taskId: "T-3", sequence: 3, blockedBy: ["T-2"], ready: false }
  ]);
});

test("clean-process verification reconstructs identical first pending work", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, currentState(input));
  assert.equal(result.ok, true);
  assert.equal(result.firstPendingTaskId, "T-2");
  assert.deepEqual(result.pendingTasks, sealed.payload.pendingTasks);
});

test("completing the next task advances the first pending task", async () => {
  const input = packageInput();
  input.completedTaskEvidence.push({
    taskId: "T-2",
    result: "passed",
    evidenceDigest: digest("T-2-evidence"),
    sourceStateDigest: digest(input.bindings.sourceState)
  });
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, currentState(input));
  assert.equal(result.firstPendingTaskId, "T-3");
  assert.equal(result.pendingTasks[0].ready, true);
});

test("fully completed package has no pending work", async () => {
  const input = packageInput();
  for (const taskId of ["T-2", "T-3"])
    input.completedTaskEvidence.push({
      taskId,
      result: "passed",
      evidenceDigest: digest(`${taskId}-evidence`),
      sourceStateDigest: digest(input.bindings.sourceState)
    });
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, currentState(input));
  assert.equal(result.firstPendingTaskId, null);
  assert.deepEqual(result.pendingTasks, []);
});

test("equivalent unordered sets produce an identical sealed package", async () => {
  const first = packageInput();
  const second = packageInput({
    projectIds: [...first.projectIds].reverse(),
    requirements: [...first.requirements].reverse(),
    decisions: [...first.decisions].reverse(),
    tasks: [...first.tasks].reverse(),
    requiredCapabilities: [...first.requiredCapabilities].reverse(),
    roleRequirements: [...first.roleRequirements].reverse()
  });
  const { builder } = executionHarness();
  assert.deepEqual(await builder.build(second), await builder.build(first));
});

test("repeated build with exact input is byte-identical", async () => {
  const { builder } = executionHarness();
  const input = packageInput();
  assert.deepEqual(await builder.build(input), await builder.build(structuredClone(input)));
});

test("sealed package is deeply immutable in process memory", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.payload), true);
  assert.equal(Object.isFrozen(sealed.payload.tasks), true);
  assert.equal(Object.isFrozen(sealed.payload.tasks[0]), true);
  assert.throws(() => sealed.payload.tasks.push({}));
});

for (const [name, mutate] of [
  ["version", (input) => (input.packageVersion += 1)],
  ["execution contract", (input) => (input.executionContractDigest = digest("other-contract"))],
  [
    "source",
    (input) => {
      input.bindings.sourceState["repo:api"] = digest("other-source");
      input.completedTaskEvidence[0].sourceStateDigest = digest(input.bindings.sourceState);
    }
  ],
  ["requirement", (input) => (input.requirements[0].artifactDigest = digest("other-requirement"))],
  ["task", (input) => (input.tasks[1].doneCriteria = ["Other criterion"])],
  ["gate", (input) => (input.gates[0].command = "node scripts/gate.mjs full")]
]) {
  test(`${name} mutation changes the package identity`, async () => {
    const first = packageInput();
    const changed = packageInput();
    mutate(changed);
    const { builder } = executionHarness();
    assert.notEqual((await builder.build(first)).artifactId, (await builder.build(changed)).artifactId);
  });
}

for (const field of [
  "policyDigest",
  "skillLockDigest",
  "contextDigest",
  "dataAccessDigest",
  "effectPlanDigest",
  "verificationPlanDigest",
  "destinationDigest",
  "capabilityDigest",
  "budgetDigest",
  "evidenceDigest"
]) {
  test(`${field} mismatch reports one exact approval-invalidating field`, async () => {
    const input = packageInput();
    const { builder, trust } = executionHarness();
    const sealed = await builder.build(input);
    const result = await builder.verify(sealed, trust, currentState(input, { [field]: digest(`changed-${field}`) }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "VES_EXECUTION_PACKAGE_STALE");
    assert.deepEqual(
      result.invalidations.map((entry) => entry.field),
      [`bindings.${field}`]
    );
    assert.equal(result.invalidations[0].approvalInvalidated, true);
  });
}

test("source-state mismatch reports its exact logical source", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const sourceState = { ...input.bindings.sourceState, "repo:api": digest("moved") };
  const result = await builder.verify(sealed, trust, currentState(input, { sourceState }));
  assert.deepEqual(
    result.invalidations.map((entry) => entry.field),
    ["bindings.sourceState.repo:api"]
  );
});

test("multiple binding mismatches are complete and canonically ordered", async () => {
  const input = packageInput();
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(
    sealed,
    trust,
    currentState(input, {
      policyDigest: digest("changed-policy"),
      evidenceDigest: digest("changed-evidence")
    })
  );
  assert.deepEqual(
    result.invalidations.map((entry) => entry.field),
    ["bindings.evidenceDigest", "bindings.policyDigest"]
  );
});

test("derivePendingTasks is pure and does not mutate caller arrays", () => {
  const input = packageInput();
  const before = JSON.stringify(input);
  derivePendingTasks(input.tasks, input.completedTaskEvidence);
  assert.equal(JSON.stringify(input), before);
});

test("file store publishes the canonical envelope and reads the package back", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-"));
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  const store = new FileExecutionPackageStore({ root });
  assert.equal((await store.put(sealed)).outcome, "published");
  // The round trip is the strong claim and it is unchanged: what comes back is
  // the package that went in, reconstructed entirely from the signed Statement.
  assert.deepEqual(await store.get(sealed.artifactId), sealed);
  // What is on disk is the bare DSSE envelope (#248) rather than the whole
  // sealed object, so the byte-level assertion names that instead of the old
  // whole-object digest.
  assert.equal(
    sha256Digest(JSON.parse(await readFile(join(root, `${sealed.artifactId}.json`), "utf8"))),
    sha256Digest(dsseEnvelopeOf(sealed))
  );
});

test("file store repeat is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-"));
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  const store = new FileExecutionPackageStore({ root });
  await store.put(sealed);
  assert.equal((await store.put(sealed)).outcome, "already-published");
});

test("concurrent publication is atomic and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-"));
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  const stores = [new FileExecutionPackageStore({ root }), new FileExecutionPackageStore({ root })];
  const outcomes = (await Promise.all(stores.map((store) => store.put(sealed)))).map((result) => result.outcome).sort();
  assert.deepEqual(outcomes, ["already-published", "published"]);
  assert.deepEqual(await stores[0].get(sealed.artifactId), sealed);
});

// #58/T4i: 11 array-sort sites in execution-package.ts used
// String.prototype.localeCompare, which is locale-dependent and can diverge
// from code-unit order for mixed-case ASCII values (real fixtures use them,
// e.g. taskId: "T-1"). Mocking localeCompare with a comparator that reverses
// ASCII case order simulates a hostile/divergent locale without depending on
// any specific installed ICU locale actually disagreeing today.
function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    // Reversed relative to code-unit order for any left !== other: proves a
    // test comparing against this mock actually discriminates rather than
    // coincidentally agreeing with code-unit order.
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

function mixedCaseInput(overrides = {}) {
  return packageInput({
    schemaVersion: 2,
    requirements: [
      {
        requirementId: "VES-SPC-001",
        priority: "must",
        acceptanceCriteria: "WHEN the package is built THEN every requirement SHALL remain traceable.",
        assumptionState: "closed",
        independentTest: "node --test tests/unit/execution-package.test.mjs",
        artifactDigest: digest("requirement-1")
      }
    ],
    tasks: [
      {
        taskId: "T-1",
        sequence: 1,
        requirementIds: ["VES-SPC-001"],
        dependsOn: [],
        componentRefs: ["packages/evidence"],
        verificationCommands: ["node --test tests/unit/execution-package.test.mjs"],
        doneCriteria: ["Package schema is closed"],
        risk: "medium",
        expectedCommit: "feat(evidence): add execution packages"
      }
    ],
    completedTaskEvidence: [],
    decisions: [
      { artifactId: "Adr-0015", digest: digest("adr-0015") },
      { artifactId: "adr-0002", digest: digest("adr-0002") }
    ],
    roleRequirements: [
      { role: "Implementer", capabilities: ["code-edit"], minimumContextTokens: 1024, reasoning: "high" },
      { role: "implementer-support", capabilities: ["code-edit"], minimumContextTokens: 1024, reasoning: "high" }
    ],
    gates: [
      { gateId: "Security", command: "node scripts/gate.mjs security", evidenceRequired: true },
      { gateId: "security-follow-up", command: "node scripts/gate.mjs quick", evidenceRequired: false }
    ],
    completionCriteria: [
      { criterionId: "Complete-security", requirementIds: ["VES-SPC-001"], verificationRefs: ["security"] },
      { criterionId: "complete-security-follow-up", requirementIds: ["VES-SPC-001"], verificationRefs: ["quick"] }
    ],
    ...overrides
  });
}

test("schemaVersion: 2 sealed bytes are byte-identical across two divergent locale collations (CJ4I-01, CJ4I-02)", async () => {
  const { builder } = executionHarness();
  const plain = await builder.build(mixedCaseInput());
  const underHostileLocale = await withHostileLocaleCompare(() => builder.build(mixedCaseInput()));
  assert.equal(plain.artifactId, underHostileLocale.artifactId);
  assert.deepEqual(plain.payload.decisions, underHostileLocale.payload.decisions);
  assert.deepEqual(plain.payload.roleRequirements, underHostileLocale.payload.roleRequirements);
  assert.deepEqual(plain.payload.gates, underHostileLocale.payload.gates);
  assert.deepEqual(plain.payload.completionCriteria, underHostileLocale.payload.completionCriteria);
  // Code-unit order specifically, not merely "some" deterministic order:
  // uppercase sorts before lowercase in UTF-16.
  assert.deepEqual(
    plain.payload.decisions.map((entry) => entry.artifactId),
    ["Adr-0015", "adr-0002"]
  );
});

test("ExecutionPackageBuilder.build() defaults to schemaVersion: 2 when the caller omits it (CJ4I-03)", async () => {
  const { builder } = executionHarness();
  const input = packageInput();
  delete input.schemaVersion;
  const sealed = await builder.build(input);
  assert.equal(sealed.payload.schemaVersion, 2);
});

test("an explicit schemaVersion: 1 build stays on schemaVersion: 1, never silently upgraded", async () => {
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput({ schemaVersion: 1 }));
  assert.equal(sealed.payload.schemaVersion, 1);
});

test("an invalid schemaVersion is rejected, not silently defaulted", async () => {
  const { builder } = executionHarness();
  await assert.rejects(builder.build(packageInput({ schemaVersion: 3 })), { code: "VES_EXECUTION_PACKAGE_INVALID" });
});

test("a schemaVersion: 1 package built before this change still verifies unchanged (CJ4I-04, CJ4I-05)", async () => {
  const input = packageInput({ schemaVersion: 1 });
  const { builder, trust } = executionHarness();
  const sealed = await builder.build(input);
  const result = await builder.verify(sealed, trust, currentState(input));
  assert.equal(result.ok, true);
  assert.deepEqual(result.pendingTasks, sealed.payload.pendingTasks);
});

test("pendingTasks re-derivation is unaffected by locale collation for either schemaVersion, given required unique task sequence numbers (CJ4I-06)", () => {
  // #58/T4i, AD-021 follow-up finding: derivePendingTasks's (sequence,
  // taskId) sort key can never actually reach the taskId comparator, because
  // normalizeTasks already requires unique sequence numbers across every
  // task — sequence alone is a total order. Verified here directly against
  // the exported function, under a hostile locale mock, for both schema
  // versions, so a future change that weakens the sequence-uniqueness
  // invariant elsewhere would need to revisit this claim.
  const tasks = [
    {
      taskId: "T-1",
      sequence: 1,
      requirementIds: [],
      dependsOn: [],
      componentRefs: [],
      verificationCommands: [],
      doneCriteria: [],
      risk: "low",
      expectedCommit: "c"
    },
    {
      taskId: "t-2",
      sequence: 2,
      requirementIds: [],
      dependsOn: [],
      componentRefs: [],
      verificationCommands: [],
      doneCriteria: [],
      risk: "low",
      expectedCommit: "c"
    }
  ];
  for (const version of [1, 2]) {
    const plain = derivePendingTasks(tasks, [], version);
    const underHostileLocale = withHostileLocaleCompare(() => derivePendingTasks(tasks, [], version));
    assert.deepEqual(plain, underHostileLocale, `schemaVersion ${version} pendingTasks order is locale-independent`);
  }
});

test("file store never overwrites different bytes at a package identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-execution-package-"));
  const { builder } = executionHarness();
  const sealed = await builder.build(packageInput());
  await writeFile(join(root, `${sealed.artifactId}.json`), "human bytes", "utf8");
  const store = new FileExecutionPackageStore({ root });
  await assert.rejects(store.put(sealed), { code: "VES_EXECUTION_PACKAGE_STORAGE_CONFLICT" });
});
