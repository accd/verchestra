// why: the T76 publisher (scripts/t76-publish-release.mjs) and the online
// timestamp/snapshot refresh (scripts/t76-refresh-timestamp.mjs, #382) hold the
// same signing custody: a role key read from the protected environment, bound to
// a reviewed anchor, and output bytes that are never overwritten. Those rules
// live here once, so the refresh depends on this module rather than on the whole
// publisher, and a change to a custody rule reaches both scripts.
//
// invariant: no decoded key byte, no base64 character of it, and no OpenSSL cause
// chain derived from it is ever written to stdout, stderr, an emitted file, or an
// error message. Key failures deliberately carry no `cause`.
//
// invariant: every refusal keeps its `VES_T76_PUBLISH_*` code; the release
// workflows, the custody rehearsal in docs/release-custody.md, and the tests
// match on them.

import { createHash, createPrivateKey, createPublicKey, sign as signBytes } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";

// invariant: the offline environment name that carries root and targets signing authority.
export const KEY_ENVIRONMENT_NAME = "VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64";

// invariant: the online environment name that carries timestamp and snapshot
// signing authority (#18, F1). A distinct, fast-rotating key so a compromise of
// the online key can neither swap the release nor rewrite the root.
export const TIMESTAMP_KEY_ENVIRONMENT_NAME = "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64";

// why: the fleet is a fact of the candidate, stated once in
// t76-candidate-evidence.mjs; the publisher and the refresh keep its binding here.
export { SUPPORTED_TARGET_KEYS } from "./t76-candidate-evidence.mjs";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

export class T76PublishError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "T76PublishError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new T76PublishError(code, message, cause === undefined ? undefined : { cause });
};

const record = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_T76_PUBLISH_INPUT_INVALID", `${label} must be an object`);
  return value;
};

// invariant: a key failure must never quote the value it rejected, and must
// never carry an OpenSSL `cause` that could echo decoded material into a log.
// Both rules are enforced here rather than at every call site.
const decodeProtectedPkcs8 = (environment, keyName) => {
  const encoded = record(environment ?? {}, "protected environment")[keyName];
  if (typeof encoded !== "string" || encoded.length === 0)
    fail("VES_T76_PUBLISH_SIGNING_KEY_MISSING", `${keyName} is not configured`);
  if (!BASE64.test(encoded) || encoded.length % 4 !== 0)
    fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "a release signing key is not base64 PKCS#8 material");
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength === 0)
    fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "a release signing key decodes to no PKCS#8 material");
  return decoded;
};

const privateKeyFrom = (der) => {
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    return fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "a release signing key is not a PKCS#8 private key");
  }
};

// invariant: derives a TUF signer from the protected environment. The returned
// object exposes a public key, a public key identity, and a signing callback;
// the private key stays inside this closure and is never serialized. `keyName`
// selects which protected variable holds it — the offline root/targets key by
// default, or the online timestamp/snapshot key (#18, F1).
export function releaseSignerFromEnvironment(environment, keyName = KEY_ENVIRONMENT_NAME) {
  const privateKey = privateKeyFrom(decodeProtectedPkcs8(environment, keyName));
  if (privateKey.asymmetricKeyType !== "ed25519")
    fail("VES_T76_PUBLISH_SIGNING_KEY_INVALID", "a release signing key is not an Ed25519 key");
  const publicKey = createPublicKey(privateKey);
  return Object.freeze({
    keyId: createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex"),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    sign: (payload) => signBytes(null, payload, privateKey)
  });
}

// why: the committed public half a human actually reviews. Binding the signing
// key to it is what stops the anchor from being a declaration nothing checks:
// before #18/F3 it was referenced only by a separation test and tied to nothing
// that signs or verifies, so the trust chain bottomed out in npm tarball
// integrity rather than the reviewed key. The default is that reviewed file; a
// caller may point at a different anchor for testing, and neither command line
// does in a release workflow, so a live signature is always bound to the
// reviewed key. The comparison is over public key material only — nothing
// secret is read, logged, or emitted.
//
// hazard: both defaults resolve relative to this file, so this module must stay
// in scripts/.
export const DEFAULT_RELEASE_ANCHOR = new URL(
  "../docs/qualification/trust/verchestra-release-public-key.json",
  import.meta.url
);

// why: the reviewed public half of the online timestamp/snapshot key (#18, F1).
export const DEFAULT_TIMESTAMP_ANCHOR = new URL(
  "../docs/qualification/trust/release-timestamp-snapshot-public-key.json",
  import.meta.url
);

// invariant: the only authority each committed anchor may admit (#18, F1). The
// publisher and the #382 refresh both name the one their role needs.
export const RELEASE_ANCHOR_PURPOSE = "tuf-release-root";
export const TIMESTAMP_ANCHOR_PURPOSE = "tuf-timestamp-snapshot";

const anchorKeyIdOf = (ref, purpose) => {
  const decoded = record(ref, "release anchor");
  // invariant: a retired anchor (#408) carries the instant it stopped being valid.
  // It stays committed under docs/qualification/trust/retired/ so what it signed
  // before then stays auditable, but no role ever admits it for a new signature,
  // whatever path a caller points at.
  if (Object.hasOwn(decoded, "validUntil"))
    fail("VES_T76_PUBLISH_ANCHOR_RETIRED", "the signing anchor is retired and admits no new signature");
  // why: an anchor reviewed for a different authority is refused even when its
  // key would verify.
  if (
    purpose !== undefined &&
    (!Array.isArray(decoded.purposes) || decoded.purposes.length !== 1 || decoded.purposes[0] !== purpose)
  )
    fail("VES_T76_PUBLISH_ANCHOR_INVALID", `the signing anchor is not reviewed for ${purpose}`);
  const material = (() => {
    if (decoded.encoding === "spki-pem" && typeof decoded.publicKey === "string") return decoded.publicKey;
    if (decoded.encoding === "spki-der-base64url" && typeof decoded.publicKey === "string")
      return { key: Buffer.from(decoded.publicKey, "base64url"), format: "der", type: "spki" };
    return fail("VES_T76_PUBLISH_ANCHOR_INVALID", "the release anchor is not an spki public key reference");
  })();
  let publicKey;
  try {
    publicKey = createPublicKey(material);
  } catch (error) {
    return fail("VES_T76_PUBLISH_ANCHOR_INVALID", "the release anchor is not a usable public key", error);
  }
  if (publicKey.asymmetricKeyType !== "ed25519")
    fail("VES_T76_PUBLISH_ANCHOR_INVALID", "the release anchor is not an Ed25519 public key");
  return createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
};

// invariant: resolves the TUF keyId the emitted metadata must carry from a
// reviewed anchor. A missing or malformed anchor fails closed before any output
// byte.
export const expectedAnchorKeyId = async (anchorPath, defaultAnchor, purpose) => {
  let raw;
  try {
    raw = await readFile(anchorPath ?? defaultAnchor, "utf8");
  } catch (error) {
    return fail("VES_T76_PUBLISH_ANCHOR_MISSING", "a reviewed signing anchor cannot be read", error);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail("VES_T76_PUBLISH_ANCHOR_INVALID", "a reviewed signing anchor is not JSON", error);
  }
  return anchorKeyIdOf(parsed, purpose);
};

// why: both scripts refuse to overwrite any output byte the same way.
export const writeExclusive = async (path, bytes, label) => {
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    fail("VES_T76_PUBLISH_OUTPUT_EXISTS", `unable to write ${label}`, error);
  }
};

export const assertOutputAbsent = async (path, subject = "publication") => {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail("VES_T76_PUBLISH_INPUT_INVALID", `the ${subject} output cannot be inspected`, error);
    return;
  }
  fail("VES_T76_PUBLISH_OUTPUT_EXISTS", `the ${subject} output already exists`);
};
