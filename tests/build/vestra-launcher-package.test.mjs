import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { PUBLISHED_FILE_ALLOWLIST, buildVestraLauncher } from "../../scripts/build-vestra-launcher.mjs";
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
  assert.equal(receipt.packageName, "vestra");
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
  assert.equal(report[0].name, "vestra");
  assert.equal(report[0].version, FIXTURE_SEMANTIC_VERSION);
  assert.deepEqual(report[0].files.map((file) => file.path).sort(), [...PUBLISHED_FILE_ALLOWLIST]);
});

test("the packed tarball itself contains exactly the declared allowlist", async () => {
  const receipt = await sharedPackage();
  const destination = await disposableDirectory();
  await runNpm(receipt.outputDirectory, ["pack", "--pack-destination", destination]);
  const archive = (await readdir(destination)).find((entry) => entry.endsWith(".tgz"));
  assert.equal(archive, `vestra-${FIXTURE_SEMANTIC_VERSION}.tgz`);

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
