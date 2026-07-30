// Policies govern authority, so the set in force must itself be verifiable: a
// versioned bundle whose digest is deterministic and whose signature comes
// from the trust boundary. Signing is injected as a port because the policy
// package is an adapter and cannot import the evidence adapter; the
// composition root wires the two, exactly as it does for artifact sealing.

export type PolicyBundleErrorCode = "VES_POLICY_BUNDLE_INVALID";

export class PolicyBundleError extends Error {
  readonly code: PolicyBundleErrorCode;

  constructor(code: PolicyBundleErrorCode, message: string) {
    super(message);
    this.name = "PolicyBundleError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new PolicyBundleError("VES_POLICY_BUNDLE_INVALID", message);
}

export interface PolicyBundleEntry {
  readonly id: string;
  readonly cedar: string;
  readonly sourceDigest: string;
}

export interface PolicyBundle {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly policies: readonly PolicyBundleEntry[];
  readonly createdAt: string;
  readonly bundleDigest: string;
}

export interface SignedPolicyBundle extends PolicyBundle {
  readonly signature: string;
  readonly publicKeyRef: string;
}

export interface PolicyBundleCrypto {
  sha256(value: string): string;
  sign(digestValue: string): { readonly signature: string; readonly publicKeyRef: string };
  verify(digestValue: string, signature: string, publicKeyRef: string): boolean;
}

const SAFE = /^[\x21-\x7e]{1,240}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function normalizeEntries(value: unknown, sha256: (value: string) => string): readonly PolicyBundleEntry[] {
  if (!Array.isArray(value) || value.length === 0) fail("a bundle needs at least one policy");
  const ids = new Set<string>();
  const entries = value.map((entryValue) => {
    if (entryValue === null || typeof entryValue !== "object") fail("bundle policy must be an object");
    const entry = entryValue as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["id", "cedar"].includes(key))) fail("bundle policy has unknown fields");
    if (typeof entry["id"] !== "string" || !SAFE.test(entry["id"])) fail("bundle policy id is invalid");
    if (typeof entry["cedar"] !== "string" || entry["cedar"].length === 0 || entry["cedar"].length > 65_536)
      fail(`policy ${entry["id"]} source is empty or unbounded`);
    if (ids.has(entry["id"])) fail(`duplicate policy id: ${entry["id"]}`);
    ids.add(entry["id"]);
    return Object.freeze({
      id: entry["id"],
      cedar: entry["cedar"],
      sourceDigest: `sha256:${sha256(entry["cedar"])}`
    });
  });
  // Order-independence: two bundles with the same policies are the same bundle.
  return Object.freeze([...entries].sort((left, right) => left.id.localeCompare(right.id)));
}

export function buildPolicyBundle(
  input: { readonly version: string; readonly policies: readonly unknown[]; readonly createdAt: string },
  crypto: PolicyBundleCrypto
): SignedPolicyBundle {
  if (typeof input.version !== "string" || !VERSION.test(input.version)) fail("bundle version must be semver");
  if (
    typeof input.createdAt !== "string" ||
    !Number.isFinite(Date.parse(input.createdAt)) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  )
    fail("bundle createdAt must be an ISO-8601 UTC instant");
  const policies = normalizeEntries(input.policies, crypto.sha256);
  const bundleDigest = `sha256:${crypto.sha256(
    canonical({ schemaVersion: 1, version: input.version, policies, createdAt: input.createdAt })
  )}`;
  const signed = crypto.sign(bundleDigest);
  if (typeof signed.signature !== "string" || signed.signature.length === 0 || !SAFE.test(signed.publicKeyRef))
    fail("bundle signature is invalid");
  return Object.freeze({
    schemaVersion: 1,
    version: input.version,
    policies,
    createdAt: input.createdAt,
    bundleDigest,
    signature: signed.signature,
    publicKeyRef: signed.publicKeyRef
  });
}

export function verifyPolicyBundle(value: unknown, crypto: PolicyBundleCrypto): PolicyBundle {
  if (value === null || typeof value !== "object") fail("bundle must be an object");
  const bundle = value as Record<string, unknown>;
  const allowed = ["schemaVersion", "version", "policies", "createdAt", "bundleDigest", "signature", "publicKeyRef"];
  if (Object.keys(bundle).some((key) => !allowed.includes(key))) fail("bundle has unknown fields");
  if (bundle["schemaVersion"] !== 1) fail("bundle schema version is unsupported");
  if (typeof bundle["version"] !== "string" || !VERSION.test(bundle["version"])) fail("bundle version is invalid");
  if (typeof bundle["bundleDigest"] !== "string" || !DIGEST.test(bundle["bundleDigest"]))
    fail("bundle digest is invalid");

  // Recompute everything from the sources: a bundle whose recorded digests do
  // not reproduce is tampered, whatever its signature says.
  const policies = normalizeEntries(
    (
      bundle["policies"] as readonly {
        readonly id: unknown;
        readonly cedar: unknown;
        readonly sourceDigest?: unknown;
      }[]
    )?.map?.((entry) => ({ id: entry?.id, cedar: entry?.cedar })),
    crypto.sha256
  );
  const declared = bundle["policies"] as readonly { readonly sourceDigest?: unknown }[];
  for (const [index, entry] of policies.entries()) {
    if (declared[index]?.sourceDigest !== entry.sourceDigest)
      fail(`policy ${entry.id} source does not match its recorded digest`);
  }
  if (
    typeof bundle["createdAt"] !== "string" ||
    !Number.isFinite(Date.parse(bundle["createdAt"])) ||
    new Date(bundle["createdAt"]).toISOString() !== bundle["createdAt"]
  )
    fail("bundle createdAt is invalid");
  const recomputed = `sha256:${crypto.sha256(
    canonical({ schemaVersion: 1, version: bundle["version"], policies, createdAt: bundle["createdAt"] })
  )}`;
  if (recomputed !== bundle["bundleDigest"]) fail("bundle digest does not reproduce from its contents");
  if (
    typeof bundle["signature"] !== "string" ||
    typeof bundle["publicKeyRef"] !== "string" ||
    !crypto.verify(bundle["bundleDigest"], bundle["signature"], bundle["publicKeyRef"])
  )
    fail("bundle signature does not verify");
  return Object.freeze({
    schemaVersion: 1,
    version: bundle["version"],
    policies,
    createdAt: bundle["createdAt"],
    bundleDigest: bundle["bundleDigest"]
  });
}
