import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/t76-candidate-build.yml", import.meta.url), "utf8");

const FLEET = Object.freeze([
  ["Windows x64", "windows-latest", "win32", "x64"],
  ["macOS x64", "macos-15-intel", "darwin", "x64"],
  ["macOS arm64", "macos-14", "darwin", "arm64"],
  ["Linux glibc x64", "ubuntu-latest", "linux", "x64"],
  ["Linux glibc arm64", "ubuntu-24.04-arm", "linux", "arm64"]
]);

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

test("every closed gate is executed and its counters are sealed before building", () => {
  assert.match(workflow, /profiles=\(quick full build security release\)/u);
  assert.match(workflow, /pnpm "gate:\$\{profile\}"/u);
  assert.match(workflow, /assertionCount = sum\(\/\\u2139 tests/u);
  assert.match(workflow, /skipped = sum\(\/\\u2139 skipped/u);
  assert.match(workflow, /todo = sum\(\/\\u2139 todo/u);
  assert.match(workflow, /survivingMutants: 0/u);
  assert.match(workflow, /if: steps\.gates\.outcome == 'success'/u);
  assert.match(workflow, /--evaluations gate-evaluations\.json/u);
});

test("target bytes and evidence are portable, content-addressed artifacts", () => {
  assert.match(workflow, /--out t76-target-output/u);
  assert.match(workflow, /releaseDigest: bundle\.releaseDigest/u);
  assert.match(workflow, /gateEvidenceDigest/u);
  assert.match(workflow, /canonicalizeJsonV2\(evidence\)/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/u);
  assert.match(workflow, /retention-days: 30/u);
});

test("collection requires exactly one successful closure for every target", () => {
  assert.match(workflow, /^  collect:/mu);
  assert.match(workflow, /needs: target\r?\n\s*if: always\(\)/u);
  assert.match(
    workflow,
    /expected = new Set\(\["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"\]\)/u
  );
  assert.match(workflow, /entries\.length !== expected\.size/u);
  assert.match(workflow, /value\.revision !== process\.env\.CANDIDATE_REVISION/u);
  assert.match(workflow, /t76-target-index-\$\{\{ inputs\.revision \}\}/u);
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

test("the gate evaluation reader treats an empty seal file as no evaluations", () => {
  // The step truncates gate-evaluations.json before the loop, so the first
  // profile reads an existing but empty file. That is not ENOENT, so the
  // original ENOENT-only catch rethrew and every target died with
  // "Unexpected end of JSON input" before recording a single gate.
  assert.match(workflow, /readFile\("gate-evaluations\.json", "utf8"\)\.catch\(/u);
  assert.match(workflow, /raw\.trim\(\) === "" \? \[\] : JSON\.parse\(raw\)/u);
  // Malformed content must still fail closed rather than be swallowed.
  assert.doesNotMatch(workflow, /JSON\.parse\(raw\)\s*\)?\s*\.catch/u);
});
