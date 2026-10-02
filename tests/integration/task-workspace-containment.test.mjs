// invariant: the task path keeps three state roots beside the Workspace
// layout: `tasks/` (the Run records), `keys/` (the evidence key and its trust
// anchor) and `verification/` (scratch checkouts, which are deleted
// recursively). Each must resolve inside the Workspace state root (ADP-2). The
// check only reads: none of the three is created by opening the Workspace, so
// a dry run still writes nothing.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { openTaskWorkspace } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import {
  platformSecurityPublicErrorRegistry,
  resolveStateRoot,
  resolveWorkspaceState
} from "../../packages/platform-node/src/index.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  objectFormatRepository
} from "../helpers/git-object-format-fixture.mjs";
import { WORKSPACE_ID } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupObjectFormatRepositories);

const ROOTS = Object.freeze(["tasks", "keys", "verification"]);
const LAYOUT = Object.freeze(["backups", "cache", "locks", "logs", "memory", "runtime", "sessions", "worktrees"]);
const MODES = Object.freeze([
  { name: "a dry run", options: { ensure: false } },
  { name: "a command", options: { ensure: true } }
]);
const ESCAPE = { name: "PlatformSecurityError", code: "VES_STATE_ROOT_ESCAPE" };

function sorted(names) {
  return [...names].sort((left, right) => Number(left > right) - Number(left < right));
}

// why: the Workspace is a real repository whose root holds the identity file,
// and its state root lives under a home that belongs to the fixture.
async function workspaceFixture() {
  const repository = await objectFormatRepository(OBJECT_FORMATS[0]);
  await mkdir(join(repository.repositoryRoot, ".verchestra"));
  await writeFile(
    join(repository.repositoryRoot, ".verchestra", "workspace.yaml"),
    `schemaVersion: 1\nworkspaceId: ${WORKSPACE_ID}\n`
  );
  const home = join(repository.root, "home");
  const io = { controlRoot: repository.repositoryRoot, platform: process.platform, homeDirectory: home, env: {} };
  const { workspaceRoot } = resolveWorkspaceState({
    stateRoot: resolveStateRoot(io),
    workspaceId: WORKSPACE_ID,
    platform: process.platform
  });
  const outside = join(repository.root, "outside");
  await mkdir(outside);
  return {
    io,
    home,
    workspaceRoot,
    outside,
    link: async (name, target) => {
      await mkdir(workspaceRoot, { recursive: true });
      await symlink(target, join(workspaceRoot, name), "junction");
    }
  };
}

test("a dry run resolves the three task state roots and creates nothing", async () => {
  const fixture = await workspaceFixture();
  const workspace = await openTaskWorkspace(fixture.io, { ensure: false });
  assert.equal(workspace.workspaceId, WORKSPACE_ID);
  assert.equal(workspace.tasksRoot, join(fixture.workspaceRoot, "tasks"));
  assert.equal(workspace.keysRoot, join(fixture.workspaceRoot, "keys"));
  assert.equal(workspace.verificationRoot, join(fixture.workspaceRoot, "verification"));
  assert.equal(existsSync(fixture.home), false, "a dry run created state");
});

test("opening the Workspace creates its layout and none of the task state roots", async () => {
  const fixture = await workspaceFixture();
  const workspace = await openTaskWorkspace(fixture.io);
  assert.deepEqual(sorted(await readdir(fixture.workspaceRoot)), LAYOUT);
  for (const root of [workspace.tasksRoot, workspace.keysRoot, workspace.verificationRoot])
    assert.equal(dirname(root), fixture.workspaceRoot);
});

for (const mode of MODES) {
  test(`${mode.name} accepts task state roots that are real directories`, async () => {
    const fixture = await workspaceFixture();
    for (const name of ROOTS) await mkdir(join(fixture.workspaceRoot, name), { recursive: true });
    const workspace = await openTaskWorkspace(fixture.io, mode.options);
    assert.equal(workspace.tasksRoot, join(fixture.workspaceRoot, "tasks"));
  });

  for (const name of ROOTS) {
    test(`${mode.name} refuses a ${name} root that is a link out of the Workspace`, async () => {
      const fixture = await workspaceFixture();
      await fixture.link(name, fixture.outside);
      const before = sorted(await readdir(fixture.workspaceRoot));
      await assert.rejects(openTaskWorkspace(fixture.io, mode.options), ESCAPE);
      assert.deepEqual(await readdir(fixture.outside), [], "something was written through the link");
      if (!mode.options.ensure)
        assert.deepEqual(sorted(await readdir(fixture.workspaceRoot)), before, "a refused dry run created state");
    });

    test(`${mode.name} refuses a ${name} root whose link target is gone`, async () => {
      const fixture = await workspaceFixture();
      await fixture.link(name, join(fixture.outside, "gone"));
      await assert.rejects(openTaskWorkspace(fixture.io, mode.options), ESCAPE);
      assert.deepEqual(await readdir(fixture.outside), []);
    });
  }

  test(`${mode.name} refuses a root that resolves to the Workspace state root or above it`, async () => {
    for (const target of [(fixture) => fixture.workspaceRoot, (fixture) => dirname(fixture.workspaceRoot)]) {
      const fixture = await workspaceFixture();
      await fixture.link("verification", target(fixture));
      await assert.rejects(openTaskWorkspace(fixture.io, mode.options), ESCAPE);
    }
  });

  // why: the same rule the Workspace layout already follows: a link is not
  // refused for being a link, only for where it resolves.
  test(`${mode.name} accepts a root that is a link to a directory inside the Workspace state root`, async () => {
    const fixture = await workspaceFixture();
    await mkdir(join(fixture.workspaceRoot, "moved-tasks"), { recursive: true });
    await fixture.link("tasks", join(fixture.workspaceRoot, "moved-tasks"));
    const workspace = await openTaskWorkspace(fixture.io, mode.options);
    assert.equal(workspace.tasksRoot, join(fixture.workspaceRoot, "tasks"));
  });
}

test("the refusal is a public platform security error with no detail to leak", () => {
  const definition = platformSecurityPublicErrorRegistry.definitions.find(
    (entry) => entry.code === "VES_STATE_ROOT_ESCAPE"
  );
  assert.equal(definition.category, "security");
  assert.deepEqual(definition.safeDetails, {});
});
