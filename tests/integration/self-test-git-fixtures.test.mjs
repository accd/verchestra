// T70 T2: real, disposable Git repositories for the five workspace shapes
// (.specs/features/self-test-profiles/spec.md PRF-02).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { WORKSPACE_SHAPES } from "../../packages/application/src/index.ts";
import {
  BoundedFixtureFactory,
  DisposableRootProvider,
  GitFixtureFactory
} from "../../packages/self-test/src/index.ts";

const roots = [];

async function provisionedRoot() {
  const provider = new DisposableRootProvider({ baseDirectory: join(process.cwd(), ".tmp-selftest-git-fixtures") });
  const root = await provider.provision("workspace");
  roots.push(root.canonicalPath);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function isGitRepository(path) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: path, encoding: "utf8" }).trim();
    return true;
  } catch {
    return false;
  }
}

test("every declared workspace shape provisions", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  for (const shape of WORKSPACE_SHAPES) {
    const facts = await factory.provision(shape);
    assert.equal(facts.shape, shape);
    assert.ok(facts.controlRootPath.startsWith(root.canonicalPath));
  }
});

test("the control root is always a real Git repository", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  for (const shape of WORKSPACE_SHAPES) {
    const facts = await factory.provision(shape);
    assert.equal(isGitRepository(facts.controlRootPath), true, `${shape} control root must be a real repository`);
  }
});

test("standalone has no project directory; every other shape has one", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  assert.equal((await factory.provision("standalone")).projectPath, null);
  for (const shape of ["colocated", "centralized", "nested", "ignored"]) {
    assert.notEqual((await factory.provision(shape)).projectPath, null, shape);
  }
});

test("nested and ignored project directories are independently real Git repositories", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  for (const shape of ["nested", "ignored"]) {
    const facts = await factory.provision(shape);
    assert.equal(isGitRepository(facts.projectPath), true, `${shape} project must be its own repository`);
    assert.notEqual(facts.projectPath, facts.controlRootPath);
  }
});

test("the ignored shape's control root actually ignores the nested project path", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  const facts = await factory.provision("ignored");
  const status = execFileSync("git", ["check-ignore", facts.projectPath], {
    cwd: facts.controlRootPath,
    encoding: "utf8"
  }).trim();
  assert.equal(status, facts.projectPath);
});

test("the nested shape's project path is not ignored by the control root", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  const facts = await factory.provision("nested");
  assert.throws(() =>
    execFileSync("git", ["check-ignore", facts.projectPath], { cwd: facts.controlRootPath, encoding: "utf8" })
  );
});

test("colocated and centralized project directories carry a project marker but no separate .git", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  for (const shape of ["colocated", "centralized"]) {
    const facts = await factory.provision(shape);
    await readFile(join(facts.projectPath, "package.json"), "utf8");
    assert.equal(isGitRepository(facts.projectPath), true, "still inside the control repo's work tree");
    assert.equal(facts.controlRootPath, facts.controlRootPath);
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: facts.projectPath,
      encoding: "utf8"
    }).trim();
    assert.equal(toplevel, facts.controlRootPath, "the project shares the control root's repository");
  }
});

test("fixtures never read the real operator Git identity", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  const facts = await factory.provision("standalone");
  const name = execFileSync("git", ["config", "user.name"], { cwd: facts.controlRootPath, encoding: "utf8" }).trim();
  assert.equal(name, "Verchestra Self-Test");
});

test("provisioning every shape from one factory does not contaminate other shapes' repositories", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 16_777_216));
  const facts = {};
  for (const shape of WORKSPACE_SHAPES) facts[shape] = await factory.provision(shape);
  const colocatedFiles = execFileSync("git", ["ls-files"], {
    cwd: facts.colocated.controlRootPath,
    encoding: "utf8"
  }).trim();
  assert.doesNotMatch(colocatedFiles, /service/u, "colocated must not see nested's project files");
  const nestedFiles = execFileSync("git", ["ls-files"], { cwd: facts.nested.controlRootPath, encoding: "utf8" }).trim();
  assert.doesNotMatch(nestedFiles, /widget/u, "nested must not see colocated's project files");
});

test("a byte budget too small for the shape fails closed with the T69 escape/budget guard", async () => {
  const root = await provisionedRoot();
  const factory = new GitFixtureFactory(root, new BoundedFixtureFactory(root, 4));
  await assert.rejects(factory.provision("standalone"), { code: "VES_SELFTEST_FIXTURE_BUDGET" });
});
