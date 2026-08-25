import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { after, test } from "node:test";

import { exitStatusOf, runBootstrap } from "../../apps/vestra-launcher/src/bootstrap.ts";
import { LAUNCHER_EXIT_CODES } from "../../apps/vestra-launcher/src/public-errors.ts";
import { fixtureReleaseSource, fixtureTrustRoot } from "../helpers/vestra-launcher-fixture.mjs";

// The published orchestration, without spawning anything: what the bootstrap
// does with a closure's answer, and what it refuses to do with a bad one. The
// real closure is proved end to end in tests/e2e/vestra-launcher-activation.

const roots = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function packageRoot() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-launcher-unit-"));
  roots.push(root);
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(join(root, "config", "root.json"), fixtureTrustRoot());
  await writeFile(join(root, "config", "release-source.json"), JSON.stringify(fixtureReleaseSource()));
  return root;
}

const target = Object.freeze({
  runtimeExecutable: isAbsolute("/r/node") ? "/r/node" : "C:\\r\\node.exe",
  launcherPath: isAbsolute("/r/bin/vestra.mjs") ? "/r/bin/vestra.mjs" : "C:\\r\\bin\\vestra.mjs",
  releaseId: "release:verchestra:unit",
  semanticVersion: "1.0.0"
});

const closureThat = (overrides) => ({
  activate: async () => target,
  handoff: async () => ({ exitCode: 0, signal: null }),
  ...overrides
});

async function run(args, closure) {
  const lines = [];
  const root = await packageRoot();
  const status = await runBootstrap(
    args,
    { platform: process.platform, arch: process.arch, packageRoot: root },
    (line) => lines.push(line),
    closure
  );
  return { lines, status };
}

test("a clean child exit becomes the bootstrap's own exit status", () => {
  for (const exitCode of [0, 1, 3, 255]) {
    assert.equal(exitStatusOf({ exitCode, signal: null }), exitCode);
  }
});

test("a child terminated by signal is reported the way a shell reports one", () => {
  assert.equal(exitStatusOf({ exitCode: null, signal: "SIGKILL" }), 128 + constants.signals.SIGKILL);
  assert.equal(exitStatusOf({ exitCode: null, signal: "SIGTERM" }), 128 + constants.signals.SIGTERM);
  assert.equal(exitStatusOf({ exitCode: 0, signal: "SIGTERM" }), 128 + constants.signals.SIGTERM);
  assert.equal(exitStatusOf({ exitCode: null, signal: "SIGNOTREAL" }), 128);
});

test("an unusable termination status is a launch failure, never a success", () => {
  for (const outcome of [
    { exitCode: null, signal: null },
    { exitCode: -1, signal: null },
    { exitCode: 256, signal: null },
    { exitCode: 1.5, signal: null },
    { exitCode: "0", signal: null }
  ]) {
    assert.throws(() => exitStatusOf(outcome), { code: "VES_VESTRA_LAUNCH_FAILED" });
  }
});

test("a closure result without an absolute launcher location is refused", async () => {
  for (const returned of [
    { ...target, launcherPath: "bin/vestra.mjs" },
    { ...target, runtimeExecutable: "" },
    { ...target, launcherPath: undefined }
  ]) {
    const { status, lines } = await run(["--help"], closureThat({ activate: async () => returned }));
    assert.equal(status, LAUNCHER_EXIT_CODES.VES_VESTRA_ACTIVATION_UNAVAILABLE);
    assert.match(lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: /u);
  }
});

test("a handoff failure is a launch failure carrying the canonical code", async () => {
  const failure = Object.assign(new Error("spawn failed"), { code: "VES_LAUNCHER_PROCESS_FAILED" });
  const { status, lines } = await run(
    ["--help"],
    closureThat({
      handoff: async () => {
        throw failure;
      }
    })
  );
  assert.equal(status, LAUNCHER_EXIT_CODES.VES_VESTRA_LAUNCH_FAILED);
  assert.match(lines[0], /^VES_VESTRA_LAUNCH_FAILED: .*\(VES_LAUNCHER_PROCESS_FAILED\)\./u);
});

test("an argument vector carrying a null byte never reaches the closure", async () => {
  let reached = false;
  const { status, lines } = await run(
    ["--flag", "value\u0000injected"],
    closureThat({
      activate: async () => {
        reached = true;
        return target;
      }
    })
  );
  assert.equal(reached, false);
  assert.equal(status, LAUNCHER_EXIT_CODES.VES_VESTRA_INPUTS_INVALID);
  assert.match(lines[0], /^VES_VESTRA_INPUTS_INVALID: /u);
});

test("the argument vector reaches the closure exactly as it was given", async () => {
  const args = ["--message", 'a b "c"', "$(echo pwned)", "; rm -rf /"];
  let observed;
  const { status } = await run(
    args,
    closureThat({
      handoff: async (request) => {
        observed = request.args;
        return { exitCode: 0, signal: null };
      }
    })
  );
  assert.equal(status, 0);
  assert.deepEqual(observed, args);
});
