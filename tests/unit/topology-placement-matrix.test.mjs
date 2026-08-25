import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PLACEMENT_PUBLIC_ERROR_DEFINITIONS,
  effectivePlacement,
  resolveArtifact
} from "../../packages/workspace/src/index.ts";

// T75 topology matrix, decision axis (issue #16 acceptance criterion 1: "zero
// required topology case is skipped").
//
// The topology vocabulary is not one union but a product of several, and the
// existing coverage sampled it: tests/unit/artifact-placement.test.mjs asserts
// eleven hand-chosen rows, which left three of the five Git relations with no
// explicit-colocated case at all and two of the placement guards
// (VES_PLACEMENT_OWNER_REQUIRED, VES_PLACEMENT_IGNORED_TARGET) reachable only
// in the error registry's string list, never from a real call.
//
// This file closes the axis by enumerating the FULL cross product of the
// canonical vocabulary rather than a sample of it. It deliberately does not
// re-implement the placement policy as an oracle — a mirror of the code under
// test proves nothing. It asserts the properties the policy exists to hold:
// the function is total over its own vocabulary, every declared guard is
// reachable, and no combination can ever produce a write into a repository the
// Workspace does not own or is not authorized to touch.
//
// Pure, so it lives in test:unit and therefore runs in ALL FIVE gate profiles.
// The real-Git half of the topology matrix is
// tests/integration/topology-lifecycle-matrix.test.mjs.

// Canonical vocabulary. Each list is the exact closed set its source declares;
// a value added there and not here makes `the matrix enumerates exactly the
// canonical topology vocabulary` fail rather than silently shrinking coverage.
const PLACEMENT_MODES = ["colocated", "centralized", "mixed", "external-control"]; // artifact-planning.ts:3
const PROJECT_PLACEMENTS = ["inherit", "colocated", "centralized"]; // artifact-planning.ts:1
const GIT_RELATIONS = ["control", "nested", "submodule", "worktree", "placeholder"]; // artifact-planning.ts:10
const EFFECTIVE_PLACEMENTS = ["colocated", "centralized"]; // artifact-planning.ts:2
const INDEPENDENT_RELATIONS = new Set(["nested", "submodule", "worktree"]); // artifact-placement.ts:88

const CONTROL_OWNER = `sha256:${"a".repeat(64)}`;
const CHILD_OWNER = `sha256:${"b".repeat(64)}`;
const PROJECT_ID = "project_018f0b6d-7b1a-7abc-8def-0123456789ab";
const OWNERS = [
  ["control-owner", CONTROL_OWNER],
  ["child-owner", CHILD_OWNER],
  ["no-owner", null]
];

const PLACEMENT_CODES = new Set(PLACEMENT_PUBLIC_ERROR_DEFINITIONS.map((definition) => definition.code));

function row(mode, placement, relation, owner, ignored, authorized, requireExplicit, nestedDefault, projectDefault) {
  const candidate = {
    projectId: PROJECT_ID,
    slug: "api",
    sourceLogicalPath: "apps/api",
    gitOwnerId: owner,
    gitRelation: relation,
    ignoredByControl: ignored,
    placement,
    nestedWriteAuthorized: authorized
  };
  return {
    candidate,
    snapshot: {
      schemaVersion: 1,
      controlOwnerId: CONTROL_OWNER,
      placementMode: mode,
      defaultProjectPlacement: projectDefault,
      nestedGitDefault: nestedDefault,
      requireExplicitNestedRepositoryWrites: requireExplicit,
      projects: [candidate]
    }
  };
}

// The complete cross product of the canonical vocabulary: 4 x 3 x 5 x 3 x 2 x 2
// x 2 x 2 x 2 = 5760 topology configurations.
function everyConfiguration() {
  const rows = [];
  for (const mode of PLACEMENT_MODES)
    for (const placement of PROJECT_PLACEMENTS)
      for (const relation of GIT_RELATIONS)
        for (const [ownerName, owner] of OWNERS)
          for (const ignored of [false, true])
            for (const authorized of [false, true])
              for (const requireExplicit of [true, false])
                for (const nestedDefault of EFFECTIVE_PLACEMENTS)
                  for (const projectDefault of EFFECTIVE_PLACEMENTS)
                    rows.push({
                      name: `${mode}/${placement}/${relation}/${ownerName}/ignored=${ignored}/authorized=${authorized}/requireExplicit=${requireExplicit}/nestedDefault=${nestedDefault}/projectDefault=${projectDefault}`,
                      ...row(
                        mode,
                        placement,
                        relation,
                        owner,
                        ignored,
                        authorized,
                        requireExplicit,
                        nestedDefault,
                        projectDefault
                      )
                    });
  return rows;
}

// Every row is evaluated exactly once; the tests below read this table rather
// than re-running the cross product, so a single sweep backs every claim.
const OUTCOMES = everyConfiguration().map((entry) => {
  try {
    return { ...entry, placement: effectivePlacement(entry.candidate, entry.snapshot), code: null };
  } catch (error) {
    return { ...entry, placement: null, code: error?.code ?? `THREW_WITHOUT_CODE:${error}` };
  }
});

const PLANNING_SOURCE = readFileSync(
  new URL("../../packages/application/src/artifacts/artifact-planning.ts", import.meta.url),
  "utf8"
);

// Reads a `export type Name = "a" | "b";` union out of the canonical source.
function declaredUnion(name) {
  const body = new RegExp(`export type ${name} =([^;]+);`, "u").exec(PLANNING_SOURCE)?.[1];
  assert.ok(body, `the ${name} union must be readable from artifact-planning.ts`);
  return [...body.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]).sort();
}

test("the matrix enumerates exactly the canonical topology vocabulary", () => {
  // Guards the matrix against the failure mode it exists to prevent: a case
  // added to the product union but not to this file would otherwise shrink
  // coverage silently while every test below still passed.
  assert.deepEqual([...PLACEMENT_MODES].sort(), declaredUnion("WorkspacePlacementMode"));
  assert.deepEqual([...PROJECT_PLACEMENTS].sort(), declaredUnion("ProjectPlacement"));
  assert.deepEqual([...EFFECTIVE_PLACEMENTS].sort(), declaredUnion("EffectivePlacement"));
  const relations = /gitRelation: ((?:"[a-z]+"(?: \| )?)+)/u.exec(PLANNING_SOURCE)?.[1];
  assert.ok(relations, "the Git relation union must be readable from artifact-planning.ts");
  assert.deepEqual([...GIT_RELATIONS].sort(), [...relations.matchAll(/"([a-z]+)"/gu)].map((match) => match[1]).sort());
  assert.equal(OUTCOMES.length, 5760, "the matrix must evaluate the full cross product");
});

test("every topology configuration is total: a declared placement or a declared refusal, never anything else", () => {
  // Fail-closed totality. An unrecognised throw, an undefined return, or a
  // placement outside the closed set is a topology the Workspace cannot
  // reason about, which is exactly what acceptance criterion 1 forbids.
  for (const outcome of OUTCOMES) {
    if (outcome.code === null) {
      assert.ok(
        EFFECTIVE_PLACEMENTS.includes(outcome.placement),
        `${outcome.name} resolved to ${outcome.placement}, which is not an EffectivePlacement`
      );
      continue;
    }
    assert.ok(
      PLACEMENT_CODES.has(outcome.code),
      `${outcome.name} failed with ${outcome.code}, which the placement error registry does not declare`
    );
  }
});

test("no topology can place an artifact into a repository the Workspace does not own", () => {
  // VES_PLACEMENT_OWNER_REQUIRED's reason for existing. A colocated write is a
  // write inside the project's own Git repository; with no active owner there
  // is no repository to write into, so no configuration may reach "colocated".
  const violations = OUTCOMES.filter(
    (outcome) => outcome.candidate.gitOwnerId === null && outcome.placement === "colocated"
  );
  assert.deepEqual(
    violations.map((outcome) => outcome.name),
    []
  );
});

test("no topology can place an artifact into an independent repository without explicit authorization", () => {
  // The nested-write policy. Whenever the Workspace requires explicit
  // authorization, an unauthorized independent repository must never receive a
  // colocated write, whatever the mode, the default, or the ignore flag say.
  const violations = OUTCOMES.filter(
    (outcome) =>
      INDEPENDENT_RELATIONS.has(outcome.candidate.gitRelation) &&
      outcome.snapshot.requireExplicitNestedRepositoryWrites &&
      outcome.candidate.nestedWriteAuthorized === false &&
      outcome.placement === "colocated"
  );
  assert.deepEqual(
    violations.map((outcome) => outcome.name),
    []
  );
});

test("no topology can place an artifact into a target its own control owner ignores", () => {
  // VES_PLACEMENT_IGNORED_TARGET. A colocated write into a control-owned path
  // the control repository ignores would produce an artifact Git never sees.
  const violations = OUTCOMES.filter(
    (outcome) =>
      outcome.candidate.ignoredByControl &&
      outcome.candidate.gitOwnerId === CONTROL_OWNER &&
      outcome.placement === "colocated"
  );
  assert.deepEqual(
    violations.map((outcome) => outcome.name),
    []
  );
});

test("centralized and external-control modes are absolute across every topology", () => {
  // The two modes that exist to take the decision away from the project. If
  // any per-project field could re-enable a colocated write under them, the
  // mode would not be a boundary.
  for (const mode of ["centralized", "external-control"]) {
    const rows = OUTCOMES.filter((outcome) => outcome.snapshot.placementMode === mode);
    assert.equal(rows.length, 1440, `${mode} must cover a quarter of the matrix`);
    for (const outcome of rows)
      assert.equal(outcome.placement, "centralized", `${outcome.name} escaped the ${mode} boundary`);
  }
});

test("every declared placement guard is reachable from the topology vocabulary", () => {
  // A guard no configuration can reach is either dead code or an unenforced
  // claim. Removing any one of these three branches from
  // artifact-placement.ts makes this fail.
  const reached = new Set(OUTCOMES.map((outcome) => outcome.code).filter((code) => code !== null));
  for (const code of [
    "VES_PLACEMENT_OWNER_REQUIRED",
    "VES_PLACEMENT_NESTED_AUTH_REQUIRED",
    "VES_PLACEMENT_IGNORED_TARGET"
  ])
    assert.ok(reached.has(code), `no topology configuration reaches ${code}`);
});

test("every Git relation is a live axis, not an inert label", () => {
  // Each relation must be able to produce more than one outcome; a relation
  // whose every row agrees is a relation the policy is not actually reading.
  for (const relation of GIT_RELATIONS) {
    const rows = OUTCOMES.filter((outcome) => outcome.candidate.gitRelation === relation);
    const observed = new Set(rows.map((outcome) => outcome.code ?? outcome.placement));
    assert.ok(observed.size > 1, `git relation ${relation} produced only ${[...observed]} across ${rows.length} rows`);
  }
});

test("explicit colocated placement is refused for every independent relation, not only nested", () => {
  // The sampled coverage proved this for `nested` alone. Submodules and linked
  // worktrees are independent repositories by the same predicate and had no
  // explicit-colocated case at all.
  for (const relation of ["nested", "submodule", "worktree"]) {
    const { candidate, snapshot } = row(
      "colocated",
      "colocated",
      relation,
      CHILD_OWNER,
      false,
      false,
      true,
      "centralized",
      "colocated"
    );
    assert.throws(
      () => effectivePlacement(candidate, snapshot),
      { code: "VES_PLACEMENT_NESTED_AUTH_REQUIRED" },
      `${relation} accepted an unauthorized colocated write`
    );
    const authorized = row(
      "colocated",
      "colocated",
      relation,
      CHILD_OWNER,
      false,
      true,
      true,
      "centralized",
      "colocated"
    );
    assert.equal(
      effectivePlacement(authorized.candidate, authorized.snapshot),
      "colocated",
      `${relation} refused an authorized colocated write`
    );
  }
});

test("colocated placement without an active Git owner is refused", () => {
  // First execution of VES_PLACEMENT_OWNER_REQUIRED anywhere in the suite: it
  // was previously present only as a string in the error registry listing.
  const { candidate, snapshot } = row(
    "colocated",
    "colocated",
    "placeholder",
    null,
    false,
    false,
    true,
    "centralized",
    "colocated"
  );
  assert.throws(() => effectivePlacement(candidate, snapshot), { code: "VES_PLACEMENT_OWNER_REQUIRED" });
});

test("colocated placement into a control-ignored target is refused", () => {
  // First execution of VES_PLACEMENT_IGNORED_TARGET, same as above.
  const { candidate, snapshot } = row(
    "colocated",
    "colocated",
    "control",
    CONTROL_OWNER,
    true,
    false,
    true,
    "centralized",
    "colocated"
  );
  assert.throws(() => effectivePlacement(candidate, snapshot), { code: "VES_PLACEMENT_IGNORED_TARGET" });
});

test("nestedGitDefault governs an independent project when explicit nested writes are not required", () => {
  // The branch at artifact-placement.ts:120. Every snapshot in the repository
  // sets requireExplicitNestedRepositoryWrites: true, so this policy had zero
  // coverage and `nestedGitDefault: "colocated"` had never been evaluated.
  for (const nestedDefault of EFFECTIVE_PLACEMENTS) {
    const { candidate, snapshot } = row(
      "colocated",
      "inherit",
      "submodule",
      CHILD_OWNER,
      false,
      false,
      false,
      nestedDefault,
      "colocated"
    );
    assert.equal(
      effectivePlacement(candidate, snapshot),
      nestedDefault,
      `an independent project ignored nestedGitDefault=${nestedDefault}`
    );
  }
});

test("a resolved artifact never addresses a repository other than its own placement owner", () => {
  // The decision only matters if the address follows it. For every relation,
  // a centralized resolution must address the control owner and stay out of
  // the project source tree; a colocated one must address the project's own
  // owner and stay inside it.
  for (const relation of GIT_RELATIONS) {
    const owner = relation === "control" ? CONTROL_OWNER : CHILD_OWNER;
    const centralized = row("centralized", "inherit", relation, owner, false, false, true, "centralized", "colocated");
    const resolved = resolveArtifact(
      { scope: "project", projectId: PROJECT_ID, artifactClass: "spec", logicalName: "primary" },
      centralized.snapshot
    );
    assert.equal(resolved.placement, "centralized");
    assert.equal(resolved.gitOwnerId, CONTROL_OWNER, `${relation} centralized artifact left the control owner`);
    assert.equal(
      resolved.logicalPath.startsWith("apps/api/"),
      false,
      `${relation} centralized artifact leaked into the project source tree`
    );
  }
  const colocated = row("colocated", "colocated", "nested", CHILD_OWNER, false, true, true, "centralized", "colocated");
  const resolved = resolveArtifact(
    { scope: "project", projectId: PROJECT_ID, artifactClass: "spec", logicalName: "primary" },
    colocated.snapshot
  );
  assert.equal(resolved.placement, "colocated");
  assert.equal(resolved.gitOwnerId, CHILD_OWNER, "an authorized colocated artifact must belong to the nested owner");
});
