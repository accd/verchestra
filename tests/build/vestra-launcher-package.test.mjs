import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  BUNDLE_REQUIRE_GUARD,
  PUBLISHED_FILE_ALLOWLIST,
  buildVestraLauncher
} from "../../scripts/build-vestra-launcher.mjs";
import {
  FIXTURE_SEMANTIC_VERSION,
  disposableDirectory,
  disposeLauncherFixtures,
  listTarEntries,
  outputDirectory,
  pinnedInputDirectory,
  runNpm
} from "../helpers/vestra-launcher-fixture.mjs";

const execute = promisify(execFile);

after(async () => {
  await disposeLauncherFixtures();
});

// One compiled package serves every positive assertion below. Each case reads
// it independently and none mutates it: `npm pack` always writes its archive to
// a separate destination, so the emitted tree stays exactly what the build
// produced regardless of case order.
let shared;
const sharedPackage = async () => {
  shared ??= buildVestraLauncher({
    releaseInputs: await pinnedInputDirectory(),
    outputDirectory: await outputDirectory()
  });
  return await shared;
};

test("the emitted package is exactly the declared file allowlist", async () => {
  const receipt = await sharedPackage();
  assert.deepEqual(
    receipt.files.map((file) => file.path),
    [...PUBLISHED_FILE_ALLOWLIST]
  );
  assert.equal(receipt.packageName, "verchestra");
  assert.equal(receipt.packageVersion, FIXTURE_SEMANTIC_VERSION);
  for (const file of receipt.files) {
    assert.match(file.contentDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(file.sizeBytes > 0, `${file.path} must not be empty`);
  }
});

test("npm pack --dry-run reports exactly the declared allowlist", async () => {
  const receipt = await sharedPackage();
  const report = JSON.parse(await runNpm(receipt.outputDirectory, ["pack", "--dry-run", "--json"]));
  assert.equal(report.length, 1);
  assert.equal(report[0].name, "verchestra");
  assert.equal(report[0].version, FIXTURE_SEMANTIC_VERSION);
  assert.deepEqual(report[0].files.map((file) => file.path).sort(), [...PUBLISHED_FILE_ALLOWLIST]);
});

test("the packed tarball itself contains exactly the declared allowlist", async () => {
  const receipt = await sharedPackage();
  const destination = await disposableDirectory();
  await runNpm(receipt.outputDirectory, ["pack", "--pack-destination", destination]);
  const archive = (await readdir(destination)).find((entry) => entry.endsWith(".tgz"));
  assert.equal(archive, `verchestra-${FIXTURE_SEMANTIC_VERSION}.tgz`);

  const entries = listTarEntries(await readFile(join(destination, archive)));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    PUBLISHED_FILE_ALLOWLIST.map((path) => `package/${path}`).sort()
  );
});

test("the emitted bootstrap runs, fails closed, and reports a stable public code", async () => {
  const receipt = await sharedPackage();
  const failure = await execute(process.execPath, [join(receipt.outputDirectory, "bin", "vestra.mjs"), "--help"], {
    encoding: "utf8",
    windowsHide: true
  }).catch((error) => error);

  assert.equal(failure.code, 70, "an unavailable activation closure must be a deterministic non-zero status");
  assert.match(failure.stderr, /^VES_VESTRA_ACTIVATION_UNAVAILABLE: /u);
  assert.equal(failure.stdout, "");
});

// The bundle is what makes the tarball dependency-free, so it is asserted as an
// artifact property of the emitted bytes rather than as a build option.
test("the emitted bootstrap is one bundled module that imports only Node built-ins", async () => {
  const receipt = await sharedPackage();
  const emitted = receipt.files.map((file) => file.path).filter((path) => path.startsWith("lib/"));
  assert.deepEqual(emitted, ["lib/bootstrap.js"], "a published launcher carries exactly one compiled module");

  const bundled = await readFile(join(receipt.outputDirectory, "lib", "bootstrap.js"), "utf8");
  const specifiers = [...bundled.matchAll(/(?:^|[\s;}])import\s*(?:[^"';]*?from\s*)?["']([^"']+)["']/gu)].map(
    (match) => match[1]
  );
  assert.ok(specifiers.length > 0, "the bundle must still import the Node built-ins it uses");
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("node:"), `the published bundle may not import ${specifier} at run time`);
  }
});

// A stub that always refused would also exit 70, so the emitted bootstrap is
// asserted to fail from inside the real closure: only the bundled trust-root
// anchoring check can produce this canonical diagnostic code.
test("the emitted bootstrap fails from inside a real activation closure", async () => {
  const receipt = await sharedPackage();
  const failure = await execute(process.execPath, [join(receipt.outputDirectory, "bin", "vestra.mjs"), "--version"], {
    encoding: "utf8",
    windowsHide: true
  }).catch((error) => error);

  assert.match(failure.stderr, /\(VES_TUF_TRUST_ROOT_INVALID\)\./u);
  assert.equal(failure.stderr.includes("carries no activation closure"), false);
});

test("the bundle's require shim serves Node built-ins and refuses every package", async () => {
  const receipt = await sharedPackage();
  const bundled = await readFile(join(receipt.outputDirectory, "lib", "bootstrap.js"), "utf8");
  assert.ok(bundled.startsWith(BUNDLE_REQUIRE_GUARD), "the emitted bundle must open with the fail-closed shim");

  const probe = join(await disposableDirectory(), "require-shim.mjs");
  await writeFile(probe, `${BUNDLE_REQUIRE_GUARD}\nexport const resolve = (id) => require(id);\n`);
  const { resolve } = await import(pathToFileURL(probe).href);
  assert.equal(typeof resolve("node:path").join, "function");
  assert.equal(typeof resolve("util").format, "function");
  for (const identifier of ["tuf-js", "./neighbour.js", "C:/anything", "/etc/passwd"]) {
    assert.throws(() => resolve(identifier), /refuses a runtime module resolution/u, identifier);
  }
});

test("two builds from identical pinned inputs emit byte-identical files", async () => {
  const inputs = await pinnedInputDirectory();
  const first = await buildVestraLauncher({ releaseInputs: inputs, outputDirectory: await outputDirectory() });
  const second = await buildVestraLauncher({ releaseInputs: inputs, outputDirectory: await outputDirectory() });
  assert.notEqual(first.outputDirectory, second.outputDirectory);
  assert.deepEqual(second.files, first.files);
});

test("the build refuses to emit without reviewed pinned release inputs", async () => {
  await assert.rejects(buildVestraLauncher({ releaseInputs: undefined, outputDirectory: await outputDirectory() }), {
    code: "VES_VESTRA_BUILD_INPUTS_MISSING"
  });
  for (const omission of [{ omitRoot: true }, { omitSource: true }]) {
    await assert.rejects(
      buildVestraLauncher({
        releaseInputs: await pinnedInputDirectory(omission),
        outputDirectory: await outputDirectory()
      }),
      { code: "VES_VESTRA_BUILD_INPUTS_MISSING" }
    );
  }
});

test("the build refuses a trust root that does not match its pinned configuration", async () => {
  await assert.rejects(
    buildVestraLauncher({
      releaseInputs: await pinnedInputDirectory({ sourceOverrides: { rootDigest: `sha256:${"0".repeat(64)}` } }),
      outputDirectory: await outputDirectory()
    }),
    { code: "VES_VESTRA_BUILD_INPUT_INVALID" }
  );
});

test("the build refuses to overwrite an existing output tree", async () => {
  const receipt = await sharedPackage();
  await assert.rejects(
    buildVestraLauncher({ releaseInputs: await pinnedInputDirectory(), outputDirectory: receipt.outputDirectory }),
    { code: "VES_VESTRA_BUILD_OUTPUT_EXISTS" }
  );
});
