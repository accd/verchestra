import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectLlmDocuments,
  compileLlmFull,
  compileLlmTxt,
  validateLlmDocuments,
  validateLlmHeadings,
  writeLlmBuildArtifacts
} from "../../src/lib/llm-content.ts";
import { compileQualificationStatus } from "../../src/lib/repository-content.ts";

const repositoryRoot = new URL("../../../../", import.meta.url);

test("root llms.txt is the exact deterministic concise projection", async () => {
  const status = await compileQualificationStatus(repositoryRoot);
  const expected = compileLlmTxt(status);
  const actual = await readFile(new URL("../../../../llms.txt", import.meta.url), "utf8");
  assert.equal(actual, expected);
  assert.match(actual, /T68c complete; T68d next/u);
  assert.match(actual, /does not guarantee indexing, SEO ranking, training inclusion, or crawler behavior/u);
});

test("full context is stable, attributed, complete, bounded, and path-safe", async () => {
  const status = await compileQualificationStatus(repositoryRoot);
  const documents = await collectLlmDocuments(repositoryRoot);
  const full = compileLlmFull(status, documents);
  assert.equal(compileLlmFull(status, documents), full);
  assert.equal(documents.filter(({ section }) => section === "Qualification").length >= 68, true);
  assert.equal(
    documents.some(({ sourcePath }) => sourcePath === "docs/qualification/t68-validation.md"),
    true
  );
  assert.equal(
    documents.some(({ sourcePath }) => sourcePath === "AGENTS.md"),
    true
  );
  assert.equal(
    documents.some(({ sourcePath }) => sourcePath.includes("integrations/codex.md")),
    true
  );
  assert.ok(Buffer.byteLength(full) < 1024 * 1024);
  assert.match(full, /Source: https:\/\//u);
  assert.match(full, /Content digest: `sha256:[0-9a-f]{64}`/u);
  assert.doesNotMatch(full, /[A-Za-z]:\\|\/(?:Users|home)\//u);
});

test("build writer emits text endpoints and a Markdown alternate for every public document route", async () => {
  const output = await mkdtemp(join(tmpdir(), "verchestra-llm-output-"));
  const result = await writeLlmBuildArtifacts(repositoryRoot, output);
  assert.equal(await readFile(join(output, "llms.txt"), "utf8"), result.concise);
  assert.equal(await readFile(join(output, "llms-full.txt"), "utf8"), result.full);
  const routed = result.documents.filter(({ route }) => route !== null);
  for (const document of routed) {
    const alternate = await readFile(join(output, ...document.route.split("/"), "index.html.md"), "utf8");
    assert.match(alternate, new RegExp(`^# ${document.title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
    assert.match(alternate, new RegExp(document.digest, "u"));
  }
});

test("compiler rejects duplicate routes, unsafe paths, malformed headings, and oversized output", async () => {
  const status = await compileQualificationStatus(repositoryRoot);
  const documents = await collectLlmDocuments(repositoryRoot);
  const routed = documents.find(({ route }) => route !== null);
  assert.ok(routed);
  assert.throws(() => validateLlmDocuments([...documents, routed]), /duplicate LLM route/u);
  assert.throws(
    () => validateLlmDocuments([{ ...documents[0], sourcePath: "../private.env", route: "unsafe" }]),
    /unsafe LLM source path/u
  );
  assert.throws(() => validateLlmHeadings("# Title\n\n### Jump\n", "fixture.md", false), /malformed heading jump/u);
  assert.throws(
    () => compileLlmFull(status, [{ ...documents[0], markdown: "x".repeat(1024 * 1024) }]),
    /exceeds 1 MiB/u
  );
});
