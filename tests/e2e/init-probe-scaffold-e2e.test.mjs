import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { buildProbeScaffoldFiles } from "../../packages/workspace/src/index.ts";
import {
  byteSnapshot,
  cleanupScannerRoots,
  initRepository,
  scannerRoot
} from "../helpers/workspace-scanner-fixture.mjs";

const VESTRA = fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url));
const INIT = [
  "init",
  "--workspace-id",
  "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
  "--name",
  "Probe workspace",
  "--placement",
  "centralized"
];

afterEach(cleanupScannerRoots);

function launch(args, cwd) {
  return spawnSync(process.execPath, [VESTRA, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 60_000
  });
}

async function workspace() {
  const root = await scannerRoot("verchestra-probe-scaffold-e2e-");
  await initRepository(root);
  return root;
}

test("init --dry-run with a probe engine previews the scaffold and leaves the repository byte-identical", async () => {
  const root = await workspace();
  const before = await byteSnapshot(root);
  const result = launch([...INIT, "--dry-run", "--probe-engine", "sqlite", "--output", "json"], root);
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.deepEqual(
    output.data.changes
      .filter((change) => change.logicalPath.startsWith(".verchestra/probes/"))
      .map((change) => [change.logicalPath, change.action]),
    [
      [".verchestra/probes/sqlite/README.md", "create"],
      [".verchestra/probes/sqlite/conformance-kit.mts", "create"],
      [".verchestra/probes/sqlite/conformance.test.mts", "create"],
      [".verchestra/probes/sqlite/connection.mts", "create"],
      [".verchestra/probes/sqlite/contract.mts", "create"]
    ]
  );
  assert.deepEqual(await byteSnapshot(root), before);
});

test(
  "init applies the scaffold once, repeats as a no-op, adds no dependency, and its kit fails honestly",
  { timeout: 120_000 },
  async () => {
    const root = await workspace();
    const directory = ".verchestra/probes/orders-db";
    const args = [...INIT, "--probe-engine", "mongodb", "--probe-language", "typescript", "--probe-dir", directory];
    const first = launch([...args, "--output", "json"], root);
    assert.equal(first.stderr, "");
    assert.equal(first.status, 0);
    assert.equal(JSON.parse(first.stdout).data.receipt.changed, 12);
    const expected = buildProbeScaffoldFiles({ engine: "mongodb", language: "typescript", directory });
    for (const [path, content] of Object.entries(expected))
      assert.equal(await readFile(join(root, ...path.split("/")), "utf8"), content);
    assert.equal(await readFile(join(root, "package.json"), "utf8"), '{"name":"fixture","private":true}\n');

    const snapshot = await byteSnapshot(root);
    const second = launch([...args, "--output", "json"], root);
    assert.equal(second.status, 0);
    assert.equal(JSON.parse(second.stdout).data.receipt.changed, 0);
    assert.deepEqual(await byteSnapshot(root), snapshot);

    // why: an inherited NODE_TEST_CONTEXT turns the child into a subtest
    // reporter of this runner, which always exits 0; the team's CI has none.
    const { NODE_TEST_CONTEXT, ...environment } = process.env;
    void NODE_TEST_CONTEXT;
    const kit = spawnSync(process.execPath, ["--test", "conformance.test.mts"], {
      cwd: join(root, ...directory.split("/")),
      encoding: "utf8",
      env: { ...environment, NO_COLOR: "1" },
      timeout: 60_000
    });
    assert.equal(kit.status, 1);
    assert.match(kit.stdout, /fail 1/u);
    assert.ok(kit.stdout.includes("VES_PROBE_DRIVER_TODO"), kit.stdout);
  }
);

for (const [label, extra, argument] of [
  ["an unsupported engine", ["--probe-engine", "db2"], "--probe-engine"],
  ["an unsupported language", ["--probe-engine", "oracle", "--probe-language", "python"], "--probe-language"],
  ["a directory outside the probe root", ["--probe-engine", "oracle", "--probe-dir", "src/probes"], "--probe-dir"],
  ["a traversing directory", ["--probe-engine", "oracle", "--probe-dir", ".verchestra/probes/../x"], "--probe-dir"],
  ["a probe directory without an engine", ["--probe-dir", ".verchestra/probes/oracle"], "--probe-dir"],
  ["a probe language without an engine", ["--probe-language", "typescript"], "--probe-language"]
]) {
  test(`init refuses ${label} as an argument error and writes nothing`, async () => {
    const root = await workspace();
    const before = await byteSnapshot(root);
    const result = launch([...INIT, ...extra, "--output", "json"], root);
    assert.equal(result.status, 2);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, "VES_CLI_ARGUMENT_INVALID");
    assert.equal(output.error.safeDetails.argument, argument);
    assert.deepEqual(await byteSnapshot(root), before);
  });
}
