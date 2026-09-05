import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { CodexDriver } from "../../packages/drivers/src/index.ts";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";

const execFileAsync = promisify(execFile);

test("explicit Codex context isolates real probe and execution from a synthetic controller environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-codex-context-"));
  try {
    const worktree = join(root, "worktree");
    await mkdir(worktree);
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../helpers/codex-context-controller.mjs", import.meta.url)), worktree],
      {
        cwd: root,
        env: {
          HOME: "synthetic-controller-home",
          USERPROFILE: "synthetic-controller-profile",
          CODEX_HOME: "synthetic-controller-codex",
          CODEX_THREAD_ID: "synthetic-controller-thread",
          CODEX_TURN_ID: "synthetic-controller-turn",
          PATH: "synthetic-controller-path"
        },
        timeout: 15000,
        windowsHide: true
      }
    );
    for (const phase of ["probe", "start"]) {
      const observed = JSON.parse(await readFile(join(worktree, `${phase}.json`), "utf8"));
      assert.deepEqual(observed, { cwd: worktree, marker: phase === "probe" ? "probe" : "execution", inherited: [] });
      await assert.rejects(readFile(join(root, `${phase}.json`)), { code: "ENOENT" });
    }
    // Discrimination control: the same observer must reject the legacy context,
    // which inherits synthetic identity and starts in the controller directory.
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          fileURLToPath(new URL("../helpers/codex-context-controller.mjs", import.meta.url)),
          worktree,
          "--without-context"
        ],
        {
          cwd: root,
          env: {
            HOME: "synthetic-controller-home",
            USERPROFILE: "synthetic-controller-profile",
            CODEX_HOME: "synthetic-controller-codex"
          },
          timeout: 15000,
          windowsHide: true
        }
      ),
      { code: 1 }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit empty environment is rejected instead of falling back to controller identity", () => {
  const context = { cwd: process.cwd(), environment: {} };
  assert.throws(() => new CodexDriver(codexFixture().dependencies({ processContext: context })), {
    code: "VES_CODEX_PROCESS_CONTEXT_INVALID"
  });
});

test("returned maps and mixed-case reuse keys cannot change explicit driver identity", () => {
  const context = {
    cwd: process.cwd(),
    environment: { HOME: process.cwd(), USERPROFILE: process.cwd(), CODEX_HOME: process.cwd() }
  };
  const driver = new CodexDriver(codexFixture().dependencies({ processContext: context }));
  const expected = driver.buildEnvironment();
  driver.buildEnvironment().HOME = "synthetic-returned-map";
  assert.deepEqual(driver.buildEnvironment(), expected);
  assert.deepEqual(driver.buildEnvironment({ codex_thread_id: "synthetic", codex_turn_id: "synthetic" }), expected);
});

for (const [index, context] of [
  null,
  [],
  { cwd: "relative", environment: {} },
  { cwd: `${process.cwd()}\0`, environment: {} },
  { cwd: process.cwd() },
  { cwd: process.cwd(), environment: null },
  { cwd: process.cwd(), environment: [] },
  { cwd: process.cwd(), environment: { "INVALID=NAME": "synthetic" } },
  { cwd: process.cwd(), environment: { VALUE: 1 } },
  { cwd: process.cwd(), environment: { VALUE: "synthetic\0value" } }
].entries()) {
  test(`malformed Codex process context case ${index} is rejected before resolution`, () => {
    const fixture = codexFixture();
    assert.throws(() => new CodexDriver(fixture.dependencies({ processContext: context })), {
      code: "VES_CODEX_PROCESS_CONTEXT_INVALID",
      message: "Codex process context is invalid"
    });
    assert.deepEqual(fixture.calls, { resolve: 0, spawn: 0, terminate: 0 });
  });
}

test("explicit context requires an absolute executable instead of ambient command discovery", () => {
  const fixture = codexFixture();
  assert.throws(
    () =>
      new CodexDriver(
        fixture.dependencies({
          command: ["codex"],
          processContext: {
            cwd: process.cwd(),
            environment: { HOME: process.cwd(), USERPROFILE: process.cwd(), CODEX_HOME: process.cwd() }
          }
        })
      ),
    { code: "VES_CODEX_PROCESS_CONTEXT_INVALID" }
  );
  assert.equal(fixture.calls.spawn, 0);
});

test("each identity directory is required and per-operation overlays cannot re-enable fallback", () => {
  const environment = { HOME: process.cwd(), USERPROFILE: process.cwd(), CODEX_HOME: process.cwd() };
  for (const key of Object.keys(environment)) {
    const missing = { ...environment };
    delete missing[key];
    assert.throws(
      () =>
        new CodexDriver(
          codexFixture().dependencies({
            processContext: { cwd: process.cwd(), environment: missing }
          })
        ),
      { code: "VES_CODEX_PROCESS_CONTEXT_INVALID" }
    );
  }
  const driver = new CodexDriver(codexFixture().dependencies({ processContext: { cwd: process.cwd(), environment } }));
  for (const value of ["", "relative", "synthetic\0value"]) {
    assert.throws(() => driver.buildEnvironment({ HOME: value }), { code: "VES_CODEX_PROCESS_CONTEXT_INVALID" });
  }
  if (process.platform === "win32") {
    assert.throws(() => driver.buildEnvironment({ Path: "one", PATH: "two" }), {
      code: "VES_CODEX_PROCESS_CONTEXT_INVALID"
    });
    assert.throws(() => driver.buildEnvironment({ home: "relative" }), { code: "VES_CODEX_PROCESS_CONTEXT_INVALID" });
  }
});
