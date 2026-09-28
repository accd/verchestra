// invariant: #379 D4 — the read-only Workspace identity reader accepts exactly
// what `init` writes, reports an uninitialized root as absent, and fails
// closed on anything else.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { buildCanonicalInitFiles, readWorkspaceIdentity } from "../../packages/workspace/src/index.ts";

const workspaceId = "workspace_2f3e4d5c-6b7a-4980-a1b2-c3d4e5f6a7b8";
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function rootWith(content) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-identity-"));
  roots.push(root);
  if (content !== undefined) {
    await mkdir(join(root, ".verchestra"), { recursive: true });
    await writeFile(join(root, ".verchestra", "workspace.yaml"), content);
  }
  return root;
}

const canonical = () =>
  buildCanonicalInitFiles({
    workspaceId,
    displayName: "Identity: fixture",
    placementMode: "centralized",
    generatorVersion: "0.0.0-qualification"
  })[".verchestra/workspace.yaml"];

test("reads the identity exactly as init writes it", async () => {
  assert.deepEqual(await readWorkspaceIdentity(await rootWith(canonical())), { workspaceId });
  assert.deepEqual(await readWorkspaceIdentity(await rootWith(canonical().replaceAll("\n", "\r\n"))), { workspaceId });
});

test("an uninitialized control root has no identity", async () => {
  assert.equal(await readWorkspaceIdentity(await rootWith()), undefined);
  const bareMetadata = await rootWith();
  await mkdir(join(bareMetadata, ".verchestra"));
  assert.equal(await readWorkspaceIdentity(bareMetadata), undefined);
});

test("a present but malformed identity fails closed", async () => {
  for (const content of [
    "",
    `workspaceId: ${workspaceId}\n`,
    "schemaVersion: 1\n",
    `schemaVersion: 1\nworkspaceId: ${workspaceId}\nworkspaceId: ${workspaceId}\n`,
    "schemaVersion: 1\nworkspaceId: ../escape\n",
    "schemaVersion: 1\nworkspaceId: project_2f3e4d5c-6b7a-4980-a1b2-c3d4e5f6a7b8\n",
    `schemaVersion: 1\nworkspaceId: ${workspaceId} trailing\n`,
    `schemaVersion: 1\n  workspaceId: ${workspaceId}\n`,
    `schemaVersion: 1\nworkspaceId: ${workspaceId}\n${"#".repeat(70 * 1024)}\n`
  ])
    await assert.rejects(
      readWorkspaceIdentity(await rootWith(content)),
      { code: "VES_INIT_IDENTITY_INVALID" },
      content.slice(0, 60)
    );
});

test("a directory in place of the identity file fails closed", async () => {
  const root = await rootWith();
  await mkdir(join(root, ".verchestra", "workspace.yaml"), { recursive: true });
  await assert.rejects(readWorkspaceIdentity(root), { code: "VES_INIT_IDENTITY_INVALID" });
});
