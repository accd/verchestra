import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify
} from "node:crypto";
import { canonicalize } from "@tufjs/canonical-json";

function failure(code, message, fields = {}) {
  return Object.assign(new Error(message), { code, ...fields });
}

const canonical = (value) => Buffer.from(canonicalize(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export class OpaqueKeyStore {
  #signing = new Map();
  #recipients = new Map();

  createSigningKey(id) {
    if (this.#signing.has(id)) throw failure("VES_KEY_EXISTS", "signing key already exists");
    this.#signing.set(id, generateKeyPairSync("ed25519"));
  }

  createRecipientKey(id) {
    if (this.#recipients.has(id)) throw failure("VES_KEY_EXISTS", "recipient key already exists");
    this.#recipients.set(id, generateKeyPairSync("x25519"));
  }

  sign(id, value) {
    const pair = this.#signing.get(id);
    if (!pair) throw failure("VES_KEY_NOT_FOUND", "signing key not found");
    return sign(null, canonical(value), pair.privateKey).toString("base64");
  }

  publicSigningKey(id) {
    const pair = this.#signing.get(id);
    if (!pair) throw failure("VES_KEY_NOT_FOUND", "signing key not found");
    return pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  }

  publicRecipient(id) {
    const pair = this.#recipients.get(id);
    if (!pair) throw failure("VES_KEY_NOT_FOUND", "recipient key not found");
    return { id, publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString() };
  }

  unwrap(id, wrapped, aad) {
    const pair = this.#recipients.get(id);
    if (!pair) throw failure("VES_RECIPIENT_NOT_AUTHORIZED", "recipient key is unavailable");
    const shared = diffieHellman({ privateKey: pair.privateKey, publicKey: createPublicKey(wrapped.ephemeralPublicKey) });
    const wrappingKey = Buffer.from(hkdfSync("sha256", shared, Buffer.from(wrapped.salt, "base64"), Buffer.from("verchestra-recipient-wrap/1"), 32));
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(wrapped.nonce, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(wrapped.wrappedKey, "base64")), decipher.final()]);
  }

  exportPrivateKey() {
    throw failure("VES_PRIVATE_KEY_NON_EXPORTABLE", "private keys cannot be exported through this adapter");
  }

  describe() {
    return { signingKeyIds: [...this.#signing.keys()].sort(), recipientKeyIds: [...this.#recipients.keys()].sort(), privateExport: false };
  }

  static verify(publicKey, value, signature) {
    return verify(null, canonical(value), createPublicKey(publicKey), Buffer.from(signature, "base64"));
  }
}

const KEY_STORE_CONTROLS = Object.freeze({
  win32: { adapter: "windows-cng", controls: ["cng-ksp", "non-exportable", "user-scope", "access-control"] },
  darwin: { adapter: "apple-keychain", controls: ["keychain", "non-exportable", "user-scope", "access-control"] },
  linux: { adapter: "secret-service", controls: ["secret-service", "locked-collection", "user-scope", "access-control"] }
});

export function qualifyPlatformKeyStore({ platform, evidence }) {
  const contract = KEY_STORE_CONTROLS[platform];
  if (!contract) throw failure("VES_PLATFORM_UNSUPPORTED", "platform key-store contract is unavailable");
  if (!evidence) return { platform, available: false, adapter: null };
  const complete = /^[a-f0-9]{64}$/.test(evidence.digest ?? "") && contract.controls.every((control) => evidence.controls?.includes(control));
  if (!complete) throw failure("VES_KEY_STORE_UNQUALIFIED", "platform key-store evidence is incomplete");
  return { platform, available: true, adapter: contract.adapter, evidenceDigest: evidence.digest };
}

const PROHIBITED_MANIFEST_FIELDS = ["credentialValue", "machineAuthentication", "environmentValues", "rawRows", "connectionString"];

function validateManifest(manifest) {
  if (!Array.isArray(manifest.inclusion) || !Array.isArray(manifest.exclusion) || typeof manifest.expiresAt !== "string") {
    throw failure("VES_BUNDLE_MANIFEST_INVALID", "bundle manifest requires explicit inclusion, exclusion, and expiry");
  }
  for (const field of PROHIBITED_MANIFEST_FIELDS) {
    if (Object.hasOwn(manifest, field)) throw failure("VES_BUNDLE_PROHIBITED_CONTENT", `bundle manifest contains prohibited field: ${field}`);
  }
}

function encrypt(key, plaintext, aad) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function sealRecipientEnvelope({ plaintext, manifest, recipients, signer, signingKeyId }) {
  validateManifest(manifest);
  if (!Array.isArray(recipients) || recipients.length === 0) throw failure("VES_RECIPIENT_REQUIRED", "at least one recipient is required");
  const aad = canonical(manifest);
  const contentKey = randomBytes(32);
  const payload = encrypt(contentKey, Buffer.from(plaintext), aad);
  const wrappedRecipients = recipients.map((recipient) => {
    const ephemeral = generateKeyPairSync("x25519");
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey(recipient.publicKey) });
    const salt = randomBytes(16);
    const wrappingKey = Buffer.from(hkdfSync("sha256", shared, salt, Buffer.from("verchestra-recipient-wrap/1"), 32));
    const wrapped = encrypt(wrappingKey, contentKey, aad);
    return {
      id: recipient.id,
      ephemeralPublicKey: ephemeral.publicKey.export({ format: "pem", type: "spki" }).toString(),
      salt: salt.toString("base64"),
      nonce: wrapped.nonce,
      wrappedKey: wrapped.ciphertext,
      tag: wrapped.tag
    };
  });
  const signed = { version: "verchestra-recipient-envelope/1", manifest, payload, recipients: wrappedRecipients };
  return { ...signed, signingPublicKey: signer.publicSigningKey(signingKeyId), signature: signer.sign(signingKeyId, signed) };
}

export function verifyAndOpenRecipientEnvelope({ bundle, recipientStore, recipientId, now = new Date() }) {
  const { signature, signingPublicKey, ...signed } = bundle;
  if (!OpaqueKeyStore.verify(signingPublicKey, signed, signature)) throw failure("VES_BUNDLE_SIGNATURE_INVALID", "bundle signature is invalid");
  validateManifest(bundle.manifest);
  if (Date.parse(bundle.manifest.expiresAt) <= now.getTime()) throw failure("VES_BUNDLE_EXPIRED", "bundle has expired");
  const wrapped = bundle.recipients.find((entry) => entry.id === recipientId);
  if (!wrapped) throw failure("VES_RECIPIENT_NOT_AUTHORIZED", "recipient is not listed in the envelope");
  const aad = canonical(bundle.manifest);
  let contentKey;
  try {
    contentKey = recipientStore.unwrap(recipientId, wrapped, aad);
    const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(bundle.payload.nonce, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(bundle.payload.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(bundle.payload.ciphertext, "base64")), decipher.final()]);
  } catch (error) {
    if (error.code?.startsWith("VES_")) throw error;
    throw failure("VES_BUNDLE_DECRYPT_FAILED", "recipient envelope authentication failed", { cause: error });
  }
}

export function planSupportBundle(diagnostics, allowlist) {
  const prohibited = new Set(["source", "prompt", "context", "credentials", "environmentValues", "rawRows", "rawProbeOutput", "transcript", "rawStateDatabase", "logs"]);
  const fields = Object.fromEntries(Object.keys(diagnostics).filter((key) => allowlist.includes(key) && !prohibited.has(key)).sort().map((key) => [key, diagnostics[key]]));
  const excluded = Object.keys(diagnostics).filter((key) => !allowlist.includes(key) || prohibited.has(key)).sort();
  const digest = sha256(canonical({ fields, excluded }));
  return { fields, excluded, digest, autoUpload: false };
}

export function inspectSupportBundle(plan) {
  return {
    digest: plan.digest,
    includedFields: Object.keys(plan.fields).sort(),
    excludedFields: [...plan.excluded].sort(),
    redactionSummary: { prohibitedCollected: 0 },
    autoUpload: false
  };
}

export function authorizeSupportExport(plan, { approvedDigest, egress }) {
  if (approvedDigest !== plan.digest) throw failure("VES_SUPPORT_APPROVAL_REQUIRED", "state-bound Support Bundle Approval is required");
  if (egress !== "allow") throw failure("VES_SUPPORT_EGRESS_DENIED", "Data Egress policy denied Support Bundle export");
  return { authorized: true, digest: plan.digest, uploadPerformed: false };
}
