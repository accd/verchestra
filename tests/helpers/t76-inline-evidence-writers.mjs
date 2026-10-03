// why: ADR2-2 holds scripts/t76-candidate-evidence.mjs to the bytes of the three
// programs the candidate workflow embedded before it called the module. This
// helper runs those programs as main last carried them. The fixture is a
// verbatim copy of .github/workflows/t76-candidate-build.yml at 23f29e1, pinned
// by its sha256, and each program is its step's heredoc body as bash handed it
// to node. Their bodies were last changed in 51e6390 (2026-08-25), before the
// published 0.0.0-qualification.3, .4 and .5 candidates were built.
//
// invariant: the only edit to a program is its one import of the domain
// encoder, which named the candidate checkout relative to the job's working
// directory; it names the same file of this repository instead.
//
// The same helper replays a downloaded candidate run, so a real dispatch can be
// checked byte for byte:
//
//   node tests/helpers/t76-inline-evidence-writers.mjs replay --run <directory>
//     --revision <sha> --release-id <id> --semantic-version <version>
//
// <directory> holds `targets/`, every artifact of the run in its own
// subdirectory (`gh run download <run> --dir <directory>/targets`), and the
// reconciled `t76-target-index.json` copied out of the index artifact.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FIXTURE = new URL("../fixtures/t76-inline-evidence-writers/t76-candidate-build-23f29e1.yml.txt", import.meta.url);
const MODULE = fileURLToPath(new URL("../../scripts/t76-candidate-evidence.mjs", import.meta.url));
const DOMAIN_INDEX = new URL("../../packages/domain/src/index.ts", import.meta.url);
const DOMAIN_IMPORT = '"./packages/domain/src/index.ts"';

// invariant: `git show 23f29e1:.github/workflows/t76-candidate-build.yml | shasum -a 256`.
export const INLINE_WORKFLOW_SHA256 = "8a58f96f5c9f596eed033cab15536ae482c91e560f605bbfd02b2c293ccf854c";

export const INLINE_STEPS = Object.freeze({
  gateEvaluation: "Run all five closed gates and seal their counters",
  targetEvidence: "Seal target build evidence",
  targetIndex: "Reconcile the exact five-target closure"
});

// why: the programs read their inputs from these names, and a run of this
// suite inside the candidate build inherits CANDIDATE_REVISION from the job.
const INLINE_ENVIRONMENT = Object.freeze([
  "PROFILE",
  "STATUS",
  "LOG_FILE",
  "CANDIDATE_REVISION",
  "RELEASE_ID",
  "SEMANTIC_VERSION",
  "MATRIX_PLATFORM",
  "MATRIX_ARCH"
]);

export const inlineWorkflowBytes = () => readFileSync(FIXTURE);

export const inlineWorkflowDigest = () => createHash("sha256").update(inlineWorkflowBytes()).digest("hex");

const indentOf = (line) => line.search(/\S/u);

// invariant: the body of a step's heredoc, with the run block's indentation
// removed as YAML removes it, and nothing else changed.
const heredocBody = (lines, stepName) => {
  const step = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  const nextStep = lines.findIndex((line, index) => index > step && line.trim().startsWith("- name: "));
  const end = nextStep < 0 ? lines.length : nextStep;
  const run = lines.findIndex((line, index) => index > step && index < end && /^\s*run: \|$/u.test(line));
  const opener = lines.findIndex((line, index) => index > run && index < end && line.includes("<<'NODE'"));
  if (step < 0 || run < 0 || opener < 0) throw new Error(`no inline program in step ${stepName}`);
  const indent = indentOf(lines[run]) + 2;
  const terminator = lines.findIndex((line, index) => index > opener && line === `${" ".repeat(indent)}NODE`);
  if (terminator < 0 || terminator > end) throw new Error(`the inline program of ${stepName} does not terminate`);
  return `${lines
    .slice(opener + 1, terminator)
    .map((line) => line.slice(indent))
    .join("\n")}\n`;
};

export function inlineProgram(stepName) {
  const text = inlineWorkflowBytes().toString("utf8");
  const body = heredocBody(text.split("\n"), stepName);
  if (body.split(DOMAIN_IMPORT).length !== 2) throw new Error(`${stepName} does not import the domain encoder once`);
  return body.replace(DOMAIN_IMPORT, JSON.stringify(pathToFileURL(fileURLToPath(DOMAIN_INDEX)).href));
}

const run = (args, { cwd, env, input }) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input ?? "");
  });

const childEnvironment = (values) => {
  const environment = { ...process.env };
  for (const name of INLINE_ENVIRONMENT) delete environment[name];
  return { ...environment, ...values };
};

export const runInlineWriter = (stepName, { cwd, env }) =>
  run(["--input-type=module"], { cwd, env: childEnvironment(env), input: inlineProgram(stepName) });

export const runEvidenceModule = (args, { cwd }) => run([MODULE, ...args], { cwd, env: childEnvironment({}) });

const both = async (inline, module) => {
  const [inlineResult, moduleResult] = await Promise.all([inline, module]);
  return { inline: inlineResult, module: moduleResult };
};

// invariant: each of the three runs the inline program in `sides.inline` and the
// module's command line in `sides.module`, on the same inputs, under the file
// names the workflow uses.
export const sealGateBoth = (sides, { profile, status, log }) =>
  both(
    runInlineWriter(INLINE_STEPS.gateEvaluation, {
      cwd: sides.inline,
      env: { PROFILE: profile, STATUS: status, LOG_FILE: log }
    }),
    runEvidenceModule(
      ["seal-gate", "--profile", profile, "--status", status, "--log", log, "--evaluations", "gate-evaluations.json"],
      { cwd: sides.module }
    )
  );

export const sealTargetBoth = (sides, { revision, releaseId, semanticVersion, platform, arch, nodeVersion }) =>
  both(
    runInlineWriter(INLINE_STEPS.targetEvidence, {
      cwd: sides.inline,
      env: {
        CANDIDATE_REVISION: revision,
        RELEASE_ID: releaseId,
        SEMANTIC_VERSION: semanticVersion,
        MATRIX_PLATFORM: platform,
        MATRIX_ARCH: arch
      }
    }),
    runEvidenceModule(
      [
        ...["seal-target", "--revision", revision, "--release-id", releaseId],
        ...["--semantic-version", semanticVersion, "--platform", platform, "--arch", arch],
        ...["--node-version", nodeVersion, "--target-output", "t76-target-output"],
        ...["--evaluations", "gate-evaluations.json", "--out", "target-build-evidence.json"]
      ],
      { cwd: sides.module }
    )
  );

export const reconcileBoth = (sides, revision) =>
  both(
    runInlineWriter(INLINE_STEPS.targetIndex, { cwd: sides.inline, env: { CANDIDATE_REVISION: revision } }),
    runEvidenceModule(["reconcile", "--revision", revision, "--targets", "targets", "--out", "t76-target-index.json"], {
      cwd: sides.module
    })
  );

const sidesOf = (scratch) => ({ inline: join(scratch, "inline"), module: join(scratch, "module") });

const PROFILES = Object.freeze(["quick", "full", "build", "security", "release"]);

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const sameBytes = async (left, right) => {
  const [a, b] = await Promise.all([readFile(left), readFile(right)]);
  return a.equals(b);
};

const sealGatesBothWays = async (artifact, scratch) => {
  const sides = sidesOf(scratch);
  for (const side of Object.values(sides)) {
    await mkdir(side, { recursive: true });
    await writeFile(join(side, "gate-evaluations.json"), "");
  }
  for (const profile of PROFILES) {
    const { inline, module } = await sealGateBoth(sides, {
      profile,
      status: "0",
      log: join(artifact, `gate-${profile}.log`)
    });
    if (inline.status !== 0 || module.status !== 0) throw new Error(`${profile} could not be sealed`);
  }
};

const sealTargetBothWays = async (artifact, scratch, identity) => {
  const sides = sidesOf(scratch);
  const sealed = JSON.parse(await readFile(join(artifact, "target-build-evidence.json"), "utf8"));
  for (const side of Object.values(sides)) {
    await mkdir(join(side, "t76-target-output"), { recursive: true });
    for (const file of ["bundle.json", "build-info.json"])
      await copyFile(join(artifact, "t76-target-output", file), join(side, "t76-target-output", file));
    await copyFile(join(artifact, "gate-evaluations.json"), join(side, "gate-evaluations.json"));
  }
  const { inline, module } = await sealTargetBoth(sides, { ...identity, ...sealed.target });
  if (inline.status !== 0 || module.status !== 0) throw new Error(`${sealed.target.platform} could not be sealed`);
};

const compared = async (label, sealedPath, scratch, file, log) => {
  const inline = await sameBytes(sealedPath, join(scratch, "inline", file));
  const module = await sameBytes(sealedPath, join(scratch, "module", file));
  log(`${inline && module ? "PASS" : "FAIL"} ${label}: inline ${inline}, module ${module}`);
  return inline && module;
};

const replayArtifact = async (artifact, scratch, identity, log) => {
  await sealGatesBothWays(artifact.path, join(scratch, "gates"));
  const gates = await compared(
    `${artifact.name} gate-evaluations.json`,
    join(artifact.path, "gate-evaluations.json"),
    join(scratch, "gates"),
    "gate-evaluations.json",
    log
  );
  await sealTargetBothWays(artifact.path, join(scratch, "target"), identity);
  const evidence = await compared(
    `${artifact.name} target-build-evidence.json`,
    join(artifact.path, "target-build-evidence.json"),
    join(scratch, "target"),
    "target-build-evidence.json",
    log
  );
  return gates && evidence;
};

const replayIndex = async (runDirectory, artifacts, scratch, revision, log) => {
  for (const side of ["inline", "module"]) {
    for (const artifact of artifacts) {
      await mkdir(join(scratch, side, "targets", artifact.name), { recursive: true });
      await copyFile(
        join(artifact.path, "target-build-evidence.json"),
        join(scratch, side, "targets", artifact.name, "target-build-evidence.json")
      );
    }
  }
  const { inline, module } = await reconcileBoth(sidesOf(scratch), revision);
  if (inline.status !== 0 || module.status !== 0) throw new Error("the index could not be reconciled");
  return compared(
    "t76-target-index.json",
    join(runDirectory, "t76-target-index.json"),
    scratch,
    "t76-target-index.json",
    log
  );
};

// invariant: true only when, for every target artifact and for the index, the
// embedded programs and the module both reproduce the downloaded bytes from the
// downloaded inputs.
export async function replayCandidateRun({ runDirectory, revision, releaseId, semanticVersion, log = console.log }) {
  const scratch = await mkdtemp(join(tmpdir(), "verchestra-t76-replay-"));
  const identity = { revision, releaseId, semanticVersion };
  try {
    const targets = join(runDirectory, "targets");
    // why: as the reconciliation does, an artifact without target evidence is
    // not a closure; the index artifact, downloaded with the run, is one.
    const artifacts = (await readdir(targets, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(targets, entry.name) }))
      .filter((artifact) => existsSync(join(artifact.path, "target-build-evidence.json")));
    const results = await Promise.all(
      artifacts.map((artifact) => replayArtifact(artifact, join(scratch, "targets", artifact.name), identity, log))
    );
    results.push(await replayIndex(runDirectory, artifacts, join(scratch, "index"), revision, log));
    return results.every(Boolean);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const runCli = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "replay")
    throw new Error("usage: replay --run <directory> --revision <sha> --release-id <id> --semantic-version <version>");
  const passed = await replayCandidateRun({
    runDirectory: resolve(argument(args, "--run")),
    revision: argument(args, "--revision"),
    releaseId: argument(args, "--release-id"),
    semanticVersion: argument(args, "--semantic-version")
  });
  if (!passed) process.exitCode = 1;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
