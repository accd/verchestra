import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);

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

test("launcher JSON stdout contains exactly one valid document", () => {
  const result = launch("vestra", ["--version", "--output", "json"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).command, "version");
});
