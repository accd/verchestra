import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/t75-evidence-signing.yml", import.meta.url), "utf8");

test("the T75 evidence workflow is manual, exact-SHA bound, and accepts all five fleet profiles", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  for (const name of ["revision", "quick_run_id", "full_run_id", "build_run_id", "security_run_id", "release_run_id"])
    assert.match(workflow, new RegExp(`^ {6}${name}:`, "mu"), `${name} must be a dispatch input`);
  assert.match(workflow, /git rev-parse HEAD/u);
  assert.match(workflow, /does not resolve to the requested exact revision/u);
  assert.match(workflow, /platform-evidence-index\.json/u);
  assert.match(workflow, /t75-evidence-index\.mjs --revision "\$CANDIDATE_REVISION"/u);
  assert.match(workflow, /Refuse to sign contradictory qualification evidence/u);
  assert.match(workflow, /summary\?\.contradictions !== 0/u);
  assert.match(workflow, /exactly one profile for each T75 gate/u);
});

test("the workflow reads a protected PKCS#8 secret only in the signing step and verifies before publishing", () => {
  assert.match(
    workflow,
    /VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64: \$\{\{ secrets\.VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64 \}\}/u
  );
  assert.doesNotMatch(workflow, /echo.*VESTRA_T75_EVIDENCE_SIGNING_KEY_PKCS8_BASE64/iu);
  assert.match(workflow, /t75-evidence-attestation\.mjs sign/u);
  assert.match(workflow, /t75-evidence-attestation\.mjs verify/u);
  assert.match(workflow, /signed-evidence-index\.json/u);
});

test("the workflow publishes only public verification material through pinned actions", () => {
  const uses = [...workflow.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (\S+)/gu)];
  // checkout, pnpm setup, node setup, five artifact downloads, one upload.
  // The two setup actions are what let the run load the signer at all: the
  // attestation script reaches packages/evidence, whose V1 canonicalizer is a
  // real dependency, and this workflow previously had no install step.
  assert.equal(uses.length, 9, "checkout, two setups, five artifact downloads, and one upload are expected");
  for (const [, action, , version] of uses)
    assert.match(version, /^v\d+\.\d+\.\d+$/u, `${action} must carry its reviewed action version comment`);
  assert.match(workflow, /docs\/qualification-evidence-attestation\.md/u);
  assert.match(workflow, /public_key_ref_path/u);
  assert.match(workflow, /qualification-evidence-index\.dsse\.json/u);
});

test("a workflow that runs repository Node code installs its dependencies first", () => {
  // This workflow ran `node scripts/t75-evidence-attestation.mjs` with no Node
  // setup and no install at all, so it could not even load the signer:
  // packages/evidence's V1 canonicalizer is a real dependency. It had never
  // been dispatched, so nothing caught it.
  const install = workflow.indexOf("pnpm install --frozen-lockfile");
  const firstNodeRun = workflow.indexOf("node scripts/");
  assert.ok(install >= 0, "the workflow installs dependencies");
  assert.ok(firstNodeRun >= 0, "the workflow runs repository Node code");
  assert.ok(install < firstNodeRun, "dependencies are installed before any repository script runs");
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/u);
  assert.match(workflow, /node-version: 24\.14\.0/u);
});
