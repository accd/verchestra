import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  machineLocalEnvironment,
  selectPinnedTarget
} from "../../apps/vestra-launcher/closure/node-activation-closure.ts";
import { exitCodeFor } from "../../apps/vestra-launcher/src/public-errors.ts";
import { supportedHost } from "../../apps/vestra-launcher/src/supported-host.ts";
import { FLEET_TARGET_KEYS, fixtureReleaseSource } from "../helpers/vestra-launcher-fixture.mjs";

// The schemaVersion-2 pinned source carries one target map so one published
// tarball resolves every fleet platform. Selection is a pure decision: each
// host key must reach exactly its own pinned locations (the fixture gives
// every key distinct URLs, so aliasing between hosts would be visible), and a
// qualified host the map does not name fails closed as unsupported — the
// launcher never borrows another platform's locations.

const roots = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hostOf = (key) => {
  const [platform, arch] = key.split("-");
  return supportedHost({ platform, arch });
};

const thrownBy = (call) => {
  try {
    call();
  } catch (error) {
    return error;
  }
  return assert.fail("the call was expected to throw");
};

test("every fleet host key selects exactly its own pinned target entry", () => {
  const source = fixtureReleaseSource();
  for (const key of FLEET_TARGET_KEYS) {
    const selected = selectPinnedTarget(source, hostOf(key));
    assert.deepEqual(selected, source.targets[key], key);
    assert.equal(selected.metadataBaseUrl, `https://releases.example.invalid/${key}/metadata/`, key);
    assert.equal(selected.targetBaseUrl, `https://releases.example.invalid/${key}/targets/`, key);
  }
});

test("a qualified host absent from the pinned map is refused as unsupported", () => {
  // `win32-arm64` passes the host gate but the fleet fixture does not name it,
  // which is exactly the gap a multi-target map can have.
  const host = supportedHost({ platform: "win32", arch: "arm64" });
  const source = fixtureReleaseSource();
  assert.equal("win32-arm64" in source.targets, false, "the fleet fixture must not name win32-arm64");

  const failure = thrownBy(() => selectPinnedTarget(source, host));
  assert.equal(failure.code, "VES_VESTRA_HOST_UNSUPPORTED");
  assert.match(failure.message, /win32-arm64/u, "the refusal names the missing host key");
  assert.equal(exitCodeFor(failure), 64, "the public error mapping renders the refusal as exit 64");
});

test("the machine-local source factory refuses an absent host key and creates nothing", async () => {
  const home = await mkdtemp(join(tmpdir(), "verchestra-launcher-select-"));
  roots.push(home);
  const restoreHome = process.env["HOME"];
  const restoreProfile = process.env["USERPROFILE"];
  try {
    process.env["HOME"] = home;
    process.env["USERPROFILE"] = home;
    const source = fixtureReleaseSource();
    const environment = machineLocalEnvironment(supportedHost({ platform: "win32", arch: "arm64" }), source);

    const failure = thrownBy(() => environment.createSource(source));
    assert.equal(failure.code, "VES_VESTRA_HOST_UNSUPPORTED");
    assert.match(failure.message, /win32-arm64/u);
    assert.equal(exitCodeFor(failure), 64);
    assert.deepEqual(await readdir(home), [], "refusing a host key must create no directory");
  } finally {
    if (restoreHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = restoreHome;
    if (restoreProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = restoreProfile;
  }
});

// invariant: the published bins refuse an ambient Node below the engine the
// package declares with one public line and the host-unsupported status, and
// hand every other version to the bootstrap. The version is overridden in a
// real process; this source tree holds no built bundle, so an admitted version
// is observed failing to load it.
const BIN_DIRECTORY = new URL("../../apps/vestra-launcher/bin/", import.meta.url);

function runBin(bin, version) {
  const override = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });`;
  return spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(override)}`, fileURLToPath(new URL(bin, BIN_DIRECTORY))],
    { encoding: "utf8", windowsHide: true }
  );
}

test("the Node guard refuses below 24.14.0 with exit 64", () => {
  for (const bin of ["vestra.mjs", "verchestra.mjs"]) {
    for (const version of ["20.0.0", "22.12.0", "24.13.9"]) {
      const result = runBin(bin, version);
      assert.equal(result.status, 64, `${bin} ${version}: ${result.stderr}`);
      assert.equal(result.stdout, "");
      const lines = result.stderr.split("\n").filter((line) => line.length > 0);
      assert.equal(lines.length, 1, result.stderr);
      assert.match(lines[0], /^VES_VESTRA_HOST_UNSUPPORTED: /u);
      assert.ok(lines[0].includes("24.14.0"), lines[0]);
    }
    for (const version of ["24.14.0", "24.15.1", "25.0.0"]) {
      const result = runBin(bin, version);
      assert.notEqual(result.status, 64, `${bin} ${version}`);
      assert.doesNotMatch(result.stderr, /VES_VESTRA_HOST_UNSUPPORTED/u);
      assert.match(result.stderr, /bootstrap\.js/u, `${bin} ${version} did not reach the bootstrap`);
    }
  }
});
