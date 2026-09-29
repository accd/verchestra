import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { test } from "node:test";

import {
  EMBEDDED_CONFIG_KEYS,
  embeddedConfigReader,
  runSingleBinary
} from "../../apps/vestra-launcher/closure/single-binary-bootstrap.ts";
import { fixtureReleaseSource, fixtureTrustRoot } from "../helpers/vestra-launcher-fixture.mjs";

// why: the single binary composes the shared bootstrap with two differences
// from the npm channel — embedded inputs and a local `--version` — and each
// difference must be exactly as wide as specified: the reader serves only the
// two pinned files, and `--version` is answered only when it is the whole
// argument vector. Everything else must reach the activated release verbatim.

const assets = (overrides = {}) => ({
  "config/release-source.json": Buffer.from(JSON.stringify(fixtureReleaseSource())),
  "config/root.json": Buffer.from(fixtureTrustRoot()),
  ...overrides
});

const readerOver = (table) =>
  embeddedConfigReader((key) => {
    if (!Object.hasOwn(table, key)) throw new Error(`asset ${key} not found`);
    const bytes = table[key];
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });

const context = (table = assets(), host = { platform: process.platform, arch: process.arch }) => ({
  ...host,
  readPinnedConfig: readerOver(table)
});

const target = Object.freeze({
  runtimeExecutable: isAbsolute("/r/node") ? "/r/node" : "C:\\r\\node.exe",
  launcherPath: isAbsolute("/r/bin/vestra.mjs") ? "/r/bin/vestra.mjs" : "C:\\r\\bin\\vestra.mjs",
  releaseId: "release:verchestra:unit",
  semanticVersion: "1.0.0"
});

function recordingClosure() {
  const calls = { activate: 0, handoffs: [] };
  return {
    calls,
    closure: {
      activate: async () => {
        calls.activate += 1;
        return target;
      },
      handoff: async ({ args }) => {
        calls.handoffs.push(args);
        return { exitCode: 5, signal: null };
      }
    }
  };
}

async function run(args, ctx = context()) {
  const out = [];
  const err = [];
  const { calls, closure } = recordingClosure();
  const status = await runSingleBinary(
    args,
    ctx,
    { stdout: (line) => out.push(line), stderr: (line) => err.push(line) },
    closure
  );
  return { status, out, err, calls };
}

test("the embedded reader serves exactly the two pinned files by their asset keys", async () => {
  assert.deepEqual(EMBEDDED_CONFIG_KEYS, {
    "release-source.json": "config/release-source.json",
    "root.json": "config/root.json"
  });
  const read = readerOver(assets());
  assert.equal(Buffer.from(await read("root.json")).toString("utf8"), fixtureTrustRoot());
  await assert.rejects(readerOver({})("root.json"), { code: "VES_VESTRA_INPUTS_MISSING" });
});

test("a lone --version is answered from the pinned inputs without activating anything", async () => {
  const { status, out, err, calls } = await run(["--version"]);
  assert.equal(status, 0);
  assert.deepEqual(err, []);
  assert.deepEqual(out, [
    `vestra ${fixtureReleaseSource().semanticVersion} (single binary; ${process.platform}-${process.arch}; node ${process.version})\n`
  ]);
  assert.equal(calls.activate, 0, "version reporting must never resolve or activate a release");
});

test("--version still validates the host and the embedded inputs before answering", async () => {
  const tampered = await run(
    ["--version"],
    context(assets({ "config/root.json": Buffer.from(`${fixtureTrustRoot()} `) }))
  );
  assert.equal(tampered.status, 78);
  assert.deepEqual(tampered.out, []);
  assert.match(tampered.err[0], /^VES_VESTRA_TRUST_ROOT_INVALID: /u);

  const missing = await run(["--version"], context({}));
  assert.equal(missing.status, 78);
  assert.match(missing.err[0], /^VES_VESTRA_INPUTS_MISSING: /u);

  const host = await run(["--version"], context(assets(), { platform: "aix", arch: "ppc64" }));
  assert.equal(host.status, 64);
  assert.match(host.err[0], /^VES_VESTRA_HOST_UNSUPPORTED: /u);
});

test("every other argument vector reaches the activated release verbatim", async () => {
  for (const args of [
    [],
    ["--version", "--output", "json"],
    ["self-test", "--profile", "smoke"],
    ["--message", 'a b "c"', "$(echo pwned)", "; echo pwned", "%USERPROFILE%"]
  ]) {
    const { status, out, calls } = await run(args);
    assert.equal(status, 5, "the activated launcher's exit status is the binary's result");
    assert.deepEqual(out, []);
    assert.equal(calls.activate, 1);
    assert.deepEqual(calls.handoffs, [args]);
  }
});
