import assert from "node:assert/strict";
import { test } from "node:test";

import { changeScopesOverlap, normalizeChangeScope } from "../../packages/application/src/index.ts";
import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";

const digest = new NodeContentDigest();
const workspaceId = "workspace_018f0000-0000-7000-8000-000000000001";
const projectA = "project_018f0000-0000-7000-8000-000000000002";
const projectB = "project_018f0000-0000-7000-8000-000000000003";
const scope = (targets) => normalizeChangeScope({ workspaceId, targets }, digest);

test("scope normalization sorts, deduplicates, and removes covered descendants", () => {
  assert.deepEqual(
    scope([
      { projectId: projectA, path: "src/api" },
      { projectId: projectA, path: "src" },
      { projectId: projectA, path: "src" }
    ]).targets,
    [{ projectId: projectA, path: "src" }]
  );
});

test("whole-project target covers every path in that project", () => {
  assert.deepEqual(scope([{ projectId: projectA, path: "src" }, { projectId: projectA }]).targets, [
    { projectId: projectA }
  ]);
});

test("normalization is independent from input order", () => {
  const left = scope([
    { projectId: projectB, path: "b" },
    { projectId: projectA, path: "a" }
  ]);
  const right = scope([
    { projectId: projectA, path: "a" },
    { projectId: projectB, path: "b" }
  ]);
  assert.deepEqual(left, right);
});

const cases = [
  ["same path", [{ projectId: projectA, path: "src" }], [{ projectId: projectA, path: "src" }], true],
  ["ancestor left", [{ projectId: projectA, path: "src" }], [{ projectId: projectA, path: "src/api" }], true],
  ["ancestor right", [{ projectId: projectA, path: "src/api" }], [{ projectId: projectA, path: "src" }], true],
  ["segment sibling", [{ projectId: projectA, path: "src/api" }], [{ projectId: projectA, path: "src/app" }], false],
  [
    "text prefix only",
    [{ projectId: projectA, path: "src/app" }],
    [{ projectId: projectA, path: "src/application" }],
    false
  ],
  ["different project", [{ projectId: projectA, path: "src" }], [{ projectId: projectB, path: "src" }], false],
  ["whole left", [{ projectId: projectA }], [{ projectId: projectA, path: "src" }], true],
  ["whole right", [{ projectId: projectA, path: "src" }], [{ projectId: projectA }], true],
  ["whole other project", [{ projectId: projectA }], [{ projectId: projectB }], false],
  [
    "one of many",
    [
      { projectId: projectA, path: "docs" },
      { projectId: projectB, path: "src" }
    ],
    [{ projectId: projectA, path: "docs/api" }],
    true
  ],
  [
    "many disjoint",
    [
      { projectId: projectA, path: "docs" },
      { projectId: projectB, path: "src" }
    ],
    [{ projectId: projectA, path: "src" }],
    false
  ],
  ["deep ancestor", [{ projectId: projectA, path: "a/b" }], [{ projectId: projectA, path: "a/b/c/d" }], true],
  ["root siblings", [{ projectId: projectA, path: "a" }], [{ projectId: projectA, path: "b" }], false],
  ["case distinct", [{ projectId: projectA, path: "src/API" }], [{ projectId: projectA, path: "src/api" }], false],
  [
    "multi project overlap",
    [
      { projectId: projectA, path: "a" },
      { projectId: projectB, path: "b" }
    ],
    [{ projectId: projectB, path: "b/c" }],
    true
  ]
];

for (const [name, left, right, expected] of cases) {
  test(`scope overlap: ${name}`, () => {
    assert.equal(changeScopesOverlap(scope(left), scope(right)), expected);
    assert.equal(changeScopesOverlap(scope(right), scope(left)), expected);
  });
}

for (const invalid of ["../src", "/src", "src\\api", "src/*", "C:/src"]) {
  test(`invalid scope path is rejected: ${invalid}`, () => {
    assert.throws(() => scope([{ projectId: projectA, path: invalid }]));
  });
}
