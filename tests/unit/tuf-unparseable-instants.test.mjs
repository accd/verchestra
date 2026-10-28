import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalize } from "@tufjs/canonical-json";

import {
  buildTufOnlineRoleRefresh,
  buildTufReleasePublication
} from "../../packages/distribution/src/tuf-publication.ts";
import { fixture } from "../helpers/tuf-publication-fixture.mjs";

// SonarCloud S1940 (T8): the two "not after now" expiry checks are now written
// as a NaN test plus `<=`. An instant that passes the shape check but names no
// date (month 13) parses to NaN, and must still be refused, as `!(NaN > now)`
// refused it.

const UNPARSEABLE = "2099-13-01T00:00:00.000Z";

const publicationInput = (value, expires) => ({
  schemaVersion: 1,
  candidate: value.candidate,
  componentBytes: value.componentBytes,
  metadataVersion: 1,
  rootVersion: 1,
  expires,
  roles: value.roles,
  consistentSnapshot: true
});

const resigned = (bytes, signers, change) => {
  const signed = change(JSON.parse(Buffer.from(bytes).toString("utf8")).signed);
  const payload = Buffer.from(canonicalize(signed), "utf8");
  return Buffer.from(
    JSON.stringify({
      signatures: signers.map((signer) => ({
        keyid: signer.keyId,
        sig: Buffer.from(signer.sign(payload)).toString("hex")
      })),
      signed
    }),
    "utf8"
  );
};

const refreshInput = (value, trustedRoot) => ({
  schemaVersion: 1,
  trustedRoot,
  targets: value.publication.metadata.get("1.targets.json"),
  components: value.publication.metadata.get("1.components.json"),
  versions: { snapshot: 2, timestamp: 2 },
  expires: { snapshot: value.expires.snapshot, timestamp: value.expires.timestamp },
  roles: {
    timestamp: { threshold: value.online.length, signers: value.online },
    snapshot: { threshold: value.online.length, signers: value.online }
  }
});

test("a publication refuses an expiry that matches the instant shape but names no date", () => {
  const value = fixture();
  for (const role of ["timestamp", "snapshot", "targets", "root"]) {
    assert.throws(
      () => buildTufReleasePublication(publicationInput(value, { ...value.expires, [role]: UNPARSEABLE })),
      {
        code: "VES_TUF_PUBLICATION_INPUT_INVALID",
        message: `${role} expires must be a future UTC instant`
      }
    );
  }
  assert.throws(
    () =>
      buildTufReleasePublication(publicationInput(value, { ...value.expires, timestamp: "2020-01-01T00:00:00.000Z" })),
    { code: "VES_TUF_PUBLICATION_INPUT_INVALID", message: "timestamp expires must be a future UTC instant" }
  );
  assert.ok(buildTufReleasePublication(publicationInput(value, value.expires)).trustedRoot.byteLength > 0);
});

test("a refresh refuses a published root whose expiry names no date or has passed", () => {
  const value = fixture();
  for (const expires of [UNPARSEABLE, "2020-01-01T00:00:00.000Z"]) {
    const trustedRoot = resigned(value.publication.trustedRoot, value.offline, (signed) => ({ ...signed, expires }));
    assert.throws(() => buildTufOnlineRoleRefresh(refreshInput(value, trustedRoot)), {
      code: "VES_TUF_PUBLICATION_REFRESH_UNVERIFIED",
      message: "published root has expired and needs an offline re-signing"
    });
  }
  const refresh = buildTufOnlineRoleRefresh(refreshInput(value, value.publication.trustedRoot));
  assert.ok(refresh.metadata.has("timestamp.json"));
});
