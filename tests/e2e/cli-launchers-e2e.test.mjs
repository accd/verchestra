import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const canonicalVersion = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;

function launch(name, args) {
  return spawnSync(process.execPath, [`apps/vestra-cli/bin/${name}.mjs`, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  });
}

for (const args of [["--version"], ["--help"], ["--version", "--output", "json"], ["sync"], ["unknown"]]) {
  test(`vestra and verchestra launchers are equivalent for ${args.join(" ")}`, () => {
    const canonical = launch("vestra", args);
    const alias = launch("verchestra", args);
    assert.equal(alias.status, canonical.status);
    assert.equal(alias.stdout, canonical.stdout);
    assert.equal(alias.stderr, canonical.stderr);
  });
}

const exactReleaseOutputs = Object.freeze([
  [["--version"], `Verchestra ${canonicalVersion} (source build, no verified release artifact)\n`],
  [
    ["--help"],
    `Verchestra ${canonicalVersion}\nCanonical CLI: vestra\n\nUsage: vestra <command> [options]\n\nCommands:\n  init  Initialize a Workspace\n`
  ],
  [
    ["--version", "--output", "json"],
    `${JSON.stringify({
      schemaVersion: "1",
      command: "version",
      ok: true,
      data: { product: "Verchestra", semanticVersion: canonicalVersion, releaseDigest: null }
    })}\n`
  ]
]);

for (const name of ["vestra", "verchestra"]) {
  for (const [args, expectedStdout] of exactReleaseOutputs) {
    test(`${name} emits the exact canonical release output for ${args.join(" ")}`, () => {
      const result = launch(name, args);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expectedStdout);
    });
  }
}

test("launcher JSON stdout contains exactly one valid document", () => {
  const result = launch("vestra", ["--version", "--output", "json"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).command, "version");
});

for (const name of ["vestra", "verchestra"]) {
  test(`${name} reports the canonical repository version and no invented release`, () => {
    const human = launch(name, ["--version"]).stdout;
    const help = launch(name, ["--help"]).stdout;
    const json = JSON.parse(launch(name, ["--version", "--output", "json"]).stdout).data;

    assert.equal(json.semanticVersion, canonicalVersion);
    assert.ok(human.includes(canonicalVersion), `--version must name ${canonicalVersion}, got ${human}`);
    assert.ok(help.includes(canonicalVersion), `--help must name ${canonicalVersion}, got ${help.split("\n")[0]}`);

    // No verified release artifact exists before the T77 release decision, so
    // the executable must say so rather than print a digest it cannot back.
    assert.equal(json.releaseDigest, null);
    assert.match(human, /source build, no verified release artifact/u);
    for (const output of [human, help]) {
      assert.doesNotMatch(output, /\bVerchestra 1\.0\.0\b/u, "the CLI must not claim a 1.0 release");
      assert.doesNotMatch(output, /sha256:[a-f0-9]{64}/u, "the CLI must not print an unbacked release digest");
    }
  });
}
