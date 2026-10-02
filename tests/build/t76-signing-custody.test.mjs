import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import * as publisher from "../../scripts/t76-publish-release.mjs";
import * as custody from "../../scripts/t76-signing-custody.mjs";
import { testSigningKeyBase64, writeMatchingReleaseAnchor } from "../helpers/t76-publication-fixture.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// invariant: the twelve names the publisher and the refresh share. The module's
// interface is exactly these; a thirteenth is a deliberate, reviewed addition.
const SHARED = Object.freeze([
  "DEFAULT_RELEASE_ANCHOR",
  "DEFAULT_TIMESTAMP_ANCHOR",
  "KEY_ENVIRONMENT_NAME",
  "RELEASE_ANCHOR_PURPOSE",
  "SUPPORTED_TARGET_KEYS",
  "T76PublishError",
  "TIMESTAMP_ANCHOR_PURPOSE",
  "TIMESTAMP_KEY_ENVIRONMENT_NAME",
  "assertOutputAbsent",
  "expectedAnchorKeyId",
  "releaseSignerFromEnvironment",
  "writeExclusive"
]);

const scratchRoots = [];
after(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
});

const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t76-custody-"));
  scratchRoots.push(root);
  return root;
};

test("the custody module exports exactly the helpers both T76 signing scripts share", () => {
  assert.deepEqual(
    Object.keys(custody).sort((left, right) => Number(left > right) - Number(left < right)),
    [...SHARED]
  );
});

test("the publisher re-exports the shared helpers themselves, so one error class and one signer serve both scripts", () => {
  for (const name of SHARED) assert.equal(publisher[name], custody[name], `${name} must be the shared binding`);
  assert.equal(custody.KEY_ENVIRONMENT_NAME, "VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64");
  assert.equal(custody.TIMESTAMP_KEY_ENVIRONMENT_NAME, "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64");
  assert.equal(custody.RELEASE_ANCHOR_PURPOSE, "tuf-release-root");
  assert.equal(custody.TIMESTAMP_ANCHOR_PURPOSE, "tuf-timestamp-snapshot");
});

test("the default anchors still resolve to the committed trust directory", () => {
  // why: both defaults are relative to the module's own location, so moving the
  // module out of scripts/ would silently point them outside the repository.
  for (const [anchor, name] of [
    [custody.DEFAULT_RELEASE_ANCHOR, "verchestra-release-public-key.json"],
    [custody.DEFAULT_TIMESTAMP_ANCHOR, "release-timestamp-snapshot-public-key.json"]
  ]) {
    assert.equal(fileURLToPath(anchor), join(ROOT, "docs", "qualification", "trust", name));
    assert.equal(existsSync(fileURLToPath(anchor)), true, `${name} must be committed`);
  }
});

test("a signer's key id is the one its matching anchor resolves to, per role", async () => {
  const directory = await scratch();
  const offline = testSigningKeyBase64();
  const online = testSigningKeyBase64();
  const environment = {
    [custody.KEY_ENVIRONMENT_NAME]: offline,
    [custody.TIMESTAMP_KEY_ENVIRONMENT_NAME]: online
  };
  const release = custody.releaseSignerFromEnvironment(environment);
  const timestamp = custody.releaseSignerFromEnvironment(environment, custody.TIMESTAMP_KEY_ENVIRONMENT_NAME);
  assert.notEqual(release.keyId, timestamp.keyId);
  assert.equal(
    await custody.expectedAnchorKeyId(
      writeMatchingReleaseAnchor(directory, offline),
      custody.DEFAULT_RELEASE_ANCHOR,
      custody.RELEASE_ANCHOR_PURPOSE
    ),
    release.keyId
  );
  assert.equal(
    await custody.expectedAnchorKeyId(
      writeMatchingReleaseAnchor(directory, online, custody.TIMESTAMP_ANCHOR_PURPOSE),
      custody.DEFAULT_TIMESTAMP_ANCHOR,
      custody.TIMESTAMP_ANCHOR_PURPOSE
    ),
    timestamp.keyId
  );
  // why: the signer exposes public material and a callback, never the private key.
  assert.deepEqual(Object.keys(release), ["keyId", "publicKeyPem", "sign"]);
  assert.equal(JSON.stringify(release).includes(offline), false);
});

test("an exclusive write never replaces a byte, and an existing output is refused by name", async () => {
  const directory = await scratch();
  const path = join(directory, "ledger-entry.json");
  await custody.writeExclusive(path, Buffer.from("first"), "ledger-entry.json");
  await assert.rejects(
    () => custody.writeExclusive(path, Buffer.from("second"), "ledger-entry.json"),
    (error) => {
      assert.ok(error instanceof publisher.T76PublishError);
      assert.equal(error.code, "VES_T76_PUBLISH_OUTPUT_EXISTS");
      assert.match(error.message, /unable to write ledger-entry\.json/u);
      return true;
    }
  );
  assert.equal(await readFile(path, "utf8"), "first");
  await assert.doesNotReject(() => custody.assertOutputAbsent(join(directory, "absent")));
  await writeFile(join(directory, "present"), "");
  await assert.rejects(() => custody.assertOutputAbsent(join(directory, "present"), "refresh"), {
    code: "VES_T76_PUBLISH_OUTPUT_EXISTS",
    message: "the refresh output already exists"
  });
});
