import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertProjectStatus,
  canonicalContentFilePath,
  compileQualificationStatus,
  extractDescription,
  extractTitle,
  QUALIFICATION_REPORT_FILE,
  qualificationSidebarItems,
  isCanonicalSourcePath,
  resolveQualification,
  validateRoadmapChain,
  rewriteCanonicalLinks,
  resolveRepositoryPath,
  validateUniqueRoutes
} from "../../src/lib/repository-content.ts";

const CHAIN = [
  "flowchart LR",
  '  T68["T68 Activation and rollback"] --> T68a["T68a Key lifecycle"]',
  '  T68a --> T68b["T68b Budget enforcement"]',
  '  T68b --> T69["T69 Self-Test trust domain"]'
].join("\n");

test("the public status walks the roadmap chain past letter-suffixed tasks", () => {
  assert.deepEqual(resolveQualification(CHAIN, new Set(["T68"])), {
    highestVerifiedTask: "T68",
    nextTask: "T68a",
    errors: []
  });
  assert.deepEqual(resolveQualification(CHAIN, new Set(["T68", "T68a"])), {
    highestVerifiedTask: "T68a",
    nextTask: "T68b",
    errors: []
  });
  assert.deepEqual(resolveQualification(CHAIN, new Set(["T68", "T68b"])), {
    highestVerifiedTask: "T68",
    nextTask: "T68a",
    errors: ["validation reports exist after the first gap: T68b"]
  });
});

test("the public status refuses an ambiguous or unclaimed roadmap", () => {
  const branched = '  T68 --> T68a["a"]\n  T68 --> T69["b"]';
  assert.ok(
    validateRoadmapChain(branched).errors.some((problem) => problem.includes("more than one successor")),
    "a branch must fail closed"
  );
  assert.deepEqual(validateRoadmapChain(branched).chain, []);
  assert.deepEqual(resolveQualification(CHAIN, new Set(["T68", "T68z"])).errors, [
    "T68z has a validation report but no roadmap node"
  ]);
  assert.deepEqual(resolveQualification("", new Set(["T68"])), {
    highestVerifiedTask: null,
    nextTask: null,
    errors: ["no roadmap chain is declared"]
  });
});

test("derives the exact public status from the canonical repository", async () => {
  const repositoryRoot = new URL("../../../../", import.meta.url);
  const status = await compileQualificationStatus(repositoryRoot);

  assert.deepEqual(status, {
    currentVersion: "0.0.0-qualification",
    highestVerifiedTask: "T69",
    nextTask: "T70",
    reportCount: 73
  });
  await assertProjectStatus(repositoryRoot, status);
});

test("rejects a missing report inside the completed qualification sequence", async () => {
  const fixture = join(tmpdir(), `verchestra-status-gap-${crypto.randomUUID()}`);
  await mkdir(join(fixture, "docs", "qualification"), { recursive: true });
  await writeFile(join(fixture, "package.json"), '{"version":"0.0.0-qualification"}');
  await writeFile(join(fixture, "README.md"), "`0.0.0-qualification`");
  await writeFile(join(fixture, "ROADMAP.md"), "T03 complete. T04 next.");
  await writeFile(join(fixture, "docs", "qualification", "t01-validation.md"), "# T01");
  await writeFile(join(fixture, "docs", "qualification", "t03-validation.md"), "# T03");

  await assert.rejects(
    compileQualificationStatus(new URL(`file:///${fixture.replaceAll("\\", "/")}/`)),
    /missing qualification report T02/
  );
});

test("rejects repository sources that escape the repository root", () => {
  assert.throws(() => resolveRepositoryPath(resolve("repository-fixture"), "../credentials.env"), /outside repository/);
});

test("reloads content only for allowlisted canonical sources", () => {
  const root = resolve("repository-fixture");
  assert.equal(isCanonicalSourcePath(root, resolve(root, "ROADMAP.md")), true);
  assert.equal(isCanonicalSourcePath(root, resolve(root, "docs/qualification/t68-validation.md")), true);
  assert.equal(isCanonicalSourcePath(root, resolve(root, "apps/site/.astro/content.json")), false);
  assert.equal(isCanonicalSourcePath(root, resolve(root, "packages/domain/src/index.ts")), false);
});

test("gives Astro safe synthetic paths for canonical content outside the site root", async () => {
  const loaderSource = await readFile(new URL("../../src/lib/repository-docs-loader.ts", import.meta.url), "utf8");

  assert.equal(
    canonicalContentFilePath("docs/qualification/t68-validation"),
    "src/content/docs/docs/qualification/t68-validation.md"
  );
  assert.throws(() => canonicalContentFilePath("../credentials"), /unsafe canonical content route/);
  assert.match(loaderSource, /filePath: canonicalContentFilePath\(source\.route\)/);
});

test("rewrites canonical repository links to public routes or auditable source files", () => {
  const sources = [
    { sourcePath: "CONTRIBUTING.md", route: "docs/community/contributing" },
    { sourcePath: "CODE_OF_CONDUCT.md", route: "docs/community/code-of-conduct" }
  ];
  const rewritten = rewriteCanonicalLinks(
    "Read [conduct](CODE_OF_CONDUCT.md) and [license](LICENSE).",
    sources[0],
    sources,
    "/verchestra"
  );
  assert.equal(
    rewritten,
    "Read [conduct](/verchestra/docs/community/code-of-conduct/) and [license](https://github.com/accd/verchestra/blob/main/LICENSE)."
  );
});

test("rejects duplicate public routes", () => {
  assert.throws(
    () =>
      validateUniqueRoutes([
        { id: "one", route: "docs/status" },
        { id: "two", route: "docs/status" }
      ]),
    /duplicate route docs\/status/
  );
});

test("derives stable title and description metadata from canonical Markdown", () => {
  const markdown = [
    "# Portable Handoff",
    "",
    "Transfer delivery work without transferring machine authority.",
    "",
    "## Details",
    "",
    "More context."
  ].join("\n");

  assert.equal(extractTitle(markdown), "Portable Handoff");
  assert.equal(extractDescription(markdown), "Transfer delivery work without transferring machine authority.");
});

// The convention was written out three times on this side, each fixed at two
// digits, so T68a was invisible to the docs loader, to the llms projection, and
// to the canonical-path check at the same time. One pattern now serves all
// three, and this is what proves it accepts an inserted task.
test("the qualification report pattern accepts inserted letter-suffixed tasks", () => {
  for (const accepted of ["t01-validation.md", "t68-validation.md", "t68a-validation.md", "t100-validation.md"])
    assert.equal(QUALIFICATION_REPORT_FILE.test(accepted), true, accepted);
  for (const rejected of ["t68a-key-lifecycle.md", "REPORT-CONTRACT.md", "supply-chain.md", "t-validation.md"])
    assert.equal(QUALIFICATION_REPORT_FILE.test(rejected), false, rejected);
});

test("an inserted letter-suffixed report is a canonical source like any other", () => {
  const root = resolve("repository-fixture");
  assert.equal(isCanonicalSourcePath(root, resolve(root, "docs/qualification/t68a-validation.md")), true);
  assert.equal(isCanonicalSourcePath(root, resolve(root, "docs/qualification/t100-validation.md")), true);
  assert.equal(isCanonicalSourcePath(root, resolve(root, "docs/qualification/t68a-key-lifecycle.md")), false);
  assert.equal(isCanonicalSourcePath(root, resolve(root, "docs/qualification/REPORT-CONTRACT.md")), false);
});

// A published report that no navigation entry points at is still invisible, so
// the sidebar is derived from the same directory the loader reads, and this
// asserts the two agree for the real repository.
test("every published qualification report has a navigation entry", async () => {
  const repositoryRoot = new URL("../../../../", import.meta.url);
  const reports = (await readdir(new URL("docs/qualification/", repositoryRoot)))
    .filter((entry) => QUALIFICATION_REPORT_FILE.test(entry))
    .map((entry) => `docs/qualification/${entry.replace(/\.md$/iu, "")}`)
    .sort();
  const items = qualificationSidebarItems(repositoryRoot);

  assert.ok(reports.includes("docs/qualification/t68a-validation"), "the inserted T68a report must be present");
  assert.deepEqual(
    items.map((item) => item.slug),
    reports
  );
  assert.equal(items.find((item) => item.slug.endsWith("t68a-validation")).label, "T68A validation");
});
