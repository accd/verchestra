// invariant: production source starts git and taskkill by an absolute path
// only. A bare name is resolved by the operating system, and a relative PATH
// entry such as `.` makes that resolution reach into the repository a command
// inspects, so a binary planted there would run in place of the real tool.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BARE_START = /\(\s*["'`](git|taskkill)(?:\.exe)?["'`]\s*[,)]/gu;

function bareStarts(text) {
  return [...text.matchAll(BARE_START)].map((match) => match[1]);
}

async function typescriptSources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await typescriptSources(path)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

async function productionSources() {
  const files = [];
  for (const parent of ["packages", "apps"]) {
    for (const entry of await readdir(join(ROOT, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = join(ROOT, parent, entry.name, "src");
      const present = await readdir(source).then(
        () => true,
        () => false
      );
      if (present) files.push(...(await typescriptSources(source)));
    }
  }
  return files;
}

test("no child process starts git or taskkill by bare name", async () => {
  for (const sample of [
    'execFile("git", ["status"])',
    "spawnSync('git', ['--version'])",
    'execute("taskkill", args)',
    "execFileAsync(`git`, args)",
    'execFileSync("git.exe")'
  ])
    assert.equal(bareStarts(sample).length, 1, `the detector misses ${sample}`);
  assert.deepEqual(bareStarts('join(root, "git")'), []);
  const files = await productionSources();
  assert.ok(files.length > 200, `only ${files.length} production sources were read`);
  const offenders = [];
  for (const file of files) {
    for (const name of bareStarts(await readFile(file, "utf8")))
      offenders.push(`${relative(ROOT, file).replaceAll("\\", "/")}: ${name}`);
  }
  assert.deepEqual(offenders, []);
});

// why: SonarCloud S4036 flagged these repository scripts for starting git by
// bare name; they now resolve it through scripts/git-executable.mjs. The other
// scripts that still do (agent-eval.mjs, t76-build-candidate.mjs) are a recorded
// follow-up in .specs/features/sonarcloud-quality, not an exemption.
test("the gate-selection and agent-readiness scripts start git by absolute path", async () => {
  for (const script of ["scripts/agent-readiness.mjs", "scripts/select-gates.mjs"])
    assert.deepEqual(bareStarts(await readFile(join(ROOT, script), "utf8")), [], script);
});
