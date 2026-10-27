// Contract for scripts/verify-provider-install.mjs: after `npm ci`, every
// package the lockfile names for this OS and CPU is installed at the pinned
// version, or the step fails naming it (#596).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { admits, installProblems } from "../../scripts/verify-provider-install.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/verify-provider-install.mjs", import.meta.url));

const LOCK = Object.freeze({
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { cli: "1.0.0" } },
    "node_modules/cli": { version: "1.0.0" },
    "node_modules/cli-linux-x64": { version: "1.0.0", optional: true, os: ["linux"], cpu: ["x64"] },
    "node_modules/cli-linux-arm64": { version: "1.0.0", optional: true, os: ["linux"], cpu: ["arm64"] },
    "node_modules/cli-darwin-arm64": { version: "1.0.0", optional: true, os: ["darwin"], cpu: ["arm64"] }
  }
});

async function install(context, installed, lock = LOCK) {
  const directory = await temporaryDirectory(context, "ves-provider-install-");
  await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
  for (const [key, version] of Object.entries(installed)) {
    await mkdir(join(directory, key), { recursive: true });
    await writeFile(join(directory, key, "package.json"), JSON.stringify({ version }));
  }
  return directory;
}

const LINUX = Object.freeze({ platform: "linux", arch: "x64" });

test("npm's platform rule: a plain entry admits only itself, a negated one excludes", () => {
  assert.equal(admits(undefined, "linux"), true);
  assert.equal(admits(["linux"], "linux"), true);
  assert.equal(admits(["linux"], "darwin"), false);
  assert.equal(admits(["!win32"], "linux"), true);
  assert.equal(admits(["!win32"], "win32"), false);
});

test("a complete install for this platform passes without the other platforms' packages", async (context) => {
  const directory = await install(context, { "node_modules/cli": "1.0.0", "node_modules/cli-linux-x64": "1.0.0" });
  assert.deepEqual(installProblems(directory, LINUX), []);
});

test("a platform package npm skipped is named", async (context) => {
  // What `npm ci` leaves behind when the tarball fails its integrity check.
  const directory = await install(context, { "node_modules/cli": "1.0.0" });
  assert.deepEqual(installProblems(directory, LINUX), ["node_modules/cli-linux-x64 1.0.0 is not installed"]);
});

test("a package at another version than the lockfile pins is named", async (context) => {
  const directory = await install(context, { "node_modules/cli": "1.0.1", "node_modules/cli-linux-x64": "1.0.0" });
  assert.deepEqual(installProblems(directory, LINUX), ["node_modules/cli is 1.0.1, the lockfile pins 1.0.0"]);
});

test("a lockfile that names no package for this platform is refused, not passed", async (context) => {
  const directory = await install(context, {}, { lockfileVersion: 3, packages: { "": {} } });
  assert.deepEqual(installProblems(directory, LINUX), ["the lockfile names no package for linux-x64"]);
});

test("the command fails naming the missing package, and passes a complete install", async (context) => {
  const lock = structuredClone(LOCK);
  const host = `node_modules/cli-${process.platform}-${process.arch}`;
  lock.packages[host] = { version: "1.0.0", optional: true, os: [process.platform], cpu: [process.arch] };
  const missing = await install(context, { "node_modules/cli": "1.0.0" }, lock);
  const refused = spawnSync(process.execPath, [SCRIPT, missing], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, new RegExp(`provider install refused: ${host} 1\\.0\\.0 is not installed`, "u"));
  const complete = await install(context, { "node_modules/cli": "1.0.0", [host]: "1.0.0" }, lock);
  const passed = spawnSync(process.execPath, [SCRIPT, complete], { encoding: "utf8" });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /provider install matches the lockfile/u);
});
