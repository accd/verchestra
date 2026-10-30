// invariant: S2 of .specs/features/sqlite-probe-worker/checks.md (doors 3 and
// 4). The worker bundle a source checkout builds with `corepack pnpm
// build:probe-worker` (scripts/build-probe-worker.mjs) is one self-contained
// file: the bundler's own record of every import it makes, static, dynamic and
// `require`, names only `node:` modules, so it runs as the isolated copy the
// probe host spawns. Two builds on one revision write the same bytes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROBE_WORKER_COMPONENT, PROBE_WORKER_OUTPUT, bundleProbeWorker } from "../../scripts/build-probe-worker.mjs";
import { SEALED_CHILD_ENTRIES, sealedRuntimeImports } from "../../scripts/t76-build-candidate.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILD_SCRIPT = fileURLToPath(new URL("../../scripts/build-probe-worker.mjs", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../../apps/vestra-cli/dist/sqlite-probe-worker.mjs", import.meta.url));

function build() {
  return execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, encoding: "utf8", windowsHide: true });
}

test("the worker bundle imports only node modules", async () => {
  assert.equal(PROBE_WORKER_OUTPUT, "apps/vestra-cli/dist/sqlite-probe-worker.mjs");
  assert.equal(SEALED_CHILD_ENTRIES[PROBE_WORKER_COMPONENT], "apps/vestra-cli/closure/sqlite-probe-worker-entry.ts");
  build();
  const { bytes, metafile } = await bundleProbeWorker();
  assert.ok(bytes.equals(await readFile(BUNDLE)), "the record describes the bundle the build wrote");
  const imports = sealedRuntimeImports(metafile, PROBE_WORKER_COMPONENT);
  assert.ok(imports.length > 0, "the record names the worker's imports");
  assert.deepEqual(
    imports.filter((entry) => !entry.path.startsWith("node:")),
    [],
    "the worker bundle imports nothing but node: modules"
  );
  for (const kind of new Set(imports.map((entry) => entry.kind)))
    assert.ok(["import-statement", "dynamic-import", "require-call"].includes(kind), `an import of kind ${kind}`);
  // why: the bundle carries no repository path or package name to resolve at
  // run time; its sources are inlined.
  const text = bytes.toString("utf8");
  assert.doesNotMatch(text, /@verchestra\//u);
  assert.doesNotMatch(text, /from\s*["'][^"']+\.ts["']/u);
});

test("the worker bundle is reproducible", async () => {
  await rm(BUNDLE, { force: true });
  assert.match(build(), /apps\/vestra-cli\/dist\/sqlite-probe-worker\.mjs/u);
  const first = await readFile(BUNDLE);
  build();
  const second = await readFile(BUNDLE);
  assert.ok(first.equals(second), "two builds on one revision write byte-identical bundles");
  assert.ok((await bundleProbeWorker()).bytes.equals(first), "a third bundling of the revision agrees");
});
