import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  compileAgentContext,
  parseRoadmapChain,
  qualificationStatusLine,
  resolveQualification,
  normalizeRepositoryPath,
  parseHandoff,
  validateHandoffTransition
} from "../../scripts/agent-readiness.mjs";

test("JSON context exposes the exact safe clean-clone contract", () => {
  const output = execFileSync(process.execPath, ["scripts/agent-context.mjs", "--json"], { encoding: "utf8" });
  const snapshot = JSON.parse(output);
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.repository, "accd/verchestra");
  assert.equal(snapshot.version, "0.0.0-qualification");
  assert.deepEqual(snapshot.qualification, { highestVerifiedTask: "T68", nextTask: "T68a" });
  assert.equal(snapshot.requiredReads[0], "AGENTS.md");
  assert.equal(snapshot.activeFeatures[0].handoffPath, ".specs/features/agent-ready-repository/handoff.md");
  assert.doesNotMatch(output, /[A-Za-z]:\\|\/(?:Users|home)\//u);
});

test("context degrades deterministically when Git is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-context-"));
  await mkdir(join(root, "docs", "qualification"), { recursive: true });
  await mkdir(join(root, ".specs", "features"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"version":"0.0.0-qualification"}\n');
  await writeFile(join(root, "docs", "qualification", "t68-validation.md"), "# T68\n");
  const snapshot = await compileAgentContext(root);
  assert.equal(snapshot.revision, "unknown");
  assert.equal(snapshot.branch, null);
  assert.equal(snapshot.dirty, false);
  assert.deepEqual(snapshot.qualification, { highestVerifiedTask: "T68", nextTask: "T69" });
});

const CHAIN = [
  "flowchart LR",
  '  T68["T68 Activation and rollback"] --> T68a["T68a Key lifecycle"]',
  '  T68a --> T68b["T68b Budget enforcement"]',
  '  T68b --> T68c["T68c Declarative gate repair"]',
  '  T68c --> T69["T69 Self-Test trust domain"]'
].join("\n");

const verified = (...tasks) => new Set(tasks);

test("roadmap edges parse with or without a labelled source", () => {
  assert.deepEqual(
    [...parseRoadmapChain(CHAIN)],
    [
      ["T68", "T68a"],
      ["T68a", "T68b"],
      ["T68b", "T68c"],
      ["T68c", "T69"]
    ]
  );
  assert.equal(parseRoadmapChain("").size, 0);
});

test("the chain walk advances past letter-suffixed tasks", () => {
  assert.deepEqual(resolveQualification(CHAIN, verified("T68")), {
    highestVerifiedTask: "T68",
    nextTask: "T68a"
  });
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a")), {
    highestVerifiedTask: "T68a",
    nextTask: "T68b"
  });
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a", "T68b", "T68c")), {
    highestVerifiedTask: "T68c",
    nextTask: "T69"
  });
});

test("the chain walk stops at the first gap and reports a fully verified chain", () => {
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a", "T68c")), {
    highestVerifiedTask: "T68a",
    nextTask: "T68b"
  });
  assert.deepEqual(resolveQualification(CHAIN, verified("T68", "T68a", "T68b", "T68c", "T69")), {
    highestVerifiedTask: "T69",
    nextTask: null
  });
  assert.deepEqual(resolveQualification(CHAIN, verified()), {
    highestVerifiedTask: null,
    nextTask: "T68"
  });
  assert.deepEqual(resolveQualification("", verified("T68")), { highestVerifiedTask: null, nextTask: null });
});

test("the status line names the next task or declares the chain fully verified", () => {
  assert.equal(qualificationStatusLine({ highestVerifiedTask: "T68", nextTask: "T68a" }), "T68 complete; T68a next");
  assert.equal(
    qualificationStatusLine({ highestVerifiedTask: "T77", nextTask: null }),
    "T77 complete; the declared chain is fully verified"
  );
});

test("handoff parser validates the portable contract and blocked requirements", () => {
  const source = `---
schema: verchestra-feature-handoff/v1
feature: example-feature
issue: 123
status: blocked
branch: feature/example
baseRevision: 0123456789012345678901234567890123456789
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm gate:quick
updatedAt: 2026-07-25T00:00:00Z
---

# Blockers

Unblock by restoring the fixture.
`;
  const handoff = parseHandoff(source);
  assert.equal(handoff.issue, 123);
  assert.equal(handoff.nextTask, "T3");
  assert.throws(() => parseHandoff(source.replace("# Blockers", "# Notes")), /needs a Blockers section/u);
});

test("handoff transitions reject regressions and duplicate completion replay", () => {
  assert.equal(validateHandoffTransition("planned", "in_progress"), true);
  assert.equal(validateHandoffTransition("in_progress", "verification"), true);
  assert.equal(validateHandoffTransition("verification", "complete"), true);
  assert.equal(validateHandoffTransition("complete", "in_progress"), false);
  assert.equal(validateHandoffTransition("in_progress", "planned"), false);
});

test("repository paths normalize Windows and POSIX separators", () => {
  assert.equal(
    normalizeRepositoryPath(String.raw`.specs\features\example\handoff.md`),
    ".specs/features/example/handoff.md"
  );
  assert.equal(normalizeRepositoryPath("./docs/architecture.md"), "docs/architecture.md");
});
