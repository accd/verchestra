// invariant: no workflow installs packages with every lifecycle script enabled.
// Each install runs with `--ignore-scripts`; the few exact-pinned packages whose
// postinstall places a native binary are rebuilt by name right after, so the
// scripts that run are the reviewed ones, not whatever a dependency ships.
// why: SonarCloud S6505. t76-candidate-build.yml set the pattern; ci.yml,
// full-validation.yml and platform-matrix.yml installed the provider CLIs with
// scripts on until the sonarcloud-quality T4 change.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const directory = new URL("../../.github/workflows/", import.meta.url);
const workflows = readdirSync(directory)
  .filter((name) => /\.ya?ml$/u.test(name))
  .map((name) => ({ name, text: readFileSync(new URL(name, directory), "utf8") }));

// Every package-manager install line. `pnpm install --frozen-lockfile` is the
// one exemption: pnpm 10 runs no dependency build script unless the workspace
// allows it by name, which is the same by-name restriction enforced here.
const INSTALL = /^[ \t]*(?:run:[ \t]+)?((?:npm (?:install|i|ci)|pnpm (?:install|add))\b[^\n]*)$/gmu;

function unrestrictedInstalls(text) {
  return [...text.matchAll(INSTALL)]
    .map((match) => match[1].trim())
    .filter((line) => !line.includes("--ignore-scripts"))
    .filter((line) => line !== "pnpm install --frozen-lockfile");
}

test("the install detector sees both step forms and only the exempt pnpm line passes", () => {
  assert.deepEqual(unrestrictedInstalls("        run: npm install left-pad\n"), ["npm install left-pad"]);
  assert.deepEqual(unrestrictedInstalls("          npm i -g tool@1\n"), ["npm i -g tool@1"]);
  assert.deepEqual(unrestrictedInstalls("        run: pnpm add esbuild\n"), ["pnpm add esbuild"]);
  assert.deepEqual(unrestrictedInstalls("        run: pnpm install --frozen-lockfile\n"), []);
  assert.deepEqual(unrestrictedInstalls("          npm install --global --ignore-scripts x\n"), []);
  assert.deepEqual(unrestrictedInstalls("# see npm install docs\n"), []);
});

test("every workflow install disables lifecycle scripts", () => {
  const unrestricted = workflows.flatMap(({ name, text }) =>
    unrestrictedInstalls(text).map((line) => `${name}: ${line}`)
  );
  assert.deepEqual(unrestricted, []);
});

test("every global provider install rebuilds exactly its pinned packages by name", () => {
  const installers = workflows.filter(({ text }) => /npm install --global/u.test(text));
  assert.deepEqual(installers.map(({ name }) => name).sort(), [
    "ci.yml",
    "full-validation.yml",
    "platform-matrix.yml",
    "t76-candidate-build.yml"
  ]);
  for (const { name, text } of installers)
    assert.match(
      text,
      /npm install --global --ignore-scripts --no-audit --no-fund @anthropic-ai\/claude-code@[\d.]+ @openai\/codex@[\d.]+\s+npm rebuild --global @anthropic-ai\/claude-code @openai\/codex\n/u,
      name
    );
});
