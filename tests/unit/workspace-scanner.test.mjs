import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInventoryFingerprint,
  detectProjectMarker,
  parseGitFile,
  sanitizeRemoteUrl,
  workspacePublicErrorRegistry
} from "../../packages/workspace/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";

const remoteCases = [
  ["https://user:token@example.com/org/repo.git", "https://example.com/org/repo"],
  ["https://example.com/org/repo.git?access_token=secret#fragment", "https://example.com/org/repo"],
  ["ssh://git@example.com/org/repo.git", "ssh://example.com/org/repo"],
  ["git@example.com:org/repo.git", "ssh://example.com/org/repo"],
  ["git://example.com/org/repo.git/", "git://example.com/org/repo"]
];

for (const [input, expected] of remoteCases) {
  test(`remote normalization removes credentials: ${input.split(":")[0]}`, () => {
    assert.equal(sanitizeRemoteUrl(input), expected);
  });
}

for (const input of ["", "relative/path", "https://", "git@host", "file:///private/repo", "https://example.com/%ZZ"]) {
  test(`unsafe or local remote is rejected: ${input || "empty"}`, () => {
    assert.throws(() => sanitizeRemoteUrl(input), { code: "VES_WORKSPACE_REMOTE_INVALID" });
  });
}

test("gitfile parser accepts one canonical gitdir directive", () => {
  assert.deepEqual(parseGitFile("gitdir: ../../.git/modules/api\n"), { gitDir: "../../.git/modules/api" });
});

for (const input of ["", "gitdir:", "GITDIR: path", "gitdir: one\nextra", "path", "gitdir: a\0b"]) {
  test(`gitfile parser rejects malformed content: ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseGitFile(input), { code: "VES_WORKSPACE_GITFILE_INVALID" });
  });
}

const markerCases = [
  [["package.json"], "node-package"],
  [["pyproject.toml"], "python-project"],
  [["go.mod"], "go-module"],
  [["Cargo.toml"], "rust-crate"],
  [["pom.xml"], "maven-project"],
  [["build.gradle.kts"], "gradle-project"],
  [["service.csproj"], "dotnet-project"],
  [["main.tf"], "terraform-project"]
];

for (const [files, marker] of markerCases) {
  test(`project marker detects ${marker}`, () => assert.equal(detectProjectMarker(files).kind, marker));
}

test("project marker priority is deterministic", () => {
  assert.deepEqual(detectProjectMarker(["pyproject.toml", "package.json"]), {
    kind: "node-package",
    file: "package.json"
  });
});

test("directory without a project marker is not a Project", () => {
  assert.equal(detectProjectMarker(["README.md", "src"]), undefined);
});

test("inventory fingerprint ignores caller insertion order", () => {
  const first = { schemaVersion: 1, repositories: [{ logicalPath: "b" }, { logicalPath: "a" }], projects: [] };
  const second = { projects: [], repositories: [{ logicalPath: "a" }, { logicalPath: "b" }], schemaVersion: 1 };
  assert.equal(buildInventoryFingerprint(first), buildInventoryFingerprint(second));
  assert.match(buildInventoryFingerprint(first), /^sha256:[a-f0-9]{64}$/u);
});

test("inventory fingerprint changes with semantic ownership", () => {
  const first = { schemaVersion: 1, repositories: [{ logicalPath: ".", repositoryId: "sha256:a" }], projects: [] };
  const second = { schemaVersion: 1, repositories: [{ logicalPath: ".", repositoryId: "sha256:b" }], projects: [] };
  assert.notEqual(buildInventoryFingerprint(first), buildInventoryFingerprint(second));
});

test("workspace scanner public errors are exact and schema-valid", async () => {
  assert.deepEqual(workspacePublicErrorRegistry.codes, [
    "VES_WORKSPACE_CONTROL_ROOT_INVALID",
    "VES_WORKSPACE_GITFILE_INVALID",
    "VES_WORKSPACE_GIT_FAILED",
    "VES_WORKSPACE_INVENTORY_INVALID",
    "VES_WORKSPACE_OWNER_AMBIGUOUS",
    "VES_WORKSPACE_PATH_OUTSIDE_CONTROL",
    "VES_WORKSPACE_REMOTE_INVALID",
    "VES_WORKSPACE_SCAN_LIMIT"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of workspacePublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", workspacePublicErrorRegistry.create(code, {})).code, code);
  }
});
