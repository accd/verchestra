// why: a T76 candidate build (.github/workflows/t76-candidate-build.yml) seals
// three records: each closed gate's counters in `gate-evaluations.json`, each
// target's `target-build-evidence.json`, and the reconciled
// `t76-target-index.json`. They were written by programs embedded in the
// workflow that no test ran, while the publisher, the materializer and the
// publication fixture each restated their shapes. The records, their shapes,
// their digest rules and the fleet they cover are stated here once; the
// workflow runs this module, and every reader takes the shapes from it.
//
// invariant: for every input the embedded programs accepted, the writers here
// emit the same bytes or refuse. The published candidates were sealed with
// those bytes, and the publisher verifies digests over them.
// tests/build/t76-candidate-evidence-golden.test.mjs runs the embedded programs
// as main last carried them and this module on the same inputs, and compares.
//
// hazard: the workflow runs this module from a bare checkout of the dispatched
// commit, so it may import only Node built-ins and the domain canonical encoder.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";

// invariant: the exact fleet a candidate closure must cover, in code-unit order.
export const SUPPORTED_TARGET_KEYS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64"
]);

// invariant: the closed gates a candidate build runs, in the order it seals them.
// The order is part of the sealed bytes of `gate-evaluations.json`.
export const GATE_PROFILES = Object.freeze(["quick", "full", "build", "security", "release"]);

// invariant: where a candidate build leaves each record, relative to its job's
// working directory and, for the target output, to each downloaded artifact.
export const CANDIDATE_FILES = Object.freeze({
  gateEvaluations: "gate-evaluations.json",
  targetOutput: "t76-target-output",
  bundle: "bundle.json",
  buildInfo: "build-info.json",
  targetEvidence: "target-build-evidence.json",
  targetIndex: "t76-target-index.json"
});

// invariant: the members of every record a candidate build seals. A reader
// holds a record to exactly these members.
export const CANDIDATE_RECORD_KEYS = Object.freeze({
  gateEvaluation: Object.freeze(["profile", "result", "assertionCount", "skipped", "todo", "survivingMutants"]),
  target: Object.freeze(["platform", "arch", "nodeVersion"]),
  buildInfo: Object.freeze([
    "schemaVersion",
    "deterministic",
    "revision",
    "releaseId",
    "semanticVersion",
    "target",
    "evidence"
  ]),
  buildInfoEvidence: Object.freeze(["kind", "logicalPath", "contentDigest", "sizeBytes"]),
  targetEvidence: Object.freeze([
    "schemaVersion",
    "revision",
    "releaseId",
    "semanticVersion",
    "target",
    "releaseDigest",
    "componentCount",
    "gateEvidenceDigest",
    "buildInfoDigest"
  ]),
  targetIndex: Object.freeze(["schemaVersion", "revision", "targets", "digest"])
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EXIT_STATUS = /^(?:0|[1-9]\d{0,2})$/u;

// invariant: the node:test summary lines a gate log carries. A gate runs several
// suites and each prints its own summary, so a counter is the sum over the log.
const SUMMARY = Object.freeze({
  assertionCount: /\u2139 tests (\d+)/gu,
  skipped: /\u2139 skipped (\d+)/gu,
  todo: /\u2139 todo (\d+)/gu
});

export class T76EvidenceError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "T76EvidenceError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new T76EvidenceError(code, message, cause === undefined ? undefined : { cause });
};

const compareCodeUnits = (left, right) => Number(left > right) - Number(left < right);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

// invariant: every record file a candidate build seals is its canonical JSON
// followed by one line feed.
export const sealedJson = (value) => `${canonicalizeJsonV2(value)}\n`;

export const targetKeyOf = (target) => `${target.platform}-${target.arch}`;

// invariant: a gate's evidence digest covers the exact bytes of the sealed
// `gate-evaluations.json`, its final line feed included.
export const gateEvidenceDigest = (sealedBytes) => sha256(sealedBytes);

// invariant: a build-info digest covers the canonical form of the record, which
// is also the exact byte content the builder writes.
export const buildInfoDigest = (buildInfo) => sha256(canonicalizeJsonV2(buildInfo));

// invariant: an index digest covers the canonical form of its targets, in the
// index's own order.
export const targetIndexDigest = (targets) => sha256(canonicalizeJsonV2(targets));

const summed = (log, pattern) => [...log.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0);

// invariant: a gate whose log carries no assertion is refused, whatever its
// exit status, so a gate that never ran cannot be sealed as one that passed.
export function gateEvaluationRecord({ profile, status, log }) {
  if (!GATE_PROFILES.includes(profile)) fail("VES_T76_EVIDENCE_INPUT_INVALID", "profile is not a closed gate");
  if (!Number.isSafeInteger(status) || status < 0)
    fail("VES_T76_EVIDENCE_INPUT_INVALID", "status is not an exit status");
  if (typeof log !== "string") fail("VES_T76_EVIDENCE_INPUT_INVALID", "the gate log is not text");
  const assertionCount = summed(log, SUMMARY.assertionCount);
  if (assertionCount <= 0) fail("VES_T76_EVIDENCE_GATE_EMPTY", `${profile} produced no test assertions`);
  return {
    profile,
    result: status === 0 ? "pass" : "fail",
    assertionCount,
    skipped: summed(log, SUMMARY.skipped),
    todo: summed(log, SUMMARY.todo),
    // why: no gate log carries a mutant counter. The builder refuses a candidate
    // whose count is not 0, and the sealed bytes have always said 0.
    survivingMutants: 0
  };
}

// invariant: scripts/t76-build-candidate.mjs writes build-info.json from this
// record, and the target evidence binds it through buildInfoDigest.
export function buildInfoRecord({ revision, releaseId, semanticVersion, target, evidence }) {
  return {
    schemaVersion: 1,
    deterministic: true,
    revision,
    releaseId,
    semanticVersion,
    target,
    evidence: evidence.map(({ kind, logicalPath, contentDigest, sizeBytes }) => ({
      kind,
      logicalPath,
      contentDigest,
      sizeBytes
    }))
  };
}

export function targetBuildEvidenceRecord({
  revision,
  releaseId,
  semanticVersion,
  target,
  bundle,
  buildInfo,
  gateEvaluationBytes
}) {
  return {
    schemaVersion: 1,
    revision,
    releaseId,
    semanticVersion,
    target: { platform: target.platform, arch: target.arch, nodeVersion: target.nodeVersion },
    releaseDigest: bundle.releaseDigest,
    componentCount: bundle.components.length,
    gateEvidenceDigest: gateEvidenceDigest(gateEvaluationBytes),
    buildInfoDigest: buildInfoDigest(buildInfo)
  };
}

// invariant: the index orders its targets by target key, so its digest does not
// depend on the order in which the artifacts were read.
export function targetIndexRecord(revision, entries) {
  const targets = [...entries].sort((left, right) =>
    compareCodeUnits(targetKeyOf(left.target), targetKeyOf(right.target))
  );
  return { schemaVersion: 1, revision, targets, digest: targetIndexDigest(targets) };
}

const readText = async (path, label) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    return fail("VES_T76_EVIDENCE_INPUT_MISSING", `${label} cannot be read`, error);
  }
};

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail("VES_T76_EVIDENCE_INPUT_INVALID", `${label} is not JSON`, error);
  }
};

// why: the workflow truncates the seal file before its first gate, so an empty
// file and an absent one both mean that no gate has been sealed yet. Malformed
// content still fails closed.
const sealedGateEvaluations = async (path) => {
  const raw = await readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    return fail("VES_T76_EVIDENCE_INPUT_MISSING", "the sealed gate evaluations cannot be read", error);
  });
  if (raw.trim() === "") return [];
  const sealed = parseJson(raw, "the sealed gate evaluations");
  if (!Array.isArray(sealed) || !sealed.every((item) => hasExactKeys(item, CANDIDATE_RECORD_KEYS.gateEvaluation)))
    fail("VES_T76_EVIDENCE_INPUT_INVALID", "the sealed gate evaluations are not gate evaluation records");
  return sealed;
};

// invariant: each closed gate is sealed once, in the order the build ran it.
export async function sealGateEvaluation({ profile, status, logPath, evaluationsPath }) {
  const log = await readText(logPath, "the gate log");
  const sealed = await sealedGateEvaluations(evaluationsPath);
  if (sealed.some((item) => item.profile === profile))
    fail("VES_T76_EVIDENCE_INPUT_INVALID", `${profile} is already sealed`);
  const evaluations = [...sealed, gateEvaluationRecord({ profile, status, log })];
  await writeFile(evaluationsPath, sealedJson(evaluations), { mode: 0o600 });
  return evaluations;
}

const requiredText = (value, label) => {
  if (typeof value !== "string" || value.length === 0) fail("VES_T76_EVIDENCE_INPUT_INVALID", `${label} is required`);
  return value;
};

const sameCanonical = (left, right) => canonicalizeJsonV2(left) === canonicalizeJsonV2(right);

const assertBuildInfo = (buildInfo, expected) => {
  if (
    !hasExactKeys(buildInfo, CANDIDATE_RECORD_KEYS.buildInfo) ||
    !hasExactKeys(buildInfo.target, CANDIDATE_RECORD_KEYS.target)
  )
    fail("VES_T76_EVIDENCE_INPUT_INVALID", "build-info.json is not a build-info record");
  if (
    buildInfo.revision !== expected.revision ||
    buildInfo.releaseId !== expected.releaseId ||
    buildInfo.semanticVersion !== expected.semanticVersion
  )
    fail("VES_T76_EVIDENCE_IDENTITY_MISMATCH", "build-info.json does not record the requested release");
  if (!sameCanonical(buildInfo.target, expected.target))
    fail("VES_T76_EVIDENCE_TARGET_MISMATCH", "build-info.json does not record the requested target");
};

const assertBundle = (bundle, expected) => {
  if (!isRecord(bundle) || typeof bundle.releaseDigest !== "string" || !DIGEST.test(bundle.releaseDigest))
    fail("VES_T76_EVIDENCE_INPUT_INVALID", "bundle.json carries no release digest");
  if (!Array.isArray(bundle.components) || bundle.components.length === 0)
    fail("VES_T76_EVIDENCE_INPUT_INVALID", "bundle.json carries no components");
  if (bundle.releaseId !== expected.releaseId || bundle.semanticVersion !== expected.semanticVersion)
    fail("VES_T76_EVIDENCE_IDENTITY_MISMATCH", "bundle.json does not seal the requested release");
  if (!hasExactKeys(bundle.target, CANDIDATE_RECORD_KEYS.target) || !sameCanonical(bundle.target, expected.target))
    fail("VES_T76_EVIDENCE_TARGET_MISMATCH", "bundle.json does not seal the requested target");
};

// why: the target and the release identity are the job's inputs. Sealed without
// reading the build output, a stale input (a Node version typed into the
// workflow, say) would seal a target the bundle does not carry. The output must
// record exactly the same target and release, or nothing is written.
export async function sealTargetEvidence(options) {
  const target = {
    platform: requiredText(options.platform, "platform"),
    arch: requiredText(options.arch, "arch"),
    nodeVersion: requiredText(options.nodeVersion, "nodeVersion")
  };
  const expected = {
    revision: requiredText(options.revision, "revision"),
    releaseId: requiredText(options.releaseId, "releaseId"),
    semanticVersion: requiredText(options.semanticVersion, "semanticVersion"),
    target
  };
  const bundlePath = join(options.targetOutput, CANDIDATE_FILES.bundle);
  const buildInfoPath = join(options.targetOutput, CANDIDATE_FILES.buildInfo);
  const bundle = parseJson(await readText(bundlePath, "bundle.json"), "bundle.json");
  const buildInfo = parseJson(await readText(buildInfoPath, "build-info.json"), "build-info.json");
  let gateEvaluationBytes;
  try {
    gateEvaluationBytes = await readFile(options.evaluationsPath);
  } catch (error) {
    fail("VES_T76_EVIDENCE_INPUT_MISSING", "the sealed gate evaluations cannot be read", error);
  }
  assertBundle(bundle, expected);
  assertBuildInfo(buildInfo, expected);
  const evidence = targetBuildEvidenceRecord({ ...expected, bundle, buildInfo, gateEvaluationBytes });
  await writeFile(options.outputPath, sealedJson(evidence), { mode: 0o600 });
  return evidence;
}

// why: a target job that failed still uploads its logs, so an artifact without
// target evidence is not a closure and is passed over. Any other read failure,
// or content that is not JSON, fails closed.
const targetEvidenceIfPresent = async (path) => {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    return fail("VES_T76_EVIDENCE_INPUT_MISSING", "target evidence cannot be read", error);
  }
  return parseJson(text, "target evidence");
};

const admitTargetEvidence = (value, revision, artifact) => {
  if (
    !hasExactKeys(value, CANDIDATE_RECORD_KEYS.targetEvidence) ||
    !hasExactKeys(value.target, CANDIDATE_RECORD_KEYS.target) ||
    !SUPPORTED_TARGET_KEYS.includes(targetKeyOf(value.target)) ||
    value.revision !== revision
  )
    fail("VES_T76_EVIDENCE_TARGET_UNEXPECTED", `unexpected target evidence ${artifact}`);
  return value;
};

const assertFleetCovered = (entries) => {
  const keys = entries.map((entry) => targetKeyOf(entry.target));
  if (
    keys.length !== SUPPORTED_TARGET_KEYS.length ||
    new Set(keys).size !== SUPPORTED_TARGET_KEYS.length ||
    !SUPPORTED_TARGET_KEYS.every((key) => keys.includes(key))
  )
    fail(
      "VES_T76_EVIDENCE_CLOSURE_INCOMPLETE",
      "the candidate does not have exactly one successful closure for every supported target"
    );
};

// invariant: each downloaded artifact is one directory, and its closure is the
// target evidence it carries. The index admits exactly one closure per target
// of the fleet, each bound to the requested revision.
export async function reconcileTargetIndex({ revision, targetsDirectory, outputPath }) {
  let artifacts;
  try {
    artifacts = await readdir(targetsDirectory, { withFileTypes: true });
  } catch (error) {
    return fail("VES_T76_EVIDENCE_INPUT_MISSING", "the target artifacts cannot be read", error);
  }
  const entries = [];
  for (const artifact of artifacts) {
    if (!artifact.isDirectory()) continue;
    const value = await targetEvidenceIfPresent(join(targetsDirectory, artifact.name, CANDIDATE_FILES.targetEvidence));
    if (value !== undefined) entries.push(admitTargetEvidence(value, revision, artifact.name));
  }
  assertFleetCovered(entries);
  const index = targetIndexRecord(revision, entries);
  await writeFile(outputPath, sealedJson(index), { mode: 0o600 });
  return index;
}

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

// why: bash hands the gate's exit status over as text. Only a decimal exit
// status is one; anything else is refused rather than read as a pass.
const exitStatus = (text) => {
  if (!EXIT_STATUS.test(text)) fail("VES_T76_EVIDENCE_INPUT_INVALID", "status is not an exit status");
  return Number(text);
};

const COMMANDS = Object.freeze({
  "seal-gate": async (args) => {
    const profile = argument(args, "--profile");
    const sealed = await sealGateEvaluation({
      profile,
      status: exitStatus(argument(args, "--status")),
      logPath: resolve(argument(args, "--log")),
      evaluationsPath: resolve(argument(args, "--evaluations"))
    });
    const record = sealed.at(-1);
    console.log(`T76 gate ${profile} sealed: ${record.result}, ${record.assertionCount} assertions`);
  },
  "seal-target": async (args) => {
    const evidence = await sealTargetEvidence({
      revision: argument(args, "--revision"),
      releaseId: argument(args, "--release-id"),
      semanticVersion: argument(args, "--semantic-version"),
      platform: argument(args, "--platform"),
      arch: argument(args, "--arch"),
      nodeVersion: argument(args, "--node-version"),
      targetOutput: resolve(argument(args, "--target-output")),
      evaluationsPath: resolve(argument(args, "--evaluations")),
      outputPath: resolve(argument(args, "--out"))
    });
    console.log(`T76 target evidence sealed for ${targetKeyOf(evidence.target)}: ${evidence.releaseDigest}`);
  },
  reconcile: async (args) => {
    const index = await reconcileTargetIndex({
      revision: argument(args, "--revision"),
      targetsDirectory: resolve(argument(args, "--targets")),
      outputPath: resolve(argument(args, "--out"))
    });
    console.log(`T76 target index sealed for ${index.revision}: ${index.digest}`);
  }
});

const runCli = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(COMMANDS, command)) throw new Error(`unknown command ${String(command)}`);
  await COMMANDS[command](args);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
