import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertProjectStatus,
  compileQualificationStatus,
  extractDescription,
  extractTitle,
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
  assert.throws(() => resolveRepositoryPath("C:\\repo\\verchestra", "..\\credentials.env"), /outside repository/);
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
