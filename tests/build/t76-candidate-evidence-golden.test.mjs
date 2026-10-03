// ADR2-2 byte identity: the three programs the candidate workflow embedded, run
// verbatim from main's last copy of it, and scripts/t76-candidate-evidence.mjs,
// run through the command line the workflow now calls, are given the same
// inputs and must write the same bytes, or both refuse.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import {
  GATE_PROFILES,
  SUPPORTED_TARGET_KEYS,
  reconcileTargetIndex,
  sealGateEvaluation,
  sealTargetEvidence
} from "../../scripts/t76-candidate-evidence.mjs";
import {
  INLINE_WORKFLOW_SHA256,
  inlineWorkflowDigest,
  reconcileBoth,
  replayCandidateRun,
  sealGateBoth,
  sealTargetBoth
} from "../helpers/t76-inline-evidence-writers.mjs";
import { bundleForTarget } from "../helpers/t76-publication-fixture.mjs";

const REVISION = "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334";
const RELEASE_ID = "release:verchestra:0.0.0-qualification.6:a1b2c3d4e5f6";
const SEMANTIC_VERSION = "0.0.0-qualification.6";
const NODE_VERSION = "24.14.0";
const IDENTITY = Object.freeze({ revision: REVISION, releaseId: RELEASE_ID, semanticVersion: SEMANTIC_VERSION });
const EVIDENCE_KINDS = new Set(["license", "sbom", "provenance", "evaluation"]);

const roots = [];
after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
});

const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t76-golden-"));
  roots.push(root);
  const sides = { inline: join(root, "inline"), module: join(root, "module") };
  await Promise.all(Object.values(sides).map((side) => mkdir(side, { recursive: true })));
  return sides;
};

const targetOf = (key) => {
  const [platform, arch] = key.split("-");
  return { platform, arch, nodeVersion: NODE_VERSION };
};

// why: a gate log as node:test prints it into the workflow's tee: several
// suites, each with its own summary, the step's own noise, and CRLF line ends on
// Windows. The counters differ per profile and target so a swapped or dropped
// record changes the bytes.
const gateLog = (profile, key, newline) => {
  const seed = GATE_PROFILES.indexOf(profile) * 7 + SUPPORTED_TARGET_KEYS.indexOf(key) * 3;
  const suite = (tests, skipped, todo) =>
    [
      `\u25b6 ${profile} suite`,
      `  \u2714 passes (${seed}.5ms)`,
      `\u2139 tests ${tests}`,
      "\u2139 suites 1",
      `\u2139 pass ${tests - skipped - todo}`,
      "\u2139 fail 0",
      "\u2139 cancelled 0",
      `\u2139 skipped ${skipped}`,
      `\u2139 todo ${todo}`,
      "\u2139 duration_ms 12.5"
    ].join(newline);
  return [
    `> verchestra@0.0.0-qualification gate:${profile}`,
    "info tests 999 is not a summary line",
    suite(100 + seed, seed % 2, 0),
    suite(2000 + seed * 11, 0, seed % 3),
    ""
  ].join(newline);
};

const sealGatesWithBoth = async (sides, key, statuses = {}) => {
  const newline = key.startsWith("win32") ? "\r\n" : "\n";
  for (const side of Object.values(sides)) await writeFile(join(side, "gate-evaluations.json"), "");
  for (const profile of GATE_PROFILES) {
    const log = `gate-${profile}.log`;
    const status = String(statuses[profile] ?? 0);
    for (const side of Object.values(sides)) await writeFile(join(side, log), gateLog(profile, key, newline));
    const { inline, module } = await sealGateBoth(sides, { profile, status, log });
    assert.equal(inline.status, 0, inline.stderr);
    assert.equal(module.status, 0, module.stderr);
    assert.deepEqual(
      await readFile(join(sides.module, "gate-evaluations.json")),
      await readFile(join(sides.inline, "gate-evaluations.json")),
      `${key} ${profile}: the sealed gate evaluations differ`
    );
  }
  return readFile(join(sides.inline, "gate-evaluations.json"));
};

// why: bundle.json and build-info.json exactly as scripts/t76-build-candidate.mjs
// writes them: canonical JSON with no final line feed.
const writeBuildOutput = async (directory, key) => {
  const bundle = bundleForTarget(targetOf(key), { releaseId: RELEASE_ID, semanticVersion: SEMANTIC_VERSION });
  const buildInfo = {
    schemaVersion: 1,
    deterministic: true,
    revision: REVISION,
    releaseId: RELEASE_ID,
    semanticVersion: SEMANTIC_VERSION,
    target: bundle.target,
    evidence: bundle.components
      .filter((component) => EVIDENCE_KINDS.has(component.kind))
      .map(({ kind, logicalPath, contentDigest, sizeBytes }) => ({ kind, logicalPath, contentDigest, sizeBytes }))
  };
  await mkdir(join(directory, "t76-target-output"), { recursive: true });
  await writeFile(join(directory, "t76-target-output", "bundle.json"), canonicalizeJsonV2(bundle));
  await writeFile(join(directory, "t76-target-output", "build-info.json"), canonicalizeJsonV2(buildInfo));
};

const sealTargetWithBoth = async (sides, key, gateBytes) => {
  for (const side of Object.values(sides)) {
    await writeBuildOutput(side, key);
    await writeFile(join(side, "gate-evaluations.json"), gateBytes);
  }
  return sealTargetBoth(sides, { ...IDENTITY, ...targetOf(key) });
};

// why: one artifact directory per target, as download-artifact lays them out,
// created in an order unlike the index's so neither writer can lean on it.
const layOutTargets = async (sides, evidenceByArtifact) => {
  for (const side of Object.values(sides)) {
    await mkdir(join(side, "targets"), { recursive: true });
    for (const [artifact, bytes] of [...evidenceByArtifact].reverse()) {
      await mkdir(join(side, "targets", artifact), { recursive: true });
      if (bytes !== undefined) await writeFile(join(side, "targets", artifact, "target-build-evidence.json"), bytes);
    }
  }
};

const sealedTarget = async (key) => {
  const gateBytes = await sealGatesWithBoth(await scratch(), key);
  const sides = await scratch();
  const { inline, module } = await sealTargetWithBoth(sides, key, gateBytes);
  assert.equal(inline.status, 0, inline.stderr);
  assert.equal(module.status, 0, module.stderr);
  const bytes = await readFile(join(sides.inline, "target-build-evidence.json"));
  assert.deepEqual(
    await readFile(join(sides.module, "target-build-evidence.json")),
    bytes,
    `${key}: the target evidence differs`
  );
  return [key, bytes];
};

const sealedClosure = async () => new Map(await Promise.all(SUPPORTED_TARGET_KEYS.map(sealedTarget)));

const artifactName = (key) => `t76-target-${key}-4242424242`;

let closure;
const closureEvidence = async () => {
  closure ??= await sealedClosure();
  return closure;
};

const assertBothRefuse = async (sides, result, file) => {
  assert.notEqual(result.inline.status, 0, "the inline program must refuse");
  assert.notEqual(result.module.status, 0, "the module must refuse");
  for (const side of Object.values(sides))
    await assert.rejects(() => readFile(join(side, file)), { code: "ENOENT" }, `${file} must not be written`);
};

test("the fixture is main's workflow byte for byte, and it carries the three inline writers", () => {
  assert.equal(inlineWorkflowDigest(), INLINE_WORKFLOW_SHA256);
});

test("gate evaluations: both writers seal the same bytes after every gate, on Windows and POSIX logs", async () => {
  // A failing gate is still sealed, as "fail", and the step goes on to the next.
  const [, , failed] = await Promise.all([
    sealGatesWithBoth(await scratch(), "win32-x64"),
    sealGatesWithBoth(await scratch(), "linux-x64"),
    sealGatesWithBoth(await scratch(), "win32-x64", { full: 1, release: 2 })
  ]);
  const records = JSON.parse(failed.toString("utf8"));
  assert.deepEqual(
    records.map(({ profile, result }) => [profile, result]),
    [
      ["quick", "pass"],
      ["full", "fail"],
      ["build", "pass"],
      ["security", "pass"],
      ["release", "fail"]
    ]
  );
});

test("target evidence and the five-target index: both writers seal the same bytes for every target", async () => {
  const evidence = await closureEvidence();
  const sides = await scratch();
  await layOutTargets(sides, [
    ...[...evidence].map(([key, bytes]) => [artifactName(key), bytes]),
    // why: a target that failed still uploads its logs, without target evidence.
    ["t76-target-logs-only-4242424242", undefined]
  ]);
  for (const side of Object.values(sides)) await writeFile(join(side, "targets", "stray-file"), "not a closure");
  const { inline, module } = await reconcileBoth(sides, REVISION);
  assert.equal(inline.status, 0, inline.stderr);
  assert.equal(module.status, 0, module.stderr);
  const inlineBytes = await readFile(join(sides.inline, "t76-target-index.json"));
  assert.deepEqual(await readFile(join(sides.module, "t76-target-index.json")), inlineBytes);
  const index = JSON.parse(inlineBytes.toString("utf8"));
  assert.deepEqual(
    index.targets.map((entry) => `${entry.target.platform}-${entry.target.arch}`),
    [...SUPPORTED_TARGET_KEYS]
  );
  assert.equal(index.targets.find((entry) => entry.target.platform === "win32").target.nodeVersion, NODE_VERSION);
});

test("both writers refuse the same closures and write no index", async () => {
  const evidence = await closureEvidence();
  const entries = [...evidence].map(([key, bytes]) => [artifactName(key), bytes]);
  const otherRevision = Buffer.from(
    evidence.get("linux-x64").toString("utf8").replace(REVISION, "c".repeat(40)),
    "utf8"
  );
  const otherTarget = Buffer.from(
    evidence.get("win32-x64").toString("utf8").replace('"arch":"x64"', '"arch":"arm64"'),
    "utf8"
  );
  const cases = [
    ["a missing target", entries.filter(([artifact]) => !artifact.includes("darwin-x64"))],
    ["a target bound to another revision", entries.map(([a, b]) => [a, a.includes("linux-x64-") ? otherRevision : b])],
    ["a target outside the fleet", entries.map(([a, b]) => [a, a.includes("win32-x64") ? otherTarget : b])],
    ["a target sealed twice", [...entries, ["t76-target-linux-x64-again", evidence.get("linux-x64")]]],
    ["evidence that is not JSON", entries.map(([a, b]) => [a, a.includes("darwin-arm64") ? Buffer.from("{") : b])]
  ];
  for (const [label, layout] of cases) {
    const sides = await scratch();
    await layOutTargets(sides, layout);
    await assertBothRefuse(sides, await reconcileBoth(sides, REVISION), "t76-target-index.json").catch((error) => {
      throw new Error(`${label}: ${error.message}`, { cause: error });
    });
  }
});

test("both writers refuse a gate that printed no assertion and a malformed seal file", async () => {
  for (const [label, seal, log] of [
    ["no assertion", "", "\u2139 suites 0\n\u2139 tests 0\n"],
    ["malformed seal file", "{", gateLog("quick", "linux-x64", "\n")]
  ]) {
    const sides = await scratch();
    for (const side of Object.values(sides)) {
      await writeFile(join(side, "gate-evaluations.json"), seal);
      await writeFile(join(side, "gate-quick.log"), log);
    }
    const { inline, module } = await sealGateBoth(sides, { profile: "quick", status: "0", log: "gate-quick.log" });
    assert.notEqual(inline.status, 0, `${label}: the inline program must refuse`);
    assert.notEqual(module.status, 0, `${label}: the module must refuse`);
    for (const side of Object.values(sides))
      assert.equal(await readFile(join(side, "gate-evaluations.json"), "utf8"), seal, `${label}: seal file changed`);
  }
});

test("both writers refuse to seal target evidence without a build output", async () => {
  const sides = await scratch();
  for (const side of Object.values(sides)) await writeFile(join(side, "gate-evaluations.json"), "[]\n");
  const result = await sealTargetBoth(sides, { ...IDENTITY, ...targetOf("win32-x64") });
  await assertBothRefuse(sides, result, "target-build-evidence.json");
});

// why: the replay is how a real dispatch is checked byte for byte, so it must
// pass on a run laid out as download-artifact leaves it and fail when one
// downloaded byte disagrees with what its inputs reproduce.
test("the replay reproduces a downloaded candidate run and detects a byte that its inputs do not reproduce", async () => {
  const { inline: run } = await scratch();
  const artifacts = join(run, "targets");
  for (const key of SUPPORTED_TARGET_KEYS) {
    const artifact = join(artifacts, artifactName(key));
    const { platform, arch } = targetOf(key);
    await writeBuildOutput(artifact, key);
    const evaluationsPath = join(artifact, "gate-evaluations.json");
    for (const profile of GATE_PROFILES) {
      const logPath = join(artifact, `gate-${profile}.log`);
      await writeFile(logPath, gateLog(profile, key, key.startsWith("win32") ? "\r\n" : "\n"));
      await sealGateEvaluation({ profile, status: 0, logPath, evaluationsPath });
    }
    await sealTargetEvidence({
      ...IDENTITY,
      ...{ platform, arch, nodeVersion: NODE_VERSION, targetOutput: join(artifact, "t76-target-output") },
      ...{ evaluationsPath, outputPath: join(artifact, "target-build-evidence.json") }
    });
  }
  await reconcileTargetIndex({
    revision: REVISION,
    targetsDirectory: artifacts,
    outputPath: join(run, "t76-target-index.json")
  });
  // why: `gh run download` also lands the index artifact under targets/.
  const indexArtifact = join(artifacts, `t76-target-index-${REVISION}-4242424242`);
  await mkdir(indexArtifact, { recursive: true });
  await writeFile(join(indexArtifact, "t76-target-index.json"), await readFile(join(run, "t76-target-index.json")));
  const lines = [];
  const replay = () => replayCandidateRun({ runDirectory: run, ...IDENTITY, log: (line) => lines.push(line) });
  assert.equal(await replay(), true, lines.join("\n"));
  assert.equal(lines.length, SUPPORTED_TARGET_KEYS.length * 2 + 1);
  assert.ok(lines.every((line) => line.startsWith("PASS ")));
  await writeFile(join(artifacts, artifactName("darwin-x64"), "gate-full.log"), gateLog("full", "linux-x64", "\n"));
  lines.length = 0;
  assert.equal(await replay(), false);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("FAIL ")),
    [`FAIL ${artifactName("darwin-x64")} gate-evaluations.json: inline false, module false`]
  );
});
