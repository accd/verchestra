import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertProjectStatus,
  compileQualificationStatus,
  extractDescription,
  extractTitle,
  isCanonicalSourcePath,
  rewriteCanonicalLinks,
  resolveRepositoryPath,
  validateUniqueRoutes
} from "../../src/lib/repository-content.ts";

test("derives the exact public status from the canonical repository", async () => {
  const repositoryRoot = new URL("../../../../", import.meta.url);
  const status = await compileQualificationStatus(repositoryRoot);

  assert.deepEqual(status, {
    currentVersion: "0.0.0-qualification",
    highestVerifiedTask: 68,
    nextTask: 69,
    reportCount: 68
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
