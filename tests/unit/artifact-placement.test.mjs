import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createWritePlan,
  effectivePlacement,
  placementPublicErrorRegistry,
  resolveArtifact
} from "../../packages/workspace/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";

const controlOwnerId = `sha256:${"a".repeat(64)}`;
const childOwnerId = `sha256:${"b".repeat(64)}`;
const projectId = "project_018f0b6d-7b1a-7abc-8def-0123456789ab";

function project(overrides = {}) {
  return {
    projectId,
    slug: "api",
    sourceLogicalPath: "apps/api",
    gitOwnerId: controlOwnerId,
    gitRelation: "control",
    ignoredByControl: false,
    placement: "inherit",
    nestedWriteAuthorized: false,
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    controlOwnerId,
    placementMode: "colocated",
    defaultProjectPlacement: "colocated",
    nestedGitDefault: "centralized",
    requireExplicitNestedRepositoryWrites: true,
    projects: [project()],
    ...overrides
  };
}

function address(artifactClass = "project-manifest", overrides = {}) {
  return { scope: "project", projectId, artifactClass, logicalName: "primary", ...overrides };
}

const effectiveCases = [
  ["colocated default", snapshot(), project(), "colocated"],
  ["centralized mode", snapshot({ placementMode: "centralized" }), project(), "centralized"],
  ["external-control mode", snapshot({ placementMode: "external-control" }), project(), "centralized"],
  ["mixed inherited default", snapshot({ placementMode: "mixed" }), project(), "colocated"],
  [
    "mixed explicit centralized",
    snapshot({ placementMode: "mixed" }),
    project({ placement: "centralized" }),
    "centralized"
  ],
  [
    "mixed explicit colocated",
    snapshot({ placementMode: "mixed", defaultProjectPlacement: "centralized" }),
    project({ placement: "colocated" }),
    "colocated"
  ],
  ["nested inherited default", snapshot(), project({ gitOwnerId: childOwnerId, gitRelation: "nested" }), "centralized"],
  [
    "submodule inherited default",
    snapshot(),
    project({ gitOwnerId: childOwnerId, gitRelation: "submodule" }),
    "centralized"
  ],
  [
    "worktree inherited default",
    snapshot(),
    project({ gitOwnerId: childOwnerId, gitRelation: "worktree" }),
    "centralized"
  ],
  ["ignored inherited project", snapshot(), project({ ignoredByControl: true }), "centralized"],
  ["broken owner", snapshot(), project({ gitOwnerId: null, gitRelation: "placeholder" }), "centralized"]
];

for (const [name, workspace, candidate, expected] of effectiveCases) {
  test(`effective placement: ${name}`, () => assert.equal(effectivePlacement(candidate, workspace), expected));
}

test("explicit authorized nested colocated placement is allowed", () => {
  const candidate = project({
    gitOwnerId: childOwnerId,
    gitRelation: "nested",
    placement: "colocated",
    nestedWriteAuthorized: true
  });
  assert.equal(effectivePlacement(candidate, snapshot({ projects: [candidate] })), "colocated");
});

test("explicit unauthorized nested colocated placement fails closed", () => {
  const candidate = project({ gitOwnerId: childOwnerId, gitRelation: "nested", placement: "colocated" });
  assert.throws(() => effectivePlacement(candidate, snapshot({ projects: [candidate] })), {
    code: "VES_PLACEMENT_NESTED_AUTH_REQUIRED"
  });
});

const colocatedPaths = [
  ["project-manifest", "apps/api/.verchestra/project.yaml"],
  ["spec", "apps/api/.specs/primary"],
  ["gate", "apps/api/.verchestra/gates/primary"],
  ["data", "apps/api/.verchestra/data/primary"],
  ["evaluation", "apps/api/.verchestra/evals/primary"],
  ["reversa", "apps/api/.verchestra/reversa/primary"],
  ["evidence", "apps/api/.verchestra/evidence/primary"],
  ["context", "apps/api/.verchestra/context/primary"],
  ["agent-instructions", "apps/api/AGENTS.md"]
];

for (const [artifactClass, logicalPath] of colocatedPaths) {
  test(`colocated ${artifactClass} resolves inside the project`, () => {
    assert.deepEqual(resolveArtifact(address(artifactClass), snapshot()), {
      placement: "colocated",
      gitOwnerId: controlOwnerId,
      logicalPath,
      projectId
    });
  });
}

const centralizedPaths = [
  ["project-manifest", ".verchestra/projects/api/project.yaml"],
  ["spec", ".verchestra/projects/api/specs/primary"],
  ["gate", ".verchestra/projects/api/gates/primary"],
  ["data", ".verchestra/projects/api/data/primary"],
  ["evaluation", ".verchestra/projects/api/evals/primary"],
  ["reversa", ".verchestra/projects/api/reversa/primary"],
  ["evidence", ".verchestra/projects/api/evidence/primary"],
  ["context", ".verchestra/projects/api/context/primary"],
  ["agent-instructions", ".verchestra/projects/api/context/AGENTS.md"]
];

for (const [artifactClass, logicalPath] of centralizedPaths) {
  test(`centralized ${artifactClass} resolves only under control metadata`, () => {
    const resolved = resolveArtifact(address(artifactClass), snapshot({ placementMode: "centralized" }));
    assert.deepEqual(resolved, { placement: "centralized", gitOwnerId: controlOwnerId, logicalPath, projectId });
    assert.equal(resolved.logicalPath.startsWith("apps/api/"), false);
  });
}

test("nested colocated artifact belongs to the nested Git owner", () => {
  const candidate = project({
    gitOwnerId: childOwnerId,
    gitRelation: "nested",
    placement: "colocated",
    nestedWriteAuthorized: true
  });
  assert.deepEqual(resolveArtifact(address("spec"), snapshot({ projects: [candidate] })), {
    placement: "colocated",
    gitOwnerId: childOwnerId,
    logicalPath: ".specs/primary",
    projectId
  });
});

test("workspace artifacts always resolve to the control owner", () => {
  assert.deepEqual(
    resolveArtifact({ scope: "workspace", artifactClass: "workspace-manifest", logicalName: "primary" }, snapshot()),
    { placement: "control", gitOwnerId: controlOwnerId, logicalPath: ".verchestra/workspace.yaml" }
  );
});

test("unknown Project fails before path construction", () => {
  assert.throws(
    () => resolveArtifact(address("spec", { projectId: "project_018f0b6d-7b1a-7abc-8def-1123456789ab" }), snapshot()),
    {
      code: "VES_PLACEMENT_PROJECT_NOT_FOUND"
    }
  );
});

for (const logicalName of ["../escape", "/absolute", "a\\b", "", ".", "CON"]) {
  test(`artifact logical name rejects unsafe value: ${logicalName || "empty"}`, () => {
    assert.throws(() => resolveArtifact(address("spec", { logicalName }), snapshot()), {
      code: "VES_PLACEMENT_ADDRESS_INVALID"
    });
  });
}

function desired(artifactClass, logicalName, digest = `sha256:${"c".repeat(64)}`) {
  return {
    address: address(artifactClass, { logicalName }),
    contentDigest: digest,
    generatorVersion: "1.0.0",
    lifecyclePolicy: "tracked"
  };
}

test("WritePlan is deterministic and content-addressed", () => {
  const first = createWritePlan([desired("spec", "b"), desired("gate", "a")], snapshot());
  const second = createWritePlan([desired("gate", "a"), desired("spec", "b")], snapshot());
  assert.deepEqual(second, first);
  assert.match(first.planId, /^v2:sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(first), true);
});

test("WritePlan deduplicates identical desired artifacts", () => {
  const item = desired("spec", "feature-a");
  assert.equal(createWritePlan([item, item], snapshot()).writes.length, 1);
});

test("WritePlan rejects a target collision with different content", () => {
  assert.throws(
    () =>
      createWritePlan(
        [desired("spec", "feature-a"), desired("spec", "feature-a", `sha256:${"d".repeat(64)}`)],
        snapshot()
      ),
    { code: "VES_PLACEMENT_TARGET_COLLISION" }
  );
});

test("WritePlan groups writes by exact Git owner", () => {
  const child = project({
    projectId: "project_018f0b6d-7b1a-7abc-8def-1123456789ab",
    slug: "child",
    sourceLogicalPath: "child",
    gitOwnerId: childOwnerId,
    gitRelation: "nested",
    placement: "colocated",
    nestedWriteAuthorized: true
  });
  const items = [
    desired("spec", "root"),
    {
      ...desired("spec", "child"),
      address: address("spec", { projectId: child.projectId, logicalName: "child" })
    }
  ];
  const plan = createWritePlan(items, snapshot({ placementMode: "mixed", projects: [project(), child] }));
  assert.deepEqual(plan.ownerIds, [controlOwnerId, childOwnerId]);
  assert.equal(plan.writes.length, 2);
});

test("centralized WritePlan contains zero project-source metadata targets", () => {
  const plan = createWritePlan(
    centralizedPaths.map(([artifactClass]) => desired(artifactClass, "primary")),
    snapshot({ placementMode: "centralized" })
  );
  assert.equal(
    plan.writes.every((write) => write.logicalPath.startsWith(".verchestra/projects/api/")),
    true
  );
  assert.deepEqual(plan.ownerIds, [controlOwnerId]);
});

for (const corrupt of [
  project({ placement: "automatic" }),
  project({ gitRelation: "foreign" }),
  project({ nestedWriteAuthorized: "yes" }),
  project({ ignoredByControl: "no" })
]) {
  test(`forged Project vocabulary fails snapshot validation: ${JSON.stringify(corrupt).slice(-20)}`, () => {
    assert.throws(() => effectivePlacement(corrupt, snapshot({ projects: [corrupt] })), {
      code: "VES_PLACEMENT_SNAPSHOT_INVALID"
    });
  });
}

test("forged artifact class fails address validation", () => {
  assert.throws(() => resolveArtifact(address("unknown-artifact"), snapshot()), {
    code: "VES_PLACEMENT_ADDRESS_INVALID"
  });
});

test("workspace scope rejects a project artifact class", () => {
  assert.throws(
    () => resolveArtifact({ scope: "workspace", artifactClass: "spec", logicalName: "primary" }, snapshot()),
    { code: "VES_PLACEMENT_ADDRESS_INVALID" }
  );
});

test("property: every permutation of desired artifacts yields one plan", () => {
  const values = [desired("spec", "a"), desired("gate", "b"), desired("data", "c")];
  const permutations = [
    values,
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]]
  ];
  assert.equal(new Set(permutations.map((items) => createWritePlan(items, snapshot()).planId)).size, 1);
});

test("property: changing content changes the WritePlan identity", () => {
  const first = createWritePlan([desired("spec", "a", `sha256:${"1".repeat(64)}`)], snapshot());
  const second = createWritePlan([desired("spec", "a", `sha256:${"2".repeat(64)}`)], snapshot());
  assert.notEqual(first.planId, second.planId);
});

test("WritePlan orders writes by code unit, not locale", () => {
  // ".specs/Zulu" < ".specs/alpha" by UTF-16 code unit ('Z' = 0x5A < 'a' = 0x61),
  // but locale-aware comparison (e.g. en collation) would order "alpha" first.
  const plan = createWritePlan([desired("spec", "Zulu"), desired("spec", "alpha")], snapshot());
  assert.deepEqual(
    plan.writes.map((write) => write.logicalPath),
    ["apps/api/.specs/Zulu", "apps/api/.specs/alpha"]
  );
});

test("WritePlan planId is self-describing V2 and differs from a V1-format value", () => {
  const plan = createWritePlan([desired("spec", "a")], snapshot());
  assert.match(plan.planId, /^v2:sha256:[a-f0-9]{64}$/u);
  assert.equal(plan.planId.startsWith("sha256:"), false);
});

test("placement public errors are exact and schema-valid", async () => {
  assert.deepEqual(placementPublicErrorRegistry.codes, [
    "VES_PLACEMENT_ADDRESS_INVALID",
    "VES_PLACEMENT_IGNORED_TARGET",
    "VES_PLACEMENT_NESTED_AUTH_REQUIRED",
    "VES_PLACEMENT_OWNER_REQUIRED",
    "VES_PLACEMENT_PROJECT_NOT_FOUND",
    "VES_PLACEMENT_SNAPSHOT_INVALID",
    "VES_PLACEMENT_TARGET_COLLISION"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of placementPublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", placementPublicErrorRegistry.create(code, {})).code, code);
  }
});
