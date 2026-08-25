import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { loadPinnedInputs } from "../../apps/vestra-launcher/src/pinned-inputs.ts";
import { runBootstrap } from "../../apps/vestra-launcher/src/bootstrap.ts";
import {
  LAUNCHER_ERROR_CODES,
  LAUNCHER_EXIT_CODES,
  LauncherBootstrapError,
  diagnosticCodeOf,
  renderPublicError
} from "../../apps/vestra-launcher/src/public-errors.ts";
import { buildVestraLauncher } from "../../scripts/build-vestra-launcher.mjs";
import {
  disposeLauncherFixtures,
  fixtureReleaseSource,
  fixtureTargets,
  fixtureTrustRoot,
  outputDirectory,
  pinnedInputDirectory
} from "../helpers/vestra-launcher-fixture.mjs";

const roots = [];
const launcherSourceRoot = new URL("../../apps/vestra-launcher/", import.meta.url);

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await disposeLauncherFixtures();
});

async function packageRoot(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-launcher-pkg-"));
  roots.push(root);
  await mkdir(join(root, "config"), { recursive: true });
  const trustedRoot = options.trustedRoot ?? fixtureTrustRoot();
  if (options.omitRoot !== true) await writeFile(join(root, "config", "root.json"), trustedRoot);
  if (options.omitSource !== true)
    await writeFile(
      join(root, "config", "release-source.json"),
      options.rawSource ?? JSON.stringify(fixtureReleaseSource(options.sourceOverrides ?? {}))
    );
  return root;
}

/** The fleet target map with one override applied to the `win32-x64` entry. */
const targetsWith = (entryOverrides) => {
  const targets = fixtureTargets();
  targets["win32-x64"] = { ...targets["win32-x64"], ...entryOverrides };
  return targets;
};

test("valid pinned inputs load into a frozen public release identity", async () => {
  const inputs = await loadPinnedInputs(await packageRoot());
  assert.equal(inputs.source.schemaVersion, 2);
  assert.equal(
    inputs.source.targets["win32-x64"].metadataBaseUrl,
    "https://releases.example.invalid/win32-x64/metadata/"
  );
  assert.equal(Object.isFrozen(inputs), true);
  assert.equal(Object.isFrozen(inputs.source), true);
  assert.equal(Object.isFrozen(inputs.source.targets), true);
  assert.equal(Object.isFrozen(inputs.source.targets["win32-x64"]), true);
  assert.ok(inputs.trustedRoot.byteLength > 0);
});

test("a source location that is not credential-free HTTPS is refused", async () => {
  const rejected = [
    "http://releases.example.invalid/metadata/",
    "https://user:token@releases.example.invalid/metadata/",
    "https://releases.example.invalid/metadata/?token=abc",
    "https://releases.example.invalid/metadata/#fragment",
    "https://releases.example.invalid/metadata",
    "file:///releases/metadata/",
    "ftp://releases.example.invalid/metadata/",
    "https://${VESTRA_HOST}/metadata/",
    "not a url"
  ];
  for (const metadataBaseUrl of rejected) {
    await assert.rejects(
      loadPinnedInputs(await packageRoot({ sourceOverrides: { targets: targetsWith({ metadataBaseUrl }) } })),
      { code: "VES_VESTRA_INPUTS_INVALID" },
      metadataBaseUrl
    );
  }
});

test("a target location is held to the same pinned public contract", async () => {
  await assert.rejects(
    loadPinnedInputs(
      await packageRoot({
        sourceOverrides: { targets: targetsWith({ targetBaseUrl: "https://x:y@host.invalid/targets/" }) }
      })
    ),
    { code: "VES_VESTRA_INPUTS_INVALID" }
  );
});

test("release configuration with missing, unknown, or malformed fields is refused", async () => {
  const withoutTargets = { ...fixtureReleaseSource() };
  delete withoutTargets.targets;
  const cases = [
    { rawSource: "not json" },
    { rawSource: JSON.stringify([]) },
    { rawSource: JSON.stringify({ ...fixtureReleaseSource(), extra: true }) },
    // Version 1 was never published, so no compatibility path exists: the
    // version bump is the migration and 1 is refused like any other non-2.
    { sourceOverrides: { schemaVersion: 1 } },
    { sourceOverrides: { semanticVersion: "one.point.oh" } },
    { sourceOverrides: { sourceId: "" } },
    { sourceOverrides: { rootDigest: "sha1:abc" } },
    { rawSource: JSON.stringify(withoutTargets) },
    { sourceOverrides: { targets: [] } },
    { sourceOverrides: { targets: {} } },
    { sourceOverrides: { targets: { ...fixtureTargets(), "win32-mips": fixtureTargets()["win32-x64"] } } },
    { sourceOverrides: { targets: targetsWith({ extra: true }) } },
    {
      sourceOverrides: {
        targets: {
          ...fixtureTargets(),
          "win32-x64": { metadataBaseUrl: "https://releases.example.invalid/win32-x64/metadata/" }
        }
      }
    },
    { sourceOverrides: { targets: { ...fixtureTargets(), "win32-x64": "not an entry" } } }
  ];
  for (const options of cases) {
    await assert.rejects(loadPinnedInputs(await packageRoot(options)), { code: "VES_VESTRA_INPUTS_INVALID" });
  }
});

test("absent pinned inputs are reported as missing, never defaulted", async () => {
  for (const options of [{ omitSource: true }, { omitRoot: true }]) {
    await assert.rejects(loadPinnedInputs(await packageRoot(options)), { code: "VES_VESTRA_INPUTS_MISSING" });
  }
});

test("a trust root that is substituted or is not a TUF root role is refused", async () => {
  await assert.rejects(loadPinnedInputs(await packageRoot({ trustedRoot: `${fixtureTrustRoot()} ` })), {
    code: "VES_VESTRA_TRUST_ROOT_INVALID"
  });
  const impostor = `${JSON.stringify({ signatures: [], signed: { _type: "targets" } })}\n`;
  await assert.rejects(
    loadPinnedInputs(
      await packageRoot({
        trustedRoot: impostor,
        sourceOverrides: { rootDigest: `sha256:${createHash("sha256").update(impostor).digest("hex")}` }
      })
    ),
    { code: "VES_VESTRA_TRUST_ROOT_INVALID" }
  );
});

test("no environment variable can select a different root, repository, or release", async () => {
  const root = await packageRoot();
  const before = await loadPinnedInputs(root);
  const restore = { ...process.env };
  try {
    Object.assign(process.env, {
      VESTRA_METADATA_URL: "https://attacker.invalid/metadata/",
      VESTRA_TARGET_URL: "https://attacker.invalid/targets/",
      VESTRA_ROOT: "/tmp/attacker-root.json",
      VESTRA_RELEASE_ID: "release:attacker",
      NODE_OPTIONS: "--require /tmp/attacker.js"
    });
    assert.deepEqual(await loadPinnedInputs(root), before);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in restore)) delete process.env[key];
  }
  const sources = await Promise.all(
    ["bootstrap.ts", "pinned-inputs.ts", "public-errors.ts", "supported-host.ts"].map((file) =>
      readFile(new URL(`../../apps/vestra-launcher/src/${file}`, import.meta.url), "utf8")
    )
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /process\.env/u, "the launcher must read no environment value");
  }
});

test("the bootstrap fails closed on an unsupported host before reading any input", async () => {
  const lines = [];
  const status = await runBootstrap(
    ["--help"],
    { platform: "aix", arch: "ppc64", packageRoot: "/nonexistent/vestra" },
    (line) => lines.push(line)
  );
  assert.equal(status, LAUNCHER_EXIT_CODES.VES_VESTRA_HOST_UNSUPPORTED);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^VES_VESTRA_HOST_UNSUPPORTED: /u);
});

test("the bootstrap never resolves or executes anything without an activation closure", async () => {
  const lines = [];
  const status = await runBootstrap(
    ["--version"],
    { platform: process.platform, arch: process.arch, packageRoot: await packageRoot() },
    (line) => lines.push(line)
  );
  assert.equal(status, LAUNCHER_EXIT_CODES.VES_VESTRA_ACTIVATION_UNAVAILABLE);
  assert.match(lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: /u);
});

test("every rendered bootstrap failure is a closed public code with actionable recovery", () => {
  assert.deepEqual([...LAUNCHER_ERROR_CODES], [...LAUNCHER_ERROR_CODES].sort());
  for (const code of LAUNCHER_ERROR_CODES) {
    const rendered = renderPublicError(new LauncherBootstrapError(code, "something specific went wrong"));
    assert.match(rendered, new RegExp(`^${code}: `, "u"));
    assert.ok(rendered.trim().endsWith("."), `${code} must end with an actionable sentence`);
    assert.equal(Number.isSafeInteger(LAUNCHER_EXIT_CODES[code]), true);
    assert.notEqual(LAUNCHER_EXIT_CODES[code], 0, `${code} must not render as success`);
  }
  // An unexpected internal failure is redacted, never leaked verbatim.
  const leaky = new Error("ENOENT: open 'C:\\Users\\someone\\.npm\\_cacache' token=abcd1234");
  const rendered = renderPublicError(leaky);
  assert.equal(rendered.includes("someone"), false);
  assert.equal(rendered.includes("abcd1234"), false);
  assert.match(rendered, /^VES_VESTRA_ACTIVATION_UNAVAILABLE: /u);
});

// An activation failure originates in the qualified TUF and activation code. Its
// canonical code is worth showing; nothing else about it is.
test("an upstream failure contributes only a bare canonical code to the public line", () => {
  const upstream = Object.assign(new Error("staging path C:\\Users\\someone\\state escapes the release root"), {
    code: "VES_TUF_STAGE_PATH_INVALID"
  });
  assert.equal(diagnosticCodeOf(upstream), "VES_TUF_STAGE_PATH_INVALID");

  const rendered = renderPublicError(
    new LauncherBootstrapError(
      "VES_VESTRA_ACTIVATION_UNAVAILABLE",
      "vestra could not activate",
      diagnosticCodeOf(upstream)
    )
  );
  assert.equal(rendered.includes("someone"), false);
  assert.equal(rendered.includes("escapes"), false);
  assert.match(rendered, /\(VES_TUF_STAGE_PATH_INVALID\)\./u);

  for (const smuggled of [
    "VES_X https://user:token@host.invalid/",
    "C:\\Users\\someone",
    "ves_lowercase",
    `VES_${"A".repeat(200)}`,
    "",
    "not a code"
  ]) {
    assert.equal(diagnosticCodeOf({ code: smuggled }), undefined, smuggled);
    assert.equal(
      renderPublicError(new LauncherBootstrapError("VES_VESTRA_ACTIVATION_UNAVAILABLE", "failed", smuggled)).includes(
        "("
      ),
      false,
      smuggled
    );
  }
  for (const shaped of [undefined, null, "text", 7, { code: 7 }, new Error("plain")]) {
    assert.equal(diagnosticCodeOf(shaped), undefined);
  }
});

// The published sources and the build-time closure are held to the same rule:
// no environment value may select a state root, repository, trust root, or
// release. The list is read from disk so a new source cannot escape the check.
test("no launcher source, published or build-time, reads an environment value", async () => {
  for (const directory of ["src", "closure"]) {
    const location = new URL(`${directory}/`, launcherSourceRoot);
    const files = (await readdir(location)).filter((name) => name.endsWith(".ts"));
    assert.ok(files.length > 0, `${directory} must contain sources`);
    for (const file of files) {
      const source = await readFile(new URL(file, location), "utf8");
      assert.doesNotMatch(source, /process\.env/u, `${directory}/${file} must read no environment value`);
    }
  }
});

// The composition a published tarball performs must be readable in one line and
// carry no alternative, no fallback, and no configuration.
test("the published wiring composes exactly the machine-local environment", async () => {
  const entry = await readFile(new URL("closure/bootstrap-entry.ts", launcherSourceRoot), "utf8");
  assert.match(entry, /new NodeActivationClosure\(machineLocalEnvironment\)/u);
  assert.equal(entry.includes("process.env"), false);
  assert.deepEqual(
    [...entry.matchAll(/new NodeActivationClosure\(/gu)].length,
    1,
    "the published entry constructs exactly one closure"
  );
});

test("the emitted bundle leaks no machine-local path, account name, or dependency path", async () => {
  const receipt = await buildVestraLauncher({
    releaseInputs: await pinnedInputDirectory(),
    outputDirectory: await outputDirectory()
  });
  const bundled = await readFile(join(receipt.outputDirectory, "lib", "bootstrap.js"), "utf8");

  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  for (const secret of [repositoryRoot, homedir(), tmpdir(), userInfo().username]) {
    assert.equal(bundled.includes(secret), false, `the bundle must not embed ${secret.slice(0, 12)}…`);
  }
  for (const pattern of [
    /node_modules/u,
    /\.pnpm/u,
    /sourceMappingURL/u,
    /[A-Za-z]:[\\/](?:Users|home)[\\/]/u,
    /\/(?:home|Users)\/[A-Za-z0-9._-]+\//u,
    /@verchestra\//u
  ]) {
    assert.doesNotMatch(bundled, pattern, `the bundle must not embed ${pattern}`);
  }
});
