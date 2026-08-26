// T70 T6: `vestra self-test` end to end, spawning the real binary
// (.specs/features/self-test-profiles/spec.md PRF-07).
//
// The invoking repository is placed under the repository's own scratch
// directory rather than os.tmpdir(), because a repository fixture wants a
// stable, inspectable location; the suite no longer needs that placement to
// avoid a guarded-root coincidence. The overlap this file previously
// documented as an unavoidable hazard — a control root that is an ancestor of
// the temporary directory, which is every Windows home directory — is fixed:
// the CLI now guards the Workspace it can actually locate rather than
// whatever directory the user is standing in. The two cases at the bottom of
// this file pin both halves of that behavior.
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
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  );
});

function launch(args, cwd, environment = {}) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url)), ...args],
    { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...environment } }
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

// Issue #370. The disposable base always lives under the OS temporary
// directory, so a control root that is an ancestor of it used to read as an
// overlap and refuse the run. On Windows that is the default home directory,
// so `npx verchestra self-test` failed for the first command a user would
// naturally type. Relocating the temporary directory into the control root
// reproduces exactly that configuration on every platform.
test("a control root that contains the temporary directory does not refuse the run", async () => {
  const root = await repositoryRoot();
  const temporary = join(root, "tmp");
  await mkdir(temporary, { recursive: true });
  const result = launch(["self-test", "--profile", "smoke"], root, {
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /self_test\.verdict: PASS/u);
});

// The guard itself must keep failing closed on the case it exists for: a
// disposable root provisioned inside real production state. A Workspace is
// production state, and it is what the workspace and full scenarios would
// damage, so a temporary directory inside a Workspace must still refuse.
test("a disposable root inside a real Workspace still fails closed", async () => {
  const root = await repositoryRoot();
  await mkdir(join(root, ".verchestra"), { recursive: true });
  await writeFile(
    join(root, ".verchestra", "workspace.yaml"),
    'schemaVersion: 1\nworkspaceId: guard-fixture\ndisplayName: "guard fixture"\nlanguage: en\nplacementMode: centralized\n'
  );
  const temporary = join(root, "tmp");
  await mkdir(temporary, { recursive: true });
  const result = launch(["self-test", "--profile", "smoke"], root, {
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /self_test\.verdict: PASS/u);
});
