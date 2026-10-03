// The candidate evidence module at its interface: the records a T76 candidate
// build seals, their shapes and digest rules, the three sealing steps the
// workflow runs, and the readers that take their shapes from it.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import * as evidenceModule from "../../scripts/t76-candidate-evidence.mjs";
import * as custody from "../../scripts/t76-signing-custody.mjs";
import * as publisher from "../../scripts/t76-publish-release.mjs";
import { runEvidenceModule } from "../helpers/t76-inline-evidence-writers.mjs";
import { bundleForTarget, candidateClosure, disposePublicationFixtures } from "../helpers/t76-publication-fixture.mjs";

const {
  CANDIDATE_FILES,
  CANDIDATE_RECORD_KEYS,
  GATE_PROFILES,
  SUPPORTED_TARGET_KEYS,
  buildInfoDigest,
  buildInfoRecord,
  gateEvaluationRecord,
  gateEvidenceDigest,
  reconcileTargetIndex,
  sealGateEvaluation,
  sealTargetEvidence,
  sealedJson,
  targetBuildEvidenceRecord,
  targetIndexDigest,
  targetIndexRecord
} = evidenceModule;

const REVISION = "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334";
const RELEASE_ID = "release:verchestra:0.0.0-qualification.6:a1b2c3d4e5f6";
const SEMANTIC_VERSION = "0.0.0-qualification.6";
const byCodeUnits = (left, right) => Number(left > right) - Number(left < right);
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const roots = [];
after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
  await disposePublicationFixtures();
});

const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t76-evidence-"));
  roots.push(root);
  return root;
};

const summary = (tests, skipped = 0, todo = 0) =>
  `\u2139 tests ${tests}\n\u2139 pass ${tests}\n\u2139 skipped ${skipped}\n\u2139 todo ${todo}\n`;

const targetOf = (key) => {
  const [platform, arch] = key.split("-");
  return { platform, arch, nodeVersion: "24.14.0" };
};

// why: the build output as scripts/t76-build-candidate.mjs leaves it, for one
// target, with the gate evaluations a passing build sealed beside it.
const builtTarget = async (key, overrides = {}) => {
  const root = await scratch();
  const bundle = bundleForTarget(targetOf(key), { releaseId: RELEASE_ID, semanticVersion: SEMANTIC_VERSION });
  const buildInfo = {
    ...buildInfoRecord({
      revision: REVISION,
      releaseId: RELEASE_ID,
      semanticVersion: SEMANTIC_VERSION,
      target: bundle.target,
      evidence: bundle.components.filter((component) => component.kind === "evaluation")
    }),
    ...overrides.buildInfo
  };
  await mkdir(join(root, CANDIDATE_FILES.targetOutput), { recursive: true });
  await writeFile(join(root, CANDIDATE_FILES.targetOutput, "bundle.json"), canonicalizeJsonV2(bundle));
  await writeFile(join(root, CANDIDATE_FILES.targetOutput, "build-info.json"), canonicalizeJsonV2(buildInfo));
  const evaluationsPath = join(root, CANDIDATE_FILES.gateEvaluations);
  await writeFile(
    evaluationsPath,
    sealedJson(GATE_PROFILES.map((profile) => gateEvaluationRecord({ profile, status: 0, log: summary(3) })))
  );
  return {
    root,
    bundle,
    buildInfo,
    evaluationsPath,
    options: {
      revision: REVISION,
      releaseId: RELEASE_ID,
      semanticVersion: SEMANTIC_VERSION,
      ...targetOf(key),
      targetOutput: join(root, CANDIDATE_FILES.targetOutput),
      evaluationsPath,
      outputPath: join(root, CANDIDATE_FILES.targetEvidence),
      ...overrides.options
    }
  };
};

test("the module's interface is exactly its records, shapes, digest rules, fleet, and sealing steps", () => {
  assert.deepEqual(Object.keys(evidenceModule).sort(byCodeUnits), [
    "CANDIDATE_FILES",
    "CANDIDATE_RECORD_KEYS",
    "GATE_PROFILES",
    "SUPPORTED_TARGET_KEYS",
    "T76EvidenceError",
    "buildInfoDigest",
    "buildInfoRecord",
    "gateEvaluationRecord",
    "gateEvidenceDigest",
    "reconcileTargetIndex",
    "sealGateEvaluation",
    "sealTargetEvidence",
    "sealedJson",
    "targetBuildEvidenceRecord",
    "targetIndexDigest",
    "targetIndexRecord",
    "targetKeyOf"
  ]);
});

test("the fleet is stated once: the signing scripts hold the module's own binding", () => {
  assert.deepEqual([...SUPPORTED_TARGET_KEYS], ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);
  assert.deepEqual([...SUPPORTED_TARGET_KEYS].sort(byCodeUnits), [...SUPPORTED_TARGET_KEYS]);
  assert.equal(custody.SUPPORTED_TARGET_KEYS, SUPPORTED_TARGET_KEYS);
  assert.equal(publisher.SUPPORTED_TARGET_KEYS, SUPPORTED_TARGET_KEYS);
  assert.deepEqual([...GATE_PROFILES], ["quick", "full", "build", "security", "release"]);
});

test("the module imports only Node built-ins and the domain encoder, so a bare tooling checkout can run it", async () => {
  const source = await readFile(new URL("../../scripts/t76-candidate-evidence.mjs", import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/\bfrom "([^"]+)";$/gmu)].map((match) => match[1]);
  assert.deepEqual(specifiers.sort(byCodeUnits), [
    "../packages/domain/src/index.ts",
    "node:crypto",
    "node:fs/promises",
    "node:path",
    "node:url"
  ]);
  assert.doesNotMatch(source, /\bimport\(/u);
});

test("a gate record sums every suite summary its log carries, on LF and CRLF logs", () => {
  const log = `noise\r\n${summary(12, 1, 2).replaceAll("\n", "\r\n")}info tests 99\n${summary(30)}`;
  assert.deepEqual(gateEvaluationRecord({ profile: "full", status: 0, log }), {
    profile: "full",
    result: "pass",
    assertionCount: 42,
    skipped: 1,
    todo: 2,
    survivingMutants: 0
  });
  assert.equal(gateEvaluationRecord({ profile: "quick", status: 1, log }).result, "fail");
  assert.equal(gateEvaluationRecord({ profile: "quick", status: 137, log }).result, "fail");
  assert.deepEqual(
    Object.keys(gateEvaluationRecord({ profile: "release", status: 0, log })).sort(byCodeUnits),
    [...CANDIDATE_RECORD_KEYS.gateEvaluation].sort(byCodeUnits)
  );
});

test("a gate record refuses a gate with no assertion whatever its status, an unknown gate, and a non-status", () => {
  for (const status of [0, 1])
    assert.throws(() => gateEvaluationRecord({ profile: "quick", status, log: "\u2139 tests 0\n" }), {
      code: "VES_T76_EVIDENCE_GATE_EMPTY"
    });
  for (const input of [
    { profile: "mutation", status: 0, log: summary(1) },
    { profile: "quick", status: -1, log: summary(1) },
    { profile: "quick", status: 0.5, log: summary(1) },
    { profile: "quick", status: "0", log: summary(1) },
    { profile: "quick", status: 0, log: Buffer.from(summary(1)) }
  ])
    assert.throws(() => gateEvaluationRecord(input), { code: "VES_T76_EVIDENCE_INPUT_INVALID" });
});

test("sealing gates appends in run order to an absent or truncated seal file, as canonical JSON and a line feed", async () => {
  for (const initial of [undefined, "", "  \n"]) {
    const root = await scratch();
    const evaluationsPath = join(root, CANDIDATE_FILES.gateEvaluations);
    if (initial !== undefined) await writeFile(evaluationsPath, initial);
    const logPath = join(root, "gate.log");
    for (const [index, profile] of GATE_PROFILES.entries()) {
      await writeFile(logPath, summary(index + 1));
      await sealGateEvaluation({ profile, status: index === 1 ? 1 : 0, logPath, evaluationsPath });
    }
    const bytes = await readFile(evaluationsPath, "utf8");
    const records = JSON.parse(bytes);
    assert.equal(bytes, sealedJson(records));
    assert.deepEqual(
      records.map((record) => [record.profile, record.result, record.assertionCount]),
      GATE_PROFILES.map((profile, index) => [profile, index === 1 ? "fail" : "pass", index + 1])
    );
  }
});

test("sealing a gate refuses a second seal of one gate and a seal file that is not gate records, and keeps it", async () => {
  const root = await scratch();
  const logPath = join(root, "gate.log");
  await writeFile(logPath, summary(5));
  const evaluationsPath = join(root, CANDIDATE_FILES.gateEvaluations);
  await sealGateEvaluation({ profile: "quick", status: 0, logPath, evaluationsPath });
  const sealed = await readFile(evaluationsPath, "utf8");
  await assert.rejects(() => sealGateEvaluation({ profile: "quick", status: 0, logPath, evaluationsPath }), {
    code: "VES_T76_EVIDENCE_INPUT_INVALID"
  });
  assert.equal(await readFile(evaluationsPath, "utf8"), sealed);
  for (const content of ["{", "{}\n", '[{"profile":"quick"}]\n', `[${sealed.trim().slice(1, -1)},1]\n`]) {
    await writeFile(evaluationsPath, content);
    await assert.rejects(() => sealGateEvaluation({ profile: "full", status: 0, logPath, evaluationsPath }), {
      code: "VES_T76_EVIDENCE_INPUT_INVALID"
    });
    assert.equal(await readFile(evaluationsPath, "utf8"), content);
  }
  await assert.rejects(
    () => sealGateEvaluation({ profile: "full", status: 0, logPath: join(root, "absent.log"), evaluationsPath }),
    { code: "VES_T76_EVIDENCE_INPUT_MISSING" }
  );
});

test("the command line seals a decimal exit status only, and refuses an unknown command", async () => {
  const root = await scratch();
  await writeFile(join(root, "gate.log"), summary(4));
  const seal = (status) =>
    runEvidenceModule(
      ["seal-gate", "--profile", "quick", "--status", status, "--log", "gate.log", "--evaluations", "seal.json"],
      { cwd: root }
    );
  for (const status of ["", "abc", "-1", "00", "1.0", "0x0", "1e0", " 0"]) {
    const refused = await seal(status);
    assert.notEqual(refused.status, 0, `status ${JSON.stringify(status)} must be refused`);
    await assert.rejects(() => readFile(join(root, "seal.json")), { code: "ENOENT" });
  }
  const sealed = await seal("255");
  assert.equal(sealed.status, 0, sealed.stderr);
  assert.match(sealed.stdout, /^T76 gate quick sealed: fail, 4 assertions$/mu);
  const unknown = await runEvidenceModule(["seal-everything"], { cwd: root });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown command seal-everything/u);
});

test("the build-info record carries exactly its members and projects each evidence entry", () => {
  const info = buildInfoRecord({
    revision: REVISION,
    releaseId: RELEASE_ID,
    semanticVersion: SEMANTIC_VERSION,
    target: targetOf("win32-x64"),
    evidence: [
      { kind: "sbom", logicalPath: "evidence/sbom.cdx.json", contentDigest: sha("s"), sizeBytes: 1, extra: true }
    ]
  });
  assert.deepEqual(Object.keys(info).sort(byCodeUnits), [...CANDIDATE_RECORD_KEYS.buildInfo].sort(byCodeUnits));
  assert.deepEqual(Object.keys(info.evidence[0]), [...CANDIDATE_RECORD_KEYS.buildInfoEvidence]);
  assert.equal(info.schemaVersion, 1);
  assert.equal(info.deterministic, true);
  assert.equal(buildInfoDigest(info), sha(canonicalizeJsonV2(info)));
});

test("the target evidence binds the gate seal's exact bytes, the canonical build info, and the bundle", async () => {
  const built = await builtTarget("win32-x64");
  const gateBytes = await readFile(built.evaluationsPath);
  const record = targetBuildEvidenceRecord({
    revision: REVISION,
    releaseId: RELEASE_ID,
    semanticVersion: SEMANTIC_VERSION,
    target: { ...targetOf("win32-x64"), extra: "dropped" },
    bundle: built.bundle,
    buildInfo: built.buildInfo,
    gateEvaluationBytes: gateBytes
  });
  assert.deepEqual(Object.keys(record).sort(byCodeUnits), [...CANDIDATE_RECORD_KEYS.targetEvidence].sort(byCodeUnits));
  assert.deepEqual(record.target, targetOf("win32-x64"));
  assert.equal(record.gateEvidenceDigest, sha(gateBytes));
  assert.equal(gateEvidenceDigest(gateBytes), sha(gateBytes));
  assert.notEqual(record.gateEvidenceDigest, sha(gateBytes.subarray(0, -1)), "the final line feed is covered");
  assert.equal(record.buildInfoDigest, sha(canonicalizeJsonV2(built.buildInfo)));
  assert.equal(record.releaseDigest, built.bundle.releaseDigest);
  assert.equal(record.componentCount, built.bundle.components.length);
});

test("sealing target evidence writes the record over the build output, as canonical JSON and a line feed", async () => {
  for (const key of ["win32-x64", "darwin-arm64"]) {
    const built = await builtTarget(key);
    const evidence = await sealTargetEvidence(built.options);
    assert.equal(await readFile(built.options.outputPath, "utf8"), sealedJson(evidence));
    assert.equal(evidence.buildInfoDigest, sha(await readFile(join(built.options.targetOutput, "build-info.json"))));
    assert.equal(evidence.gateEvidenceDigest, sha(await readFile(built.evaluationsPath)));
    assert.deepEqual(evidence.target, targetOf(key));
  }
});

test("sealing target evidence refuses an input the build output does not record, and writes nothing", async () => {
  const cases = [
    ["a stale Node version", { options: { nodeVersion: "24.15.0" } }, "VES_T76_EVIDENCE_TARGET_MISMATCH"],
    ["another platform", { options: { platform: "linux" } }, "VES_T76_EVIDENCE_TARGET_MISMATCH"],
    ["another architecture", { options: { arch: "arm64" } }, "VES_T76_EVIDENCE_TARGET_MISMATCH"],
    ["another revision", { options: { revision: "c".repeat(40) } }, "VES_T76_EVIDENCE_IDENTITY_MISMATCH"],
    ["another release", { options: { releaseId: "release:other" } }, "VES_T76_EVIDENCE_IDENTITY_MISMATCH"],
    [
      "another version",
      { options: { semanticVersion: "0.0.0-qualification.7" } },
      "VES_T76_EVIDENCE_IDENTITY_MISMATCH"
    ],
    [
      "a build info for another target",
      { buildInfo: { target: targetOf("linux-x64") } },
      "VES_T76_EVIDENCE_TARGET_MISMATCH"
    ],
    ["a build info with another field", { buildInfo: { extra: 1 } }, "VES_T76_EVIDENCE_INPUT_INVALID"],
    ["a missing input", { options: { releaseId: undefined } }, "VES_T76_EVIDENCE_INPUT_INVALID"]
  ];
  for (const [label, overrides, code] of cases) {
    const built = await builtTarget("win32-x64", overrides);
    await assert.rejects(() => sealTargetEvidence(built.options), { code }, label);
    await assert.rejects(() => readFile(built.options.outputPath), { code: "ENOENT" }, `${label} wrote evidence`);
  }
  const built = await builtTarget("win32-x64");
  await writeFile(join(built.options.targetOutput, "bundle.json"), "{}");
  await assert.rejects(() => sealTargetEvidence(built.options), { code: "VES_T76_EVIDENCE_INPUT_INVALID" });
  await rm(join(built.options.targetOutput, "bundle.json"));
  await assert.rejects(() => sealTargetEvidence(built.options), { code: "VES_T76_EVIDENCE_INPUT_MISSING" });
});

const sealedEvidenceFor = async (key) => sealTargetEvidence((await builtTarget(key)).options);

test("the index orders its targets by key whatever the order given, and its digest covers them in that order", async () => {
  const entries = await Promise.all([...SUPPORTED_TARGET_KEYS].reverse().map(sealedEvidenceFor));
  const index = targetIndexRecord(REVISION, entries);
  assert.deepEqual(Object.keys(index).sort(byCodeUnits), [...CANDIDATE_RECORD_KEYS.targetIndex].sort(byCodeUnits));
  assert.deepEqual(
    index.targets.map((entry) => `${entry.target.platform}-${entry.target.arch}`),
    [...SUPPORTED_TARGET_KEYS]
  );
  assert.equal(index.digest, sha(canonicalizeJsonV2(index.targets)));
  assert.equal(targetIndexDigest(index.targets), index.digest);
  assert.notEqual(targetIndexDigest(entries), index.digest, "the digest depends on the order");
});

const layOut = async (entries) => {
  const root = await scratch();
  const targetsDirectory = join(root, "targets");
  for (const [artifact, evidence] of entries) {
    await mkdir(join(targetsDirectory, artifact), { recursive: true });
    if (evidence !== undefined)
      await writeFile(
        join(targetsDirectory, artifact, CANDIDATE_FILES.targetEvidence),
        typeof evidence === "string" ? evidence : sealedJson(evidence)
      );
  }
  return { targetsDirectory, outputPath: join(root, CANDIDATE_FILES.targetIndex) };
};

test("reconciling admits exactly one closure per fleet target and passes over artifacts that carry none", async () => {
  const entries = await Promise.all(SUPPORTED_TARGET_KEYS.map(sealedEvidenceFor));
  const paths = await layOut([
    ...entries.map((entry) => [`t76-target-${entry.target.platform}-${entry.target.arch}-1`, entry]).reverse(),
    ["t76-target-logs-only-1", undefined]
  ]);
  await writeFile(join(paths.targetsDirectory, "stray-file"), "not a closure");
  const index = await reconcileTargetIndex({ revision: REVISION, ...paths });
  assert.equal(await readFile(paths.outputPath, "utf8"), sealedJson(index));
  assert.deepEqual(index, targetIndexRecord(REVISION, entries));
});

test("reconciling refuses a closure that is incomplete, foreign, duplicated, or malformed, and writes no index", async () => {
  const entries = await Promise.all(SUPPORTED_TARGET_KEYS.map(sealedEvidenceFor));
  const artifacts = entries.map((entry) => [`t76-target-${entry.target.platform}-${entry.target.arch}-1`, entry]);
  const replace = (key, value) =>
    artifacts.map(([artifact, entry]) => [artifact, artifact.includes(`-${key}-`) ? value : entry]);
  const linux = entries.find((entry) => entry.target.platform === "linux" && entry.target.arch === "x64");
  const cases = [
    ["a missing target", artifacts.slice(1), "VES_T76_EVIDENCE_CLOSURE_INCOMPLETE"],
    ["a duplicated target", [...artifacts, ["t76-target-again-1", linux]], "VES_T76_EVIDENCE_CLOSURE_INCOMPLETE"],
    [
      "another revision",
      replace("linux-x64", { ...linux, revision: "c".repeat(40) }),
      "VES_T76_EVIDENCE_TARGET_UNEXPECTED"
    ],
    [
      "a target outside the fleet",
      replace("linux-x64", { ...linux, target: { ...linux.target, platform: "freebsd" } }),
      "VES_T76_EVIDENCE_TARGET_UNEXPECTED"
    ],
    ["a field too many", replace("linux-x64", { ...linux, extra: 1 }), "VES_T76_EVIDENCE_TARGET_UNEXPECTED"],
    [
      "a field too few",
      replace("linux-x64", Object.fromEntries(Object.entries(linux).filter(([key]) => key !== "componentCount"))),
      "VES_T76_EVIDENCE_TARGET_UNEXPECTED"
    ],
    ["evidence that is not JSON", replace("linux-x64", "{"), "VES_T76_EVIDENCE_INPUT_INVALID"]
  ];
  for (const [label, layout, code] of cases) {
    const paths = await layOut(layout);
    await assert.rejects(() => reconcileTargetIndex({ revision: REVISION, ...paths }), { code }, label);
    await assert.rejects(() => readFile(paths.outputPath), { code: "ENOENT" }, `${label} wrote an index`);
  }
  const empty = await scratch();
  await assert.rejects(
    () =>
      reconcileTargetIndex({
        revision: REVISION,
        targetsDirectory: join(empty, "absent"),
        outputPath: join(empty, "index.json")
      }),
    { code: "VES_T76_EVIDENCE_INPUT_MISSING" }
  );
});

test("the publisher reads the closure the module reconciles: the index it seals is the one the publisher is given", async () => {
  const closure = await candidateClosure();
  const outputPath = join(closure.root, "reconciled-index.json");
  const index = await reconcileTargetIndex({
    revision: closure.revision,
    targetsDirectory: closure.targetsDirectory,
    outputPath
  });
  assert.deepEqual(await readFile(outputPath), await readFile(closure.indexPath));
  assert.equal(index.digest, closure.indexDigest);
});
