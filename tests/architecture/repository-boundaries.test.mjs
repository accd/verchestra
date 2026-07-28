import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_PACKAGES,
  NON_PRODUCT_WORKSPACES,
  inspectSource,
  scanWorkspace,
  validateDependencyEdge
} from "../../scripts/architecture.mjs";

const root = new URL("../..", import.meta.url);

test("repository contains the complete approved package graph", async () => {
  const manifests = [];
  for (const directory of ["apps", "packages"]) {
    for (const entry of await readdir(new URL(`../../${directory}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(`${directory}/${entry.name}`);
    }
  }
  assert.deepEqual(manifests.sort(), [...EXPECTED_PACKAGES, ...NON_PRODUCT_WORKSPACES].sort());
});

test("non-product workspaces are declared and stay outside the scanned graph", () => {
  assert.deepEqual(NON_PRODUCT_WORKSPACES, ["apps/site"]);
  for (const path of NON_PRODUCT_WORKSPACES) assert.equal(EXPECTED_PACKAGES.includes(path), false);
  assert.deepEqual(validateDependencyEdge("application", "site"), {
    allowed: false,
    code: "VES_ARCH_CONCRETE_ADAPTER_IMPORT"
  });
});

test("every workspace package is private, exact-versioned, and ESM", async () => {
  for (const path of [...EXPECTED_PACKAGES, ...NON_PRODUCT_WORKSPACES]) {
    const manifest = JSON.parse(await readFile(new URL(`../../${path}/package.json`, import.meta.url), "utf8"));
    assert.equal(manifest.private, true);
    assert.equal(manifest.version, "0.0.0");
    assert.equal(manifest.type, "module");
  }
});

test("domain may depend on contracts only", () => {
  assert.deepEqual(validateDependencyEdge("domain", "contracts"), { allowed: true });
  assert.deepEqual(validateDependencyEdge("domain", "application"), { allowed: false, code: "VES_ARCH_INWARD_RULE" });
});

test("application may depend inward but never on a concrete adapter", () => {
  assert.deepEqual(validateDependencyEdge("application", "domain"), { allowed: true });
  assert.deepEqual(validateDependencyEdge("application", "drivers"), {
    allowed: false,
    code: "VES_ARCH_CONCRETE_ADAPTER_IMPORT"
  });
});

test("adapters may implement application ports but cannot import sibling adapters", () => {
  assert.deepEqual(validateDependencyEdge("drivers", "application"), { allowed: true });
  assert.deepEqual(validateDependencyEdge("drivers", "connectors"), {
    allowed: false,
    code: "VES_ARCH_ADAPTER_COUPLING"
  });
});

test("CLI is the composition root and may import application plus adapters", () => {
  assert.deepEqual(validateDependencyEdge("vestra-cli", "application"), { allowed: true });
  assert.deepEqual(validateDependencyEdge("vestra-cli", "drivers"), { allowed: true });
});

test("domain source cannot read environment/global paths or Node platform modules", () => {
  assert.deepEqual(inspectSource("domain", `import fs from "node:fs"; const key = process.env.KEY;`), [
    { code: "VES_ARCH_DOMAIN_NODE_IMPORT", detail: "node:fs" },
    { code: "VES_ARCH_DOMAIN_ENV_ACCESS", detail: "process.env" }
  ]);
});

test("third-party imports are restricted to adapter packages and the composition root", () => {
  assert.deepEqual(inspectSource("application", `import { Updater } from "tuf-js";`), [
    { code: "VES_ARCH_THIRD_PARTY_IMPORT", detail: "tuf-js" }
  ]);
  assert.deepEqual(inspectSource("distribution", `import { Updater } from "tuf-js";`), []);
});

test("current product sources contain no dependency-boundary violations", async () => {
  assert.deepEqual(await scanWorkspace(new URL("../..", import.meta.url)), []);
});

test("all five stable gate entrypoints execute in smoke mode", () => {
  for (const gate of ["quick", "full", "build", "security", "release"]) {
    const result = spawnSync(process.execPath, [join(fileURLToPath(root), "scripts", "gate.mjs"), gate, "--smoke"], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${gate}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`gate:${gate} smoke PASS`));
  }
});
