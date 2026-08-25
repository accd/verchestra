import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

import {
  EXPECTED_PACKAGES,
  NON_PRODUCT_WORKSPACES,
  inspectSource,
  validateDependencyEdge
} from "../../scripts/architecture.mjs";
import { PUBLISHED_FILE_ALLOWLIST } from "../../scripts/build-vestra-launcher.mjs";
import {
  SUPPORTED_LAUNCHER_ARCHES,
  SUPPORTED_LAUNCHER_PLATFORMS,
  supportedHost
} from "../../apps/vestra-launcher/src/supported-host.ts";
import { supportedLauncherHost } from "../../packages/platform-node/src/activation-launcher-adapters.ts";

const packageRoot = new URL("../../apps/vestra-launcher/", import.meta.url);

test("the public launcher is a declared product package, not an unscanned workspace", () => {
  assert.ok(EXPECTED_PACKAGES.includes("apps/vestra-launcher"));
  assert.equal(NON_PRODUCT_WORKSPACES.includes("apps/vestra-launcher"), false);
});

test("the public launcher may import no workspace package at all, not even inward", () => {
  for (const target of ["contracts", "domain", "application", "distribution", "platform-node", "vestra-cli"]) {
    assert.deepEqual(validateDependencyEdge("vestra-launcher", target), {
      allowed: false,
      code: "VES_ARCH_PUBLIC_LAUNCHER_ISOLATED"
    });
  }
  assert.deepEqual(inspectSource("vestra-launcher", 'import { canonicalizeJsonV2 } from "@verchestra/domain";'), [
    { code: "VES_ARCH_PUBLIC_LAUNCHER_ISOLATED", detail: "@verchestra/domain" }
  ]);
});

test("a third-party import in the public launcher is a boundary violation", () => {
  assert.deepEqual(inspectSource("vestra-launcher", 'import { Updater } from "tuf-js";'), [
    { code: "VES_ARCH_THIRD_PARTY_IMPORT", detail: "tuf-js" }
  ]);
  // The same import stays legal in an adapter package, so the new rule narrows
  // only the published surface.
  assert.deepEqual(inspectSource("distribution", 'import { Updater } from "tuf-js";'), []);
});

test("every public launcher source imports only Node built-ins and its own siblings", async () => {
  const directory = new URL("src/", packageRoot);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(new URL(file, directory), "utf8");
    assert.deepEqual(inspectSource("vestra-launcher", source), [], `${file} must import nothing outside the package`);
    for (const specifier of [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1])) {
      assert.ok(
        specifier.startsWith("node:") || specifier.startsWith("./"),
        `${file} imports ${specifier}, which cannot travel in a published tarball`
      );
    }
  }
});

// `src/` is the published surface and `closure/` is a build input. The
// separation is the whole reason the launcher can carry the qualified TUF and
// activation code without declaring, or resolving, a single dependency.
test("the build-time closure reaches the workspace only by repository path, never by package name", async () => {
  const directory = new URL("closure/", packageRoot);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(new URL(file, directory), "utf8");
    assert.doesNotMatch(source, /["']@verchestra\//u, `${file} must not name a workspace package`);
    for (const specifier of [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1])) {
      assert.ok(
        specifier.startsWith("node:") || specifier.startsWith("./") || specifier.startsWith("../"),
        `${file} imports ${specifier}, which the build cannot inline from the repository`
      );
    }
  }
});

test("no published launcher source reaches into the build-time closure", async () => {
  const directory = new URL("src/", packageRoot);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".ts"))) {
    const source = await readFile(new URL(file, directory), "utf8");
    assert.equal(source.includes("closure/"), false, `${file} must not import a build input`);
  }
});

test("the published tree carries neither source directory and declares no dependency", async () => {
  assert.deepEqual(
    PUBLISHED_FILE_ALLOWLIST.filter((path) => path.startsWith("lib/")),
    ["lib/bootstrap.js"],
    "one bundled module replaces every compiled source file"
  );
  for (const path of PUBLISHED_FILE_ALLOWLIST) {
    assert.equal(path.startsWith("src/") || path.startsWith("closure/"), false, path);
    assert.equal(path.endsWith(".ts"), false, path);
  }
  const manifest = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
  assert.equal("dependencies" in manifest, false, "the launcher workspace declares no dependency edge");
});

test("every tracked bin shim resolves only compiled sibling JavaScript", async () => {
  // Two shims ship: `verchestra` is the package name, so it is what `npx`
  // resolves; `vestra` stays as the short everyday command after install.
  for (const name of ["verchestra", "vestra"]) {
    const shim = await readFile(new URL(`bin/${name}.mjs`, packageRoot), "utf8");
    const specifiers = [...shim.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    assert.deepEqual(specifiers, ["../lib/bootstrap.js"], name);
    assert.ok(PUBLISHED_FILE_ALLOWLIST.includes(`bin/${name}.mjs`), name);
  }
  assert.ok(PUBLISHED_FILE_ALLOWLIST.includes("lib/bootstrap.js"));
});

test("the publish manifest declares its bins, no scripts, and no dependency", async () => {
  const template = JSON.parse(await readFile(new URL("publish/package.template.json", packageRoot), "utf8"));
  assert.equal(template.name, "verchestra");
  assert.deepEqual(template.bin, { verchestra: "./bin/verchestra.mjs", vestra: "./bin/vestra.mjs" });
  // `npx <package>` resolves the bin named like the package, so the package
  // name must always have a bin of its own or the published entry point breaks.
  assert.ok(Object.hasOwn(template.bin, template.name));
  assert.equal(template.type, "module");
  assert.equal("scripts" in template, false, "a published launcher must carry no install or lifecycle script");
  assert.equal("dependencies" in template, false);
  assert.equal("devDependencies" in template, false);
  assert.equal("private" in template, false);
});

// The public launcher cannot import the workspace, so it restates the qualified
// host set. Restating it is only safe while the two agree exactly.
test("the launcher's host set and the platform-node host contract cannot drift apart", () => {
  const candidates = ["win32", "linux", "darwin", "aix", "sunos", "android"].flatMap((platform) =>
    ["x64", "arm64", "ia32", "arm", ""].map((arch) => ({ platform, arch }))
  );
  for (const candidate of candidates) {
    const launcher = accepts(() => supportedHost(candidate));
    const adapter = accepts(() => supportedLauncherHost(candidate));
    assert.equal(launcher, adapter, `${candidate.platform}-${candidate.arch} must be judged identically`);
  }
  assert.deepEqual([...SUPPORTED_LAUNCHER_PLATFORMS], ["win32", "linux", "darwin"]);
  assert.deepEqual([...SUPPORTED_LAUNCHER_ARCHES], ["x64", "arm64"]);
});

function accepts(call) {
  try {
    call();
    return true;
  } catch {
    return false;
  }
}
