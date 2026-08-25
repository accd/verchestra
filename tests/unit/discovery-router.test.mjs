import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscoveryRouter } from "../../packages/agent-runtime/src/discovery/discovery-router.ts";
import { intake, output, qualification, request } from "../helpers/discovery-fixture.mjs";
import { withHostileLocaleCompare } from "../helpers/hostile-locale.mjs";

test("documented project uses bounded built-in intake", () => {
  const decision = new DiscoveryRouter().choose(request(), [qualification("reversa"), qualification("codenavi")]);
  assert.equal(decision.primary, "builtin-intake");
  assert.deepEqual(decision.supplemental, ["codenavi"]);
});

for (const documentation of [
  { present: false, reliable: false, stale: false },
  { present: true, reliable: false, stale: false },
  { present: true, reliable: true, stale: true }
]) {
  test(`legacy routing selects qualified Reversa for ${JSON.stringify(documentation)}`, () => {
    const decision = new DiscoveryRouter().choose(request({ documentation }), [qualification("reversa")]);
    assert.equal(decision.primary, "reversa");
    assert.equal(decision.humanReviewRequired, true);
  });
}

for (const [name, qualifications] of [
  ["missing", []],
  ["failed", [qualification("reversa", { status: "failed" })]],
  ["neutral", [qualification("reversa", { benefit: "neutral" })]],
  ["wrong class", [qualification("reversa", { projectClasses: ["java-service"] })]],
  ["expired", [qualification("reversa", { expiresAt: "2026-07-01T00:00:00.000Z" })]]
]) {
  test(`legacy routing falls back to built-in recon for ${name} qualification`, () => {
    const decision = new DiscoveryRouter().choose(
      request({ documentation: { present: false, reliable: false, stale: false } }),
      qualifications
    );
    assert.equal(decision.primary, "builtin-recon");
  });
}

for (const [name, qualifications, policy] of [
  ["missing evidence", [], { reversaAllowed: true, codeNaviAllowed: true }],
  [
    "failed evidence",
    [qualification("codenavi", { status: "failed" })],
    { reversaAllowed: true, codeNaviAllowed: true }
  ],
  ["no benefit", [qualification("codenavi", { benefit: "negative" })], { reversaAllowed: true, codeNaviAllowed: true }],
  [
    "wrong class",
    [qualification("codenavi", { projectClasses: ["legacy-java"] })],
    { reversaAllowed: true, codeNaviAllowed: true }
  ],
  ["policy disabled", [qualification("codenavi")], { reversaAllowed: true, codeNaviAllowed: false }]
]) {
  test(`CodeNavi does not run with ${name}`, () => {
    assert.deepEqual(new DiscoveryRouter().choose(request({ policy }), qualifications).supplemental, []);
  });
}

test("routing is deterministic across qualification order", () => {
  const router = new DiscoveryRouter();
  const values = [qualification("reversa"), qualification("codenavi")];
  assert.equal(
    router.choose(request(), values).decisionDigest,
    router.choose(request(), [...values].reverse()).decisionDigest
  );
});

// Issue #58: discovery-router.ts used to hash a private recursive
// serialization whose object members were ordered by ambient localeCompare, so
// the same intake report, routing decision, or Discovery Packet could be
// addressed by a different digest on another machine. All three are content
// addresses a reviewer and a promotion step quote, so they must be a property
// of the content alone.
test("intake, decision, and packet digests are byte-identical across two divergent locale collations", async () => {
  const router = new DiscoveryRouter();
  const digests = () => ({
    intake: router.intake(intake()).intakeDigest,
    decision: router.choose(request(), [qualification("reversa"), qualification("codenavi")]).decisionDigest,
    packet: router.normalize(output()).packetDigest
  });
  const plain = digests();
  assert.deepEqual(await withHostileLocaleCompare(digests), plain);
});

test("complete intake reports every canonical section with provenance", () => {
  const report = new DiscoveryRouter().intake(intake());
  assert.equal(Object.keys(report.sections).length, 10);
  assert.deepEqual(report.missingMandatoryInformation, []);
  assert.equal(report.intakeDigest.startsWith("sha256:"), true);
});

for (const section of [
  "stack",
  "applications",
  "buildCommands",
  "testCommands",
  "architectureSources",
  "projectBoundaries",
  "trackers",
  "knowledgeSources",
  "databaseRegistrations",
  "aiArtifacts"
]) {
  test(`intake reports missing ${section} explicitly`, () => {
    const value = intake();
    delete value.sections[section];
    const report = new DiscoveryRouter().intake(value);
    assert.equal(report.missingMandatoryInformation.includes(section), true);
    assert.deepEqual(report.sections[section].value, []);
  });
}
