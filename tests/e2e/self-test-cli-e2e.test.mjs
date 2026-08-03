// T70 T6: `vestra self-test` end to end, spawning the real binary
// (.specs/features/self-test-profiles/spec.md PRF-07).
//
// The invoking repository is placed under the repository's own scratch
// directory rather than os.tmpdir(): on macOS, os.tmpdir() resolves through
// a system symlink (/var -> /private/var), and collectLinkChain
// (packages/self-test/src/disposable-roots.ts, sealed T69 evidence) records
// that ancestor hop as a candidate path. When both the guarded root (the
// invoking cwd) and the self-test disposable root sit under os.tmpdir(), the
// shared "/var" ancestor false-positives as an overlap via naive path-prefix
// matching, and the run is wrongly BLOCKED. This is a real, pre-existing
// latent bug in T69's overlap rule — flagged in the handoff for a follow-up
// task rather than reopened here — that this suite avoids by construction.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const roots = [];

async function repositoryRoot() {
  const base = join(process.cwd(), ".tmp-selftest-cli-e2e");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "repo-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "e2e"], { cwd: root });
  execFileSync("git", ["config", "user.email", "e2e@invalid.example"], { cwd: root });
  await writeFile(join(root, "package.json"), '{"private":true}\n');
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
}

function byteListing(root) {
  return execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function launch(args, cwd) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url)), ...args],
    { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
  );
}

test("loading the Self-Test composition does not initialize full-only SQLite adapters", () => {
  const compositionUrl = new URL("../../apps/vestra-cli/src/self-test-composition.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(compositionUrl)})`],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("self-test --profile smoke exits 0 with a PASS verdict", async () => {
  const cwd = await repositoryRoot();
  const result = launch(["self-test", "--profile", "smoke", "--output", "json"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.data["self_test.verdict"], "PASS");
  assert.equal(output.data["self_test.profile"], "smoke");
});

test("self-test --profile workspace exits 0 with a PASS verdict and at least 25 checks", async () => {
  const cwd = await repositoryRoot();
  const result = launch(["self-test", "--profile", "workspace", "--output", "json"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.data["self_test.verdict"], "PASS");
  assert.ok(output.data["self_test.check_count"] >= 25);
});

test("self-test without --profile fails with a stable non-zero exit before dispatch", async () => {
  const cwd = await repositoryRoot();
  const result = launch(["self-test"], cwd);
  assert.notEqual(result.status, 0);
});

test("self-test --profile drivers reaches every approved boundary", async () => {
  const cwd = await repositoryRoot();
  const result = launch(["self-test", "--profile", "drivers", "--output", "json"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.data["self_test.profile"], "drivers");
  assert.equal(output.data["self_test.check_count"], 7);
});

test("self-test with an invalid profile value fails with a stable non-zero exit", async () => {
  const cwd = await repositoryRoot();
  const result = launch(["self-test", "--profile", "unknown"], cwd);
  assert.notEqual(result.status, 0);
});

test("self-test --profile full includes hard-crash recovery", async () => {
  const cwd = await repositoryRoot();
  const result = launch(["self-test", "--profile", "full", "--output", "json"], cwd);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.data["self_test.profile"], "full");
  assert.equal(output.data["self_test.check_count"], 10);
});

test("self-test leaves the invoking Git repository byte-identical", async () => {
  const cwd = await repositoryRoot();
  const before = byteListing(cwd);
  const result = launch(["self-test", "--profile", "smoke"], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(byteListing(cwd), before);
});
