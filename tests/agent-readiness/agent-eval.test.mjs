import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("evaluation corpus covers six unique provider-neutral cases", async () => {
  const corpus = JSON.parse(await readFile(new URL("../agent-eval/corpus.json", import.meta.url), "utf8"));
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.cases.length, 6);
  assert.equal(new Set(corpus.cases.map(({ id }) => id)).size, 6);
  assert.deepEqual(
    corpus.cases.map(({ id }) => id),
    [
      "clean-clone-onboarding",
      "domain-package-routing",
      "canonical-website-documentation",
      "generated-contract-routing",
      "portable-handoff-resume",
      "malicious-instruction-refusal"
    ]
  );
});

test("generic runner qualifies the fake adapter in a disposable worktree", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/agent-eval.mjs", "--config", "tests/agent-eval/profiles/fake.json"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.results[0].status, "pass");
  assert.equal(summary.results[0].cases, 6);
  assert.match(summary.digest, /^sha256:[0-9a-f]{64}$/u);
});

test("generic runner fails closed when an adapter returns a wrong result", async () => {
  const profile = JSON.parse(await readFile(new URL("../agent-eval/profiles/fake.json", import.meta.url), "utf8"));
  profile.args.push("--invalid");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "verchestra-eval-profile-"));
  const path = join(directory, "invalid.json");
  await writeFile(path, JSON.stringify(profile));
  const result = spawnSync(process.execPath, ["scripts/agent-eval.mjs", "--config", path], {
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deterministic assertion failed/u);
});

test("missing real-agent matrix reports providers as not configured", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/agent-eval.mjs", "--matrix", ".verchestra/.local/agent-eval-missing"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(
    summary.results.map(({ provider, status }) => [provider, status]),
    [
      ["claude-code", "not configured"],
      ["codex", "not configured"],
      ["opencode-qwen", "not configured"]
    ]
  );
});
