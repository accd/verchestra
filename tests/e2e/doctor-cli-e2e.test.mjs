// T72: `vestra doctor --deep` end to end, spawning the real binary (#13,
// DOC-01/DOC-05). A bare source checkout has no runtime, policy, driver, or
// native-asset fixtures, so the honest verdict is BLOCKED with remediations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
const dirs = [];

async function workdir() {
  const dir = await mkdtemp(join(tmpdir(), "verchestra-doctor-e2e-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), '{"private":true}\n');
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function launch(args, at) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url)), ...args],
    { cwd: at, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
  );
}

function jsonReport(at, args = ["doctor", "--deep", "--output", "json"]) {
  return JSON.parse(launch(args, at).stdout).data;
}

test("doctor --deep emits a JSON report that validates against doctor-report@1", async () => {
  const at = await workdir();
  const result = launch(["doctor", "--deep", "--output", "json"], at);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, "doctor");
  assert.equal(output.ok, true);
  assert.doesNotThrow(() => registry.validate("doctor-report", "1", output.data));
});

test("a bare source machine reports BLOCKED and exits 4", async () => {
  const at = await workdir();
  const result = launch(["doctor", "--deep", "--output", "json"], at);
  assert.equal(JSON.parse(result.stdout).data["doctor.verdict"], "BLOCKED");
  assert.equal(result.status, 4);
});

test("the human and JSON renderers project the same verdict and checks", async () => {
  const at = await workdir();
  const json = jsonReport(at);
  const human = launch(["doctor", "--deep"], at).stdout;
  assert.match(human, new RegExp(`doctor\\.verdict: ${json["doctor.verdict"]}`, "u"));
  for (const code of json["doctor.check_codes"]) assert.ok(human.includes(code), code);
});

test("a bare doctor runs the same deep diagnostic", async () => {
  const at = await workdir();
  const bare = jsonReport(at, ["doctor", "--output", "json"]);
  const deep = jsonReport(at);
  assert.equal(bare["doctor.verdict"], deep["doctor.verdict"]);
  assert.deepEqual(bare["doctor.check_codes"], deep["doctor.check_codes"]);
});

test("the report exposes no absolute machine path", async () => {
  const at = await workdir();
  const stdout = launch(["doctor", "--deep", "--output", "json"], at).stdout;
  assert.doesNotMatch(stdout, /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u);
});

test("every reported check belongs to the closed twelve-id catalog", async () => {
  const at = await workdir();
  const codes = jsonReport(at)["doctor.check_codes"];
  assert.equal(codes.length, 12);
  for (const code of codes) assert.match(code, /^doctor\.[a-z-]+:(pass|blocked|fail)$/u);
});

test("two runs converge to the same check fingerprint", async () => {
  const at = await workdir();
  assert.deepEqual(jsonReport(at)["doctor.check_codes"], jsonReport(at)["doctor.check_codes"]);
});

test("the read-only diagnostic writes nothing to the working directory", async () => {
  const at = await workdir();
  launch(["doctor", "--deep"], at);
  assert.deepEqual(readdirSync(at).sort(), ["package.json"]);
});
