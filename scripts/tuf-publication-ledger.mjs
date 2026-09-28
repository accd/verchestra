// why: this is the committed, append-only record of every published TUF lineage
// (#387). Two releases published under one trust root with the same TUF metadata
// version collide in the update client's cache and cannot be updated over one
// another. The update client now names that collision (#391), but only a
// publisher can prevent it. This ledger is what the publish tooling checks a new
// `metadataVersion` against: it must strictly exceed every snapshot, targets,
// and timestamp version recorded for the same root digest.
//
// invariant: a fact not recorded anywhere in the repository is `null`, never a
// guess, and every rule below treats an unknown conservatively: an unknown root
// digest matches every root its recorded prefix admits, and an unknown role
// version on a matching entry makes monotonicity unprovable, so the publication
// is refused rather than waved through.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";

export const PUBLICATION_LEDGER_SCHEMA = "verchestra-tuf-publication-ledger/v1";

// invariant: the release workflow never overrides this path.
export const DEFAULT_PUBLICATION_LEDGER_PATH = fileURLToPath(
  new URL("../docs/qualification/tuf-publication-ledger.json", import.meta.url)
);

// invariant: a new publication signs exactly these roles at its metadataVersion.
export const MONOTONIC_ROLES = Object.freeze(["snapshot", "targets", "timestamp"]);

const RELEASE_ROLES = Object.freeze(["root", "snapshot", "targets", "timestamp"]);
const REFRESH_ROLES = Object.freeze(["snapshot", "timestamp"]);
const LEDGER_KEYS = Object.freeze(["schema", "policy", "entries"]);
const ENTRY_KEYS = Object.freeze([
  "sequence",
  "previousEntryDigest",
  "kind",
  "releaseId",
  "semanticVersion",
  "baseUrl",
  "urlPrefix",
  "rootDigest",
  "rootDigestPrefix",
  "roles",
  "publicationRunId",
  "evidence"
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const DIGEST_PREFIX = /^sha256:[a-f0-9]{8,63}$/u;
const URL_PREFIX = /^(?:[A-Za-z0-9._-]+\/)*$/u;
const RUN_ID = /^[0-9]{1,20}$/u;
const EVIDENCE_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;

export class PublicationLedgerError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "PublicationLedgerError";
    this.code = code;
  }
}

const invalid = (message, cause) => {
  throw new PublicationLedgerError(
    "VES_T76_PUBLISH_LEDGER_INVALID",
    `publication ledger ${message}`,
    cause === undefined ? undefined : { cause }
  );
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const exactKeys = (value, keys, label) => {
  if (!isRecord(value)) invalid(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    invalid(`${label} must carry exactly ${expected.join(", ")}`);
  return value;
};

const nullable = (value, pattern, label) => {
  if (value === null) return;
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${label} is invalid`);
};

const nonEmptyText = (value, label, maximum = 256) => {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) invalid(`${label} is invalid`);
};

const nullableText = (value, label) => {
  if (value !== null) nonEmptyText(value, label);
};

const nullableBaseUrl = (value, label) => {
  if (value === null) return;
  if (typeof value !== "string") invalid(`${label} is invalid`);
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    invalid(`${label} is not a URL`, error);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !value.endsWith("/"))
    invalid(`${label} must be a credential-free https base ending in a slash`);
};

// invariant: the next entry's previousEntryDigest must equal this digest.
export const ledgerEntryDigest = (entry) =>
  `sha256:${createHash("sha256").update(canonicalizeJsonV2(entry)).digest("hex")}`;

const validateRoles = (value, kind, label) => {
  if (!isRecord(value)) invalid(`${label} roles must be an object`);
  const keys = Object.keys(value);
  if (kind === "release") exactKeys(value, RELEASE_ROLES, `${label} roles`);
  else if (keys.length === 0 || keys.some((key) => !REFRESH_ROLES.includes(key)))
    invalid(`${label} roles of a role-refresh entry may name only snapshot and timestamp`);
  for (const [role, version] of Object.entries(value)) {
    if (version !== null && (!Number.isSafeInteger(version) || version <= 0))
      invalid(`${label} ${role} version must be a positive integer or null`);
  }
};

const validateRootIdentity = (entry, label) => {
  nullable(entry.rootDigest, DIGEST, `${label} rootDigest`);
  nullable(entry.rootDigestPrefix, DIGEST_PREFIX, `${label} rootDigestPrefix`);
  if (entry.rootDigest !== null && entry.rootDigestPrefix !== null)
    invalid(`${label} records a full rootDigest, so rootDigestPrefix must be null`);
};

const validateEvidence = (value, label) => {
  if (!Array.isArray(value) || value.length === 0) invalid(`${label} evidence must name at least one tracked file`);
  for (const path of value) {
    if (typeof path !== "string" || !EVIDENCE_PATH.test(path) || path.split("/").includes(".."))
      invalid(`${label} evidence path is invalid`);
  }
};

const validateEntry = (entry, index, previous) => {
  const label = `entry ${index + 1}`;
  exactKeys(entry, ENTRY_KEYS, label);
  if (entry.sequence !== index + 1) invalid(`${label} sequence must be ${index + 1}`);
  const expectedPrevious = previous === undefined ? null : ledgerEntryDigest(previous);
  if (entry.previousEntryDigest !== expectedPrevious)
    invalid(`${label} previousEntryDigest does not chain to the entry before it`);
  if (entry.kind !== "release" && entry.kind !== "role-refresh")
    invalid(`${label} kind must be release or role-refresh`);
  nullableText(entry.releaseId, `${label} releaseId`);
  nonEmptyText(entry.semanticVersion, `${label} semanticVersion`);
  nullableBaseUrl(entry.baseUrl, `${label} baseUrl`);
  nullable(entry.urlPrefix, URL_PREFIX, `${label} urlPrefix`);
  validateRootIdentity(entry, label);
  validateRoles(entry.roles, entry.kind, label);
  nullable(entry.publicationRunId, RUN_ID, `${label} publicationRunId`);
  validateEvidence(entry.evidence, label);
};

// invariant: sequence numbers are contiguous from 1 and every entry carries the
// canonical digest of the one before it, so editing or removing an earlier entry
// breaks every later link.
export function validatePublicationLedger(value) {
  const ledger = exactKeys(value, LEDGER_KEYS, "document");
  if (ledger.schema !== PUBLICATION_LEDGER_SCHEMA) invalid(`schema must be ${PUBLICATION_LEDGER_SCHEMA}`);
  nonEmptyText(ledger.policy, "policy", 2048);
  if (!Array.isArray(ledger.entries)) invalid("entries must be an array");
  ledger.entries.forEach((entry, index) => validateEntry(entry, index, ledger.entries[index - 1]));
  return ledger;
}

export async function readPublicationLedger(path = DEFAULT_PUBLICATION_LEDGER_PATH) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return invalid("cannot be read", error);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return invalid("is not JSON", error);
  }
  return validatePublicationLedger(parsed);
}

// invariant: a recorded full digest decides exactly; an unknown one matches every
// root its recorded prefix admits, and every root at all when no prefix exists.
export function entryMayShareRoot(entry, rootDigest) {
  if (entry.rootDigest !== null) return entry.rootDigest === rootDigest;
  return entry.rootDigestPrefix === null || rootDigest.startsWith(entry.rootDigestPrefix);
}

const refuse = (message) => {
  throw new PublicationLedgerError("VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC", message);
};

const assertEntryBound = (entry, metadataVersion) => {
  for (const role of MONOTONIC_ROLES) {
    if (!Object.hasOwn(entry.roles, role)) continue;
    const recorded = entry.roles[role];
    if (recorded === null)
      refuse(
        `ledger entry ${entry.sequence} (${entry.semanticVersion}) may share this root and records an unknown ${role} version, so a strictly greater metadataVersion cannot be proven`
      );
    if (metadataVersion <= recorded)
      refuse(
        `metadataVersion ${metadataVersion} must be strictly greater than the ${role} version ${recorded} ledger entry ${entry.sequence} (${entry.semanticVersion}) records for this root`
      );
  }
};

// invariant: entries for a different root are an independent lineage; every
// possibly-shared one bounds the new metadataVersion strictly from below.
export function assertMonotonicMetadataVersion(ledger, { rootDigest, metadataVersion }) {
  if (typeof rootDigest !== "string" || !DIGEST.test(rootDigest))
    refuse("the publication root digest is invalid, so its lineage cannot be checked");
  if (!Number.isSafeInteger(metadataVersion) || metadataVersion <= 0)
    refuse("metadataVersion must be a positive integer");
  for (const entry of ledger.entries) {
    if (entryMayShareRoot(entry, rootDigest)) assertEntryBound(entry, metadataVersion);
  }
}
