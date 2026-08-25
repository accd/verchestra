import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { loadPinnedInputs } from "../../apps/vestra-launcher/src/pinned-inputs.ts";
import { runBootstrap } from "../../apps/vestra-launcher/src/bootstrap.ts";
import {
  LAUNCHER_ERROR_CODES,
  LAUNCHER_EXIT_CODES,
  LauncherBootstrapError,
  renderPublicError
} from "../../apps/vestra-launcher/src/public-errors.ts";
import { fixtureReleaseSource, fixtureTrustRoot } from "../helpers/vestra-launcher-fixture.mjs";

const roots = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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

test("valid pinned inputs load into a frozen public release identity", async () => {
  const inputs = await loadPinnedInputs(await packageRoot());
  assert.equal(inputs.source.schemaVersion, 1);
  assert.equal(inputs.source.metadataBaseUrl, "https://releases.example.invalid/metadata/");
  assert.equal(Object.isFrozen(inputs), true);
  assert.equal(Object.isFrozen(inputs.source), true);
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
      loadPinnedInputs(await packageRoot({ sourceOverrides: { metadataBaseUrl } })),
      { code: "VES_VESTRA_INPUTS_INVALID" },
      metadataBaseUrl
    );
  }
});

test("a target location is held to the same pinned public contract", async () => {
  await assert.rejects(
    loadPinnedInputs(await packageRoot({ sourceOverrides: { targetBaseUrl: "https://x:y@host.invalid/targets/" } })),
    { code: "VES_VESTRA_INPUTS_INVALID" }
  );
});

test("release configuration with missing, unknown, or malformed fields is refused", async () => {
  const cases = [
    { rawSource: "not json" },
    { rawSource: JSON.stringify([]) },
    { rawSource: JSON.stringify({ ...fixtureReleaseSource(), extra: true }) },
    { sourceOverrides: { schemaVersion: 2 } },
    { sourceOverrides: { semanticVersion: "one.point.oh" } },
    { sourceOverrides: { sourceId: "" } },
    { sourceOverrides: { rootDigest: "sha1:abc" } }
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
