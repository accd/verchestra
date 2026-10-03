import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { GATE_PROFILES, SUPPORTED_TARGET_KEYS } from "../../scripts/t76-candidate-evidence.mjs";

const workflow = readFileSync(new URL("../../.github/workflows/t76-candidate-build.yml", import.meta.url), "utf8");

const FLEET = Object.freeze([
  ["Windows x64", "windows-latest", "win32", "x64"],
  ["macOS x64", "macos-15-intel", "darwin", "x64"],
  ["macOS arm64", "macos-14", "darwin", "arm64"],
  ["Linux glibc x64", "ubuntu-latest", "linux", "x64"],
  ["Linux glibc arm64", "ubuntu-24.04-arm", "linux", "arm64"]
]);

const lines = workflow.split(/\r?\n/u);

// why: no YAML dependency exists here. Jobs are two-space keys under `jobs:`,
// and their steps are six-space `- name:` items.
const jobLines = (job) => {
  const start = lines.indexOf(`  ${job}:`);
  assert.ok(start > 0, `${job} is a job`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/u.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
};

const stepNames = (job) =>
  jobLines(job)
    .filter((line) => line.startsWith("      - name: "))
    .map((line) => line.slice("      - name: ".length));

const stepBody = (job, name) => {
  const body = jobLines(job);
  const start = body.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, `${job} has the step ${name}`);
  const end = body.findIndex((line, index) => index > start && line.startsWith("      - name: "));
  return body.slice(start, end < 0 ? body.length : end).join("\n");
};

// invariant: the words of a folded `run: >-` command, one argument per line.
const runCommand = (step) => {
  const body = step.split("\n");
  const start = body.findIndex((line) => line === "        run: >-");
  assert.ok(start >= 0, "the step runs one folded command");
  return body
    .slice(start + 1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

test("T76 candidate workflow is manual, read-only, and fail-fast disabled", () => {
  assert.match(workflow, /^on:\r?\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^ {2}(push|pull_request):/mu);
  assert.match(workflow, /^permissions:\r?\n {2}contents: read/mu);
  assert.match(workflow, /fail-fast: false/u);
});

test("T76 candidate workflow binds exactly the supported five-target fleet", () => {
  for (const [label, os, platform, arch] of FLEET) {
    const block = new RegExp(
      [
        `- label: ${label}`,
        `\\s*\\n\\s*os: ${os}`,
        `\\s*\\n\\s*platform: ${platform}`,
        `\\s*\\n\\s*arch: ${arch}\\b`
      ].join(""),
      "u"
    );
    assert.match(workflow, block, `${label} must map to ${os} (${platform}/${arch})`);
  }
  assert.equal([...workflow.matchAll(/^\s*- label: /gmu)].length, FLEET.length);
});

test("each target checks the exact revision, qualified runtime, and runner identity", () => {
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.revision \}\}/u);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(workflow, /node --version.*v24\.14\.0/u);
  assert.match(workflow, /process\.platform !== process\.env\.MATRIX_PLATFORM/u);
  assert.match(workflow, /process\.arch !== process\.env\.MATRIX_ARCH/u);
});

test("the runtime is installed before its version is verified", () => {
  const setupNode = workflow.indexOf("- name: Set up Node");
  const verifyRuntime = workflow.indexOf("- name: Verify revision, target, and runtime");
  assert.notEqual(setupNode, -1);
  assert.notEqual(verifyRuntime, -1);
  assert.ok(setupNode < verifyRuntime, "runtime setup must precede the exact-version check");
});

// why: the counters are read and sealed by scripts/t76-candidate-evidence.mjs,
// whose rules tests/build/t76-candidate-evidence.test.mjs runs. What this file
// pins is that the workflow seals every gate it runs, with that gate's own exit
// status and log, before the failure accounting can end the step.
test("every closed gate is executed and its counters are sealed before building", () => {
  assert.match(workflow, /profiles=\(quick full build security release\)/u);
  assert.deepEqual(/profiles=\(([a-z ]+)\)/u.exec(workflow)[1].split(" "), [...GATE_PROFILES]);
  assert.match(
    workflow,
    /pnpm "gate:\$\{profile\}" 2>&1 \| tee "\$log"\n\s+status=\$\{PIPESTATUS\[0\]\}\n\s+set -e\n\s+node scripts\/t76-candidate-evidence\.mjs seal-gate \\\n\s+--profile "\$profile" \\\n\s+--status "\$status" \\\n\s+--log "\$log" \\\n\s+--evaluations gate-evaluations\.json\n\s+if \(\( status != 0 \)\); then failed=1; fi/u
  );
  assert.match(workflow, /if: steps\.gates\.outcome == 'success'/u);
  assert.match(workflow, /--evaluations gate-evaluations\.json/u);
});

test("target bytes and evidence are portable, content-addressed artifacts", () => {
  assert.match(workflow, /--out t76-target-output/u);
  // why: the record and its digests are written by the module; the step hands it
  // the job's inputs and the build output, and nothing else.
  const seal = stepBody("target", "Seal target build evidence");
  assert.match(seal, /^ {8}if: steps\.gates\.outcome == 'success'$/mu);
  assert.deepEqual(runCommand(seal), [
    "node scripts/t76-candidate-evidence.mjs seal-target",
    '--revision "$CANDIDATE_REVISION"',
    '--release-id "$RELEASE_ID"',
    '--semantic-version "$SEMANTIC_VERSION"',
    '--platform "$MATRIX_PLATFORM"',
    '--arch "$MATRIX_ARCH"',
    "--node-version 24.14.0",
    "--target-output t76-target-output",
    "--evaluations gate-evaluations.json",
    "--out target-build-evidence.json"
  ]);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/u);
  assert.match(workflow, /retention-days: 30/u);
});

test("collection requires exactly one successful closure for every target", () => {
  assert.match(workflow, /^  collect:/mu);
  assert.match(workflow, /needs: target\r?\n\s*if: always\(\)/u);
  // why: the fleet, the revision binding and the exactly-once rule live in the
  // module's reconciliation, which tests/build/t76-candidate-evidence.test.mjs
  // and the golden comparison with the former inline program run.
  assert.deepEqual(runCommand(stepBody("collect", "Reconcile the exact five-target closure")), [
    "node scripts/t76-candidate-evidence.mjs reconcile",
    '--revision "$CANDIDATE_REVISION"',
    "--targets targets",
    "--out t76-target-index.json"
  ]);
  assert.match(workflow, /t76-target-index-\$\{\{ inputs\.revision \}\}/u);
});

test("the matrix builds exactly the fleet the reconciliation admits", () => {
  const keys = [...workflow.matchAll(/^\s+platform: (\S+)\n\s+arch: (\S+)$/gmu)].map(
    ([, platform, arch]) => `${platform}-${arch}`
  );
  assert.deepEqual(
    keys.sort((left, right) => Number(left > right) - Number(left < right)),
    [...SUPPORTED_TARGET_KEYS]
  );
});

test("lifecycle scripts run only for the packages whose native binaries are required", () => {
  // The first dispatch failed on all five targets with "claude native binary
  // not installed": a blanket `--ignore-scripts` suppresses the postinstall that
  // fetches the driver binary, and the launcher bundle needs esbuild's platform
  // binary the same way. Rather than dropping the restriction wholesale as the
  // three older workflows do, the tree installs with scripts off and exactly
  // three exact-pinned packages are rebuilt by name.
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts\s+pnpm rebuild esbuild opencode-ai/u);
  // The rebuild list is proven, not trusted: each binary a gate executes is
  // exercised here so an incomplete list fails at install with a clear cause.
  assert.match(workflow, /require\('esbuild'\)\.buildSync/u);
  assert.match(workflow, /node_modules\/\.bin\/opencode --version/u);
  assert.match(
    workflow,
    /npm install --global --ignore-scripts --no-audit --no-fund @anthropic-ai\/claude-code@[\d.]+ @openai\/codex@[\d.]+\s+npm rebuild --global @anthropic-ai\/claude-code @openai\/codex/u
  );
  // No install may run the whole dependency tree's scripts.
  assert.doesNotMatch(workflow, /pnpm install --frozen-lockfile\n/u);
  assert.doesNotMatch(workflow, /npm install --global --no-audit/u);
  // The probes must still prove the binaries actually run.
  assert.match(workflow, /claude --version/u);
  assert.match(workflow, /codex --version/u);
});

test("every heredoc in the workflow terminates where the shell can find it", () => {
  // The first successful install exposed this: a heredoc opened with <<'NODE'
  // needs its terminator at column 0 of the emitted script, but the one nested
  // inside the gate loop sat one level deeper than its block, so bash read to
  // end-of-file and every target died with "syntax error: unexpected end of
  // file" before a single gate ran.
  const lines = workflow.split(/\r?\n/);
  const runBlockIndent = (index) => {
    for (let cursor = index; cursor >= 0; cursor -= 1)
      if (/^\s*run: [|>]/u.test(lines[cursor])) return lines[cursor].search(/\S/u) + 2;
    throw new Error(`no run block above line ${index + 1}`);
  };
  const openers = lines.map((line, index) => ({ line, index })).filter(({ line }) => /<<'[A-Z]+'/u.test(line));
  assert.ok(openers.length > 0);
  for (const { line, index } of openers) {
    const tag = /<<'([A-Z]+)'/u.exec(line)[1];
    const indent = runBlockIndent(index);
    let terminated = false;
    // Search only within this run block: a terminator belonging to a later
    // block must never be mistaken for this one's.
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (candidate.trim() !== "" && candidate.search(/\S/u) < indent) break;
      if (candidate.trimEnd() === `${" ".repeat(indent)}${tag}`) {
        terminated = true;
        break;
      }
    }
    assert.equal(terminated, true, `heredoc ${tag} at line ${index + 1} does not terminate at column 0 of its block`);
  }
});

test("the seal file is truncated before the first gate, and the module seals into it", () => {
  // why: the step truncates gate-evaluations.json before the loop, so the first
  // profile reads an existing but empty file. That is not ENOENT, and an
  // ENOENT-only reader once killed every target with "Unexpected end of JSON
  // input" before a single gate was recorded. The reader is now the module's:
  // tests/build/t76-candidate-evidence.test.mjs seals into an absent, an empty
  // and a blank file, and refuses malformed content without touching it.
  const truncate = workflow.indexOf(": > gate-evaluations.json");
  const loop = workflow.indexOf('for profile in "${profiles[@]}"; do');
  assert.ok(truncate > 0 && truncate < loop, "the seal file is truncated before the loop");
  assert.equal(workflow.split(": > gate-evaluations.json").length, 2);
});

// why: the evidence the candidate build seals was once written by programs
// embedded in this file, which no test ran (architecture review 2026-10-02,
// card 3). The workflow now only calls the tested module; no step may carry
// program text that serializes, hashes, or writes a record again.
test("no step embeds an evidence writer", () => {
  assert.doesNotMatch(workflow, /canonicalizeJsonV2|createHash|writeFile|JSON\.parse|packages\/domain/u);
  const openers = [...workflow.matchAll(/<<'([A-Z]+)'/gu)];
  assert.equal(openers.length, 1, "only the runner identity check runs inline");
  assert.match(stepBody("target", "Verify revision, target, and runtime"), /<<'NODE'/u);
  assert.equal([...workflow.matchAll(/node scripts\/t76-candidate-evidence\.mjs (\S+)/gu)].length, 3);
});

test("the steps of each job keep their order", () => {
  assert.deepEqual(stepNames("target"), [
    "Check out the exact candidate revision",
    "Set up pnpm",
    "Set up Node",
    "Verify revision, target, and runtime",
    "Install dependencies",
    "Install qualified local driver probes",
    "Run all five closed gates and seal their counters",
    "Build the exact target bytes",
    "Seal target build evidence",
    "Upload target evidence and bytes"
  ]);
  assert.deepEqual(stepNames("collect"), [
    "Check out the exact candidate revision",
    "Set up Node",
    "Download every target artifact",
    "Reconcile the exact five-target closure",
    "Upload the reconciled target index"
  ]);
});

test("the candidate build reads no secret, binds no environment, and asks for no write", () => {
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /^\s+environment:/mu);
  assert.doesNotMatch(workflow, /id-token/u);
  assert.doesNotMatch(workflow, /^\s+[a-z-]+: write$/mu);
  assert.equal([...workflow.matchAll(/^\s*permissions:/gmu)].length, 1, "one workflow-level grant, no job widens it");
});

test("every Node version the workflow states is the qualified runtime", () => {
  const stated = [
    ...[...workflow.matchAll(/node-version: (\S+)/gu)].map((match) => match[1]),
    ...[...workflow.matchAll(/--node-version (\S+)/gu)].map((match) => match[1]),
    ...[...workflow.matchAll(/node --version\)" == "v(\S+)"/gu)].map((match) => match[1])
  ];
  assert.equal(stated.length, 5, "two setups, the runtime check, the build, and the evidence seal");
  assert.deepEqual(new Set(stated), new Set(["24.14.0"]));
});
