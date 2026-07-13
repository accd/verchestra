import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStateRoot, resolveWorkspaceState } from "../../packages/platform-node/src/index.ts";

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

test("Windows state uses LOCALAPPDATA", () => {
  assert.equal(
    resolveStateRoot({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
      homeDirectory: "C:\\Users\\alice"
    }),
    "C:\\Users\\alice\\AppData\\Local\\Verchestra\\state"
  );
});

test("Windows state falls back to the home-local profile", () => {
  assert.equal(
    resolveStateRoot({ platform: "win32", env: {}, homeDirectory: "C:\\Users\\alice" }),
    "C:\\Users\\alice\\AppData\\Local\\Verchestra\\state"
  );
});

test("empty LOCALAPPDATA is treated as unset", () => {
  assert.equal(
    resolveStateRoot({ platform: "win32", env: { LOCALAPPDATA: "" }, homeDirectory: "C:\\Users\\alice" }),
    "C:\\Users\\alice\\AppData\\Local\\Verchestra\\state"
  );
});

test("macOS state uses Application Support", () => {
  assert.equal(
    resolveStateRoot({ platform: "darwin", env: {}, homeDirectory: "/Users/alice" }),
    "/Users/alice/Library/Application Support/Verchestra/state"
  );
});

test("Linux state honors absolute XDG_STATE_HOME", () => {
  assert.equal(
    resolveStateRoot({ platform: "linux", env: { XDG_STATE_HOME: "/state/alice" }, homeDirectory: "/home/alice" }),
    "/state/alice/verchestra"
  );
});

test("Linux state falls back to dot-local state", () => {
  assert.equal(
    resolveStateRoot({ platform: "linux", env: {}, homeDirectory: "/home/alice" }),
    "/home/alice/.local/state/verchestra"
  );
});

test("empty XDG_STATE_HOME is treated as unset", () => {
  assert.equal(
    resolveStateRoot({ platform: "linux", env: { XDG_STATE_HOME: "" }, homeDirectory: "/home/alice" }),
    "/home/alice/.local/state/verchestra"
  );
});

test("explicit absolute root supports ephemeral CI state", () => {
  assert.equal(
    resolveStateRoot({ platform: "linux", env: {}, homeDirectory: "/home/ci", override: "/job/42/vestra" }),
    "/job/42/vestra"
  );
});

for (const platform of ["win32", "darwin", "linux"]) {
  test(`${platform} rejects a relative explicit root`, () => {
    assert.throws(() => resolveStateRoot({ platform, env: {}, homeDirectory: "/home/a", override: "relative/state" }), {
      code: "VES_STATE_ROOT_INVALID"
    });
  });
}

test("unsupported platforms fail closed", () => {
  assert.throws(() => resolveStateRoot({ platform: "aix", env: {}, homeDirectory: "/home/a" }), {
    code: "VES_STATE_PLATFORM_UNSUPPORTED"
  });
});

test("Workspace state exposes the complete isolated local layout", () => {
  const state = resolveWorkspaceState({ stateRoot: "/state/verchestra", workspaceId, platform: "linux" });
  assert.equal(state.workspaceRoot, `/state/verchestra/workspaces/${workspaceId}`);
  assert.equal(state.runtimeDatabase, `${state.workspaceRoot}/runtime/runtime.sqlite`);
  assert.equal(state.memoryDatabase, `${state.workspaceRoot}/memory/memory.sqlite`);
  assert.equal(state.backupsRoot, `${state.workspaceRoot}/backups`);
  assert.equal(state.locksRoot, `${state.workspaceRoot}/locks`);
  assert.equal(state.secretsNamespace, `verchestra/${workspaceId}`);
  assert.equal(Object.isFrozen(state), true);
});

test("Workspace IDs cannot inject path segments", () => {
  assert.throws(
    () => resolveWorkspaceState({ stateRoot: "/state/verchestra", workspaceId: "../other", platform: "linux" }),
    { code: "VES_WORKSPACE_ID_INVALID" }
  );
});

test("Workspace layout rejects an unsupported platform", () => {
  assert.throws(() => resolveWorkspaceState({ stateRoot: "/state/verchestra", workspaceId, platform: "aix" }), {
    code: "VES_STATE_PLATFORM_UNSUPPORTED"
  });
});
