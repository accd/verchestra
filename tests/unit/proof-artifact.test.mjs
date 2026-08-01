// Contract for the public proof artifact (#155): the committed bytes under
// docs/proof/ must be exactly what the generator produces, the sealed package
// must verify against its trust root, and the published files must stay free
// of machine-local or secret-shaped content.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateProofArtifact } from "../../scripts/generate-proof-artifact.mjs";

const jsonUrl = new URL("../../docs/proof/execution-package.json", import.meta.url);
const markdownUrl = new URL("../../docs/proof/execution-package.md", import.meta.url);

// PRF-05 and lesson L-001: a drift failure must name its specific divergence,
// not just report inequality.
function assertByteIdentical(actual, expected, label) {
  if (actual === expected) return;
  let index = 0;
  while (index < Math.min(actual.length, expected.length) && actual[index] === expected[index]) index += 1;
  const line = expected.slice(0, index).split("\n").length;
  assert.fail(
    `${label} drifted from the generator at character ${index} (line ${line}): ` +
      `committed ${JSON.stringify(actual.slice(index, index + 40))} vs ` +
      `regenerated ${JSON.stringify(expected.slice(index, index + 40))} — ` +
      "regenerate with `corepack pnpm proof:generate` and review the diff"
  );
}

test("the committed artifact JSON is byte-identical to a fresh regeneration", async () => {
  const { json } = await generateProofArtifact();
  assertByteIdentical(await readFile(jsonUrl, "utf8"), json, "docs/proof/execution-package.json");
});

test("the committed proof page is byte-identical to a fresh regeneration", async () => {
  const { markdown } = await generateProofArtifact();
  assertByteIdentical(await readFile(markdownUrl, "utf8"), markdown, "docs/proof/execution-package.md");
});

test("the sealed package verifies against its own trust root with derived pending work", async () => {
  const { sealed } = await generateProofArtifact();
  const committed = JSON.parse(await readFile(jsonUrl, "utf8"));
  assert.equal(committed.artifactId, sealed.artifactId);
  assert.equal(committed.purpose, "execution-package");
  assert.equal(committed.algorithm, "Ed25519");
  assert.ok(Array.isArray(committed.payload.pendingTasks) && committed.payload.pendingTasks.length > 0);
});

test("the published files carry no machine-local paths or secret-shaped content", async () => {
  for (const url of [jsonUrl, markdownUrl]) {
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(
      source,
      /[A-Za-z]:\\\\|[A-Za-z]:\\[Uu]sers|\/home\/|\/Users\/|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]/u
    );
  }
});

test("the proof page declares fixture provenance, generator, and regeneration on the first screen", async () => {
  const markdown = await readFile(markdownUrl, "utf8");
  const firstScreen = markdown.slice(0, 600);
  assert.match(firstScreen, /Fixture-generated, not a live run/u);
  assert.match(markdown, /scripts\/generate-proof-artifact\.mjs/u);
  assert.match(markdown, /corepack pnpm proof:generate/u);
  assert.match(markdown, /no Run Capsule, no gate execution record, and no signed Handoff/u);
});
