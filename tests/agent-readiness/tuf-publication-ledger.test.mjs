import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_PUBLICATION_LEDGER_PATH,
  PUBLICATION_LEDGER_SCHEMA,
  assertMonotonicMetadataVersion,
  entryMayShareRoot,
  ledgerEntryDigest,
  readPublicationLedger,
  validatePublicationLedger
} from "../../scripts/tuf-publication-ledger.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER = "docs/qualification/tuf-publication-ledger.json";
const RECORDED_ROOT_PREFIX = "sha256:491673b9";

const committed = () => JSON.parse(readFileSync(join(ROOT, LEDGER), "utf8"));
const text = (path) => readFileSync(join(ROOT, path), "utf8");
const rootWithPrefix = (prefix, fill) => `${prefix}${fill.repeat(64 - (prefix.length - "sha256:".length))}`;

const refused = (ledger, input, pattern) =>
  assert.throws(
    () => assertMonotonicMetadataVersion(ledger, input),
    (error) => {
      assert.equal(error.code, "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC");
      assert.match(error.message, pattern);
      return true;
    }
  );

test("the committed ledger is the default the publish tooling reads, and it validates", async () => {
  assert.equal(DEFAULT_PUBLICATION_LEDGER_PATH, join(ROOT, LEDGER));
  const ledger = await readPublicationLedger();
  assert.equal(ledger.schema, PUBLICATION_LEDGER_SCHEMA);
  assert.match(ledger.policy, /^Append-only\./u);
  assert.ok(ledger.entries.length >= 2);
});

test("the seed entries record exactly the published facts on record, and nothing guessed", () => {
  const [first, second] = committed().entries;
  assert.deepEqual(
    {
      semanticVersion: first.semanticVersion,
      releaseId: first.releaseId,
      baseUrl: first.baseUrl,
      urlPrefix: first.urlPrefix,
      publicationRunId: first.publicationRunId,
      rootDigest: first.rootDigest,
      rootDigestPrefix: first.rootDigestPrefix,
      roles: first.roles
    },
    {
      semanticVersion: "0.0.0-qualification",
      releaseId: "release:verchestra:0.0.0-qualification:a49f3dd5aa3e",
      baseUrl: "https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/",
      urlPrefix: "",
      publicationRunId: "32929312169",
      // The full digest is not recorded in the repository, only its prefix.
      rootDigest: null,
      rootDigestPrefix: RECORDED_ROOT_PREFIX,
      // The root version is not recorded either; the metadata version is 1.
      roles: { root: null, snapshot: 1, targets: 1, timestamp: 1 }
    }
  );
  assert.deepEqual(
    {
      semanticVersion: second.semanticVersion,
      releaseId: second.releaseId,
      baseUrl: second.baseUrl,
      urlPrefix: second.urlPrefix,
      publicationRunId: second.publicationRunId,
      rootDigest: second.rootDigest,
      rootDigestPrefix: second.rootDigestPrefix,
      roles: second.roles
    },
    {
      semanticVersion: "0.0.0-qualification.2",
      releaseId: null,
      baseUrl: null,
      urlPrefix: "v2/",
      publicationRunId: null,
      rootDigest: null,
      rootDigestPrefix: RECORDED_ROOT_PREFIX,
      roles: { root: null, snapshot: 1, targets: 1, timestamp: 1 }
    }
  );
});

test("every seed fact is backed by the tracked evidence the entry cites", () => {
  const [first, second] = committed().entries;
  for (const entry of committed().entries) {
    for (const path of entry.evidence) assert.equal(existsSync(join(ROOT, path)), true, `${path} must exist`);
  }
  const t76 = text("docs/qualification/t76-validation.md");
  assert.ok(first.evidence.includes("docs/qualification/t76-validation.md"));
  assert.match(t76, new RegExp(`\`${first.baseUrl.replaceAll(".", "\\.")}\`, \`metadata_version\` 1`, "u"));
  assert.match(t76, /Publication run \*\*32929312169\*\*/u);
  assert.match(t76, /`release:verchestra:0\.0\.0-qualification:a49f3dd5aa3e`/u);
  const matrix = text(".specs/features/live-activation-matrix/validation.md");
  for (const entry of [first, second])
    assert.ok(entry.evidence.includes(".specs/features/live-activation-matrix/validation.md"));
  assert.match(matrix, /`metadataVersion = 1`; both pin the byte-identical root digest\s+`sha256:491673b9…`/u);
  assert.match(matrix, /…\/v2\/<target>\/metadata\//u);
});

test("entries are hash-chained, so rewriting a recorded entry is detected", () => {
  const ledger = committed();
  ledger.entries.forEach((entry, index) => {
    assert.equal(entry.sequence, index + 1);
    assert.equal(entry.previousEntryDigest, index === 0 ? null : ledgerEntryDigest(ledger.entries[index - 1]));
  });
  const tampered = committed();
  tampered.entries[0].roles.snapshot = 7;
  assert.throws(() => validatePublicationLedger(tampered), { code: "VES_T76_PUBLISH_LEDGER_INVALID" });
  const removed = committed();
  removed.entries.shift();
  assert.throws(() => validatePublicationLedger(removed), { code: "VES_T76_PUBLISH_LEDGER_INVALID" });
});

test("every committed revision of the ledger is a prefix of the current one (append-only)", () => {
  const current = committed().entries;
  const revisions = execFileSync("git", ["log", "--format=%H", "--", LEDGER], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const revision of revisions) {
    const earlier = JSON.parse(
      execFileSync("git", ["show", `${revision}:${LEDGER}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 })
    ).entries;
    assert.ok(earlier.length <= current.length, `${revision} must not have more entries than today`);
    assert.deepEqual(current.slice(0, earlier.length), earlier, `${revision} entries must be unchanged`);
  }
});

test("a role-only refresh entry fits the ledger, and may name only timestamp and snapshot (#382)", () => {
  const ledger = committed();
  const previous = ledger.entries.at(-1);
  const refresh = {
    ...previous,
    sequence: previous.sequence + 1,
    previousEntryDigest: ledgerEntryDigest(previous),
    kind: "role-refresh",
    roles: { snapshot: 2, timestamp: 2 }
  };
  assert.doesNotThrow(() => validatePublicationLedger({ ...ledger, entries: [...ledger.entries, refresh] }));
  for (const roles of [{ targets: 2, timestamp: 2 }, { root: 2 }, {}]) {
    assert.throws(() => validatePublicationLedger({ ...ledger, entries: [...ledger.entries, { ...refresh, roles }] }), {
      code: "VES_T76_PUBLISH_LEDGER_INVALID"
    });
  }
});

test("an unknown root digest matches conservatively: by recorded prefix, else every root", () => {
  const entry = { rootDigest: null, rootDigestPrefix: RECORDED_ROOT_PREFIX };
  assert.equal(entryMayShareRoot(entry, rootWithPrefix(RECORDED_ROOT_PREFIX, "a")), true);
  assert.equal(entryMayShareRoot(entry, rootWithPrefix("sha256:00000000", "a")), false);
  assert.equal(entryMayShareRoot({ rootDigest: null, rootDigestPrefix: null }, rootWithPrefix("sha256:", "b")), true);
  const known = rootWithPrefix("sha256:", "c");
  assert.equal(entryMayShareRoot({ rootDigest: known, rootDigestPrefix: null }, known), true);
  assert.equal(entryMayShareRoot({ rootDigest: known, rootDigestPrefix: null }, rootWithPrefix("sha256:", "d")), false);
});

test("the committed ledger binds the recorded lineage and leaves a new root independent", () => {
  const ledger = committed();
  const recordedLineage = rootWithPrefix(RECORDED_ROOT_PREFIX, "e");
  refused(ledger, { rootDigest: recordedLineage, metadataVersion: 1 }, /strictly greater than the snapshot version 1/u);
  assert.doesNotThrow(() =>
    assertMonotonicMetadataVersion(ledger, { rootDigest: recordedLineage, metadataVersion: 2 })
  );
  // A role-separated root (the .3 lineage) is a fresh trust anchor.
  assert.doesNotThrow(() =>
    assertMonotonicMetadataVersion(ledger, { rootDigest: rootWithPrefix("sha256:00000000", "f"), metadataVersion: 1 })
  );
});

test("an unknown role version on a possibly shared root makes monotonicity unprovable", () => {
  const ledger = committed();
  const [first] = ledger.entries;
  const unknown = { ...first, roles: { ...first.roles, timestamp: null } };
  const withUnknown = validatePublicationLedger({ ...ledger, entries: [unknown] });
  refused(
    withUnknown,
    { rootDigest: rootWithPrefix(RECORDED_ROOT_PREFIX, "a"), metadataVersion: 50 },
    /unknown timestamp version/u
  );
});
