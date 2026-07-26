#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ROOT } from "./agent-readiness.mjs";

const RUNTIME = join(ROOT, ".verchestra", ".runtime", "agent-eval");
const CORPUS = join(ROOT, "tests", "agent-eval", "corpus.json");

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function validateProfile(profile, path) {
  for (const field of ["name", "provider", "toolVersion", "modelVersion", "command"]) {
    if (typeof profile[field] !== "string" || profile[field].length === 0) throw new Error(`${path}: invalid ${field}`);
  }
  if (profile.schemaVersion !== 1 || !Array.isArray(profile.args)) throw new Error(`${path}: invalid profile schema`);
  if (Object.hasOwn(profile, "env")) throw new Error(`${path}: environment values are prohibited`);
  return profile;
}

async function profilesFromArguments() {
  const config = option("--config");
  const matrix = option("--matrix");
  if ((config === null) === (matrix === null)) throw new Error("provide exactly one of --config or --matrix");
  if (config) return [resolve(ROOT, config)];
  const directory = resolve(ROOT, matrix);
  if (!existsSync(directory)) return [];
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((entry) => join(directory, entry));
}

async function evaluate(profilePath, corpus) {
  const profile = validateProfile(JSON.parse(await readFile(profilePath, "utf8")), profilePath);
  const workspace = await mkdtemp(join(RUNTIME, `${profile.name}-`));
  const resultFile = join(RUNTIME, `${basename(workspace)}-results.json`);
  const add = run("git", ["-C", ROOT, "worktree", "add", "--detach", workspace, "HEAD"]);
  if (add.status !== 0) throw new Error(`worktree creation failed: ${add.stderr.trim()}`);
  try {
    const replacements = {
      "{corpusFile}": CORPUS,
      "{resultFile}": resultFile,
      "{workspace}": workspace
    };
    const args = profile.args.map((argument) => replacements[argument] ?? argument);
    const command = profile.command === "node" ? process.execPath : profile.command;
    const result = run(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0)
      throw new Error(`${profile.name}: adapter failed (${result.status}): ${result.stderr.trim()}`);
    const output = JSON.parse(await readFile(resultFile, "utf8"));
    if (output.schemaVersion !== 1 || !Array.isArray(output.results))
      throw new Error(`${profile.name}: invalid result schema`);
    assertResults(profile.name, corpus, output.results);
    const status = run("git", ["-C", workspace, "status", "--porcelain"]);
    if (status.status !== 0 || status.stdout.trim() !== "")
      throw new Error(`${profile.name}: adapter left an unexpected worktree patch`);
    return {
      name: profile.name,
      provider: profile.provider,
      toolVersion: profile.toolVersion,
      modelVersion: profile.modelVersion,
      status: "pass",
      cases: corpus.cases.length
    };
  } finally {
    run("git", ["-C", ROOT, "worktree", "remove", "--force", workspace]);
    await rm(resultFile, { force: true });
  }
}

function assertResults(name, corpus, results) {
  if (results.length !== corpus.cases.length) throw new Error(`${name}: result count mismatch`);
  for (const [index, testCase] of corpus.cases.entries()) {
    const actual = results[index];
    if (actual?.id !== testCase.id) throw new Error(`${name}: case order/id mismatch at ${testCase.id}`);
    if (JSON.stringify(actual.result) !== JSON.stringify(testCase.expected))
      throw new Error(`${name}: deterministic assertion failed for ${testCase.id}`);
    for (const patch of actual.result.patches ?? []) {
      if (isAbsolute(patch.path) || patch.path.includes("..") || patch.path.includes("\\"))
        throw new Error(`${name}: unsafe proposed patch path for ${testCase.id}`);
    }
  }
}

await mkdir(RUNTIME, { recursive: true });
const corpus = JSON.parse(await readFile(CORPUS, "utf8"));
if (corpus.schemaVersion !== 1 || corpus.repository !== "accd/verchestra" || !Array.isArray(corpus.cases))
  throw new Error("invalid evaluation corpus");
const profilePaths = await profilesFromArguments();
const results = [];
for (const profilePath of profilePaths) results.push(await evaluate(profilePath, corpus));
if (profilePaths.length === 0) {
  for (const provider of ["claude-code", "codex", "opencode-qwen"])
    results.push({ provider, status: "not configured" });
}
const payload = { schemaVersion: 1, corpusCases: corpus.cases.length, results };
const summary = {
  ...payload,
  digest: `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`
};
await writeFile(join(RUNTIME, "agent-eval-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
