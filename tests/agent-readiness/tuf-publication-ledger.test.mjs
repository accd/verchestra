import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_PUBLICATION_LEDGER_PATH,
  PUBLICATION_LEDGER_SCHEMA,
  admitRelease,
  assertLedgerPrefix,
  assertMonotonicMetadataVersion,
  assertRefreshAdmitted,
  entryMayShareRoot,
  ledgerEntryDigest,
  nextLedgerEntry,
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

const withRefresh = (ledger, roles = { snapshot: 2, timestamp: 2 }) => {
  const [first] = ledger.entries;
  const entry = nextLedgerEntry(ledger, { ...first, kind: "role-refresh", roles });
  return { ...ledger, entries: [...ledger.entries, entry] };
};

test("a checked-out ledger must be an unedited prefix of main's", () => {
  const main = withRefresh(committed());
  assert.doesNotThrow(() => assertLedgerPrefix(committed(), main));
  assert.doesNotThrow(() => assertLedgerPrefix(main, main));
  assert.doesNotThrow(() => assertLedgerPrefix({ ...main, entries: [] }, main));
  const diverged = (candidate, target = main) =>
    assert.throws(() => assertLedgerPrefix(candidate, target), { code: "VES_T76_PUBLISH_LEDGER_DIVERGED" });
  // why: a candidate that knows more than main, or that rewrote a shared entry.
  diverged(main, committed());
  const rewritten = committed();
  rewritten.entries[1] = { ...rewritten.entries[1], publicationRunId: "1" };
  diverged(rewritten);
  diverged({ ...committed(), schema: "verchestra-tuf-publication-ledger/v0" });
});

test("the assert-prefix command line fails closed on a diverged ledger", () => {
  const directory = mkdtempSync(join(tmpdir(), "verchestra-ledger-prefix-"));
  try {
    const mainPath = join(directory, "main.json");
    const candidatePath = join(directory, "candidate.json");
    writeFileSync(mainPath, JSON.stringify(withRefresh(committed())));
    const run = () =>
      spawnSync(process.execPath, ["scripts/tuf-publication-ledger.mjs", "assert-prefix", candidatePath, mainPath], {
        cwd: ROOT,
        encoding: "utf8"
      });
    writeFileSync(candidatePath, JSON.stringify(committed()));
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stderr);
    const recorded = committed().entries.length;
    assert.equal(accepted.stdout, `ledger prefix verified: ${recorded} of ${recorded + 1} entries on main\n`);
    const ahead = withRefresh(withRefresh(committed()), { snapshot: 3, timestamp: 3 });
    writeFileSync(candidatePath, JSON.stringify(ahead));
    const refusedRun = run();
    assert.notEqual(refusedRun.status, 0);
    assert.match(refusedRun.stderr, /VES_T76_PUBLISH_LEDGER_DIVERGED/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a refresh is admitted only for a recorded lineage, above every version, over its newest targets", () => {
  const ledger = committed();
  const recordedLineage = rootWithPrefix(RECORDED_ROOT_PREFIX, "a");
  assert.doesNotThrow(() =>
    assertRefreshAdmitted(ledger, { rootDigest: recordedLineage, metadataVersion: 2, targetsVersion: 1 })
  );
  assert.throws(
    () => assertRefreshAdmitted(ledger, { rootDigest: recordedLineage, metadataVersion: 1, targetsVersion: 1 }),
    { code: "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC" }
  );
  // why: a recorded refresh raises the bar for the next one.
  assert.throws(
    () =>
      assertRefreshAdmitted(withRefresh(ledger), {
        rootDigest: recordedLineage,
        metadataVersion: 2,
        targetsVersion: 1
      }),
    { code: "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC" }
  );
  assert.throws(
    () =>
      assertRefreshAdmitted(ledger, {
        rootDigest: rootWithPrefix("sha256:00000000", "b"),
        metadataVersion: 2,
        targetsVersion: 1
      }),
    { code: "VES_T76_REFRESH_LINEAGE_UNKNOWN" }
  );
  // why: re-signing anything but the newest recorded targets would roll fresh clients back.
  assert.throws(
    () => assertRefreshAdmitted(ledger, { rootDigest: recordedLineage, metadataVersion: 3, targetsVersion: 2 }),
    { code: "VES_T76_REFRESH_TARGETS_CHANGED" }
  );
});

// why: everything below covers the release admission: the ledger module derives
// the entry a publication appends (ADP-7).

const MATRIX = ".specs/features/live-activation-matrix/validation.md";
const RUNBOOK = ".specs/features/tuf-role-separation/republish-v3-runbook.md";
const ROLE_SEPARATED_ROOT = "sha256:949fbce3c56f7a10729750d3d18dc54537eb32f2701aae7eb8370ff06e5dcff7";

// invariant: what each publication stated when it was signed, as the tracked
// record holds it: the release identity, the base URL it is served from (with
// its prefix), the pinned root and its version, the metadata version, the
// signing run, and the evidence the entry cites. `sequence` is not an input: it
// is the position of the committed entry the derivation must reproduce.
const RECORDED_RELEASES = Object.freeze([
  Object.freeze({
    sequence: 3,
    inputs: Object.freeze({
      releaseId: "release:verchestra:0.0.0-qualification.3:6725554a8e14",
      semanticVersion: "0.0.0-qualification.3",
      baseUrl: "https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v3/",
      rootDigest: ROLE_SEPARATED_ROOT,
      rootVersion: 1,
      metadataVersion: 2,
      publicationRunId: "36785647398",
      evidence: Object.freeze([MATRIX, RUNBOOK])
    })
  }),
  Object.freeze({
    sequence: 4,
    inputs: Object.freeze({
      releaseId: "release:verchestra:0.0.0-qualification.4:d58a25f3d80a",
      semanticVersion: "0.0.0-qualification.4",
      baseUrl: "https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v4/",
      rootDigest: ROLE_SEPARATED_ROOT,
      rootVersion: 1,
      metadataVersion: 3,
      publicationRunId: "36930995598",
      evidence: Object.freeze([MATRIX, RUNBOOK])
    })
  })
]);

const prefixBefore = (ledger, sequence) => ({ ...ledger, entries: ledger.entries.slice(0, sequence - 1) });
const reviewed = (entry) => JSON.stringify(entry, null, 2);
// why: an entry sits in the committed file as a member of `entries`, four spaces in.
const asCommitted = (entry) =>
  reviewed(entry)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

const invalidRelease = (ledger, release, pattern) =>
  assert.throws(
    () => admitRelease(ledger, release),
    (error) => {
      assert.equal(error.code, "VES_T76_PUBLISH_LEDGER_INVALID");
      assert.match(error.message, pattern);
      return true;
    }
  );

const SAMPLE_RELEASE = Object.freeze({
  releaseId: "release:verchestra:9.9.9:sample",
  semanticVersion: "9.9.9",
  baseUrl: "https://releases.example.invalid/",
  rootDigest: rootWithPrefix("sha256:00000000", "a"),
  rootVersion: 1,
  metadataVersion: 1,
  publicationRunId: "4242",
  evidence: Object.freeze([LEDGER])
});

test("the recorded inputs of .3 and .4 are the ones the tracked publication record states", () => {
  const matrix = text(MATRIX);
  for (const { inputs: release } of RECORDED_RELEASES) {
    // why: one heading reads "Publication of", the other "TUF publication of".
    const heading = `ublication of \`${release.semanticVersion}\``;
    const start = matrix.indexOf(heading);
    assert.ok(start >= 0, `${release.semanticVersion} has a publication record`);
    const next = matrix.indexOf("\n## ", start);
    const section = matrix.slice(start, next < 0 ? matrix.length : next);
    assert.ok(section.includes(`| run \`${release.publicationRunId}\`, from \`main\``), "signing run");
    assert.ok(section.includes(`| \`${release.releaseId}\``), "release id");
    assert.ok(section.includes(`| \`${release.rootDigest}\``), "root digest");
    assert.ok(section.includes(`| \`${release.metadataVersion}\` for targets, snapshot and timestamp`), "versions");
    assert.ok(section.includes(`| \`${release.baseUrl}\``), "base URL with its prefix");
    for (const path of release.evidence) assert.equal(existsSync(join(ROOT, path)), true, `${path} must exist`);
  }
  // why: .4 is recorded as the same root as .3, whose record states root version 1.
  assert.match(matrix, new RegExp(`\`${ROLE_SEPARATED_ROOT}\` \\(root version 1\\)`, "u"));
  assert.match(matrix, new RegExp(`\`${ROLE_SEPARATED_ROOT}\` \\(unchanged from \`\\.3\`\\)`, "u"));
});

test("deriving from the recorded inputs of .3 and .4 reproduces the committed entries byte for byte", () => {
  const raw = text(LEDGER);
  const ledger = committed();
  // why: a second ledger that grows only by derivation, so entry 4 is also proven
  // to chain to the derived entry 3, not only to the committed one.
  let derivedChain = prefixBefore(ledger, RECORDED_RELEASES[0].sequence);
  for (const { sequence, inputs } of RECORDED_RELEASES) {
    const recorded = ledger.entries[sequence - 1];
    const derived = admitRelease(prefixBefore(ledger, sequence), inputs);
    const chained = admitRelease(derivedChain, inputs);
    for (const entry of [derived, chained]) {
      // why: the form a human reviews and appends: same keys, same order, same values.
      assert.equal(reviewed(entry), reviewed(recorded));
      // why: the canonical form the next entry's previousEntryDigest covers.
      assert.equal(ledgerEntryDigest(entry), ledgerEntryDigest(recorded));
      assert.equal(entry.previousEntryDigest, recorded.previousEntryDigest);
      assert.equal(entry.previousEntryDigest, ledgerEntryDigest(ledger.entries[sequence - 2]));
      // why: the committed file carries exactly these bytes for the entry.
      assert.equal(raw.split(asCommitted(entry)).length, 2, `entry ${sequence} bytes appear once in the file`);
    }
    derivedChain = { ...derivedChain, entries: [...derivedChain.entries, chained] };
  }
  // why: the origin and the prefix are split exactly as the committed entries record them.
  assert.deepEqual(
    derivedChain.entries.slice(2).map(({ baseUrl, urlPrefix }) => [baseUrl, urlPrefix]),
    [
      ["https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/", "v3/"],
      ["https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/", "v4/"]
    ]
  );
  assert.deepEqual(derivedChain.entries, ledger.entries.slice(0, RECORDED_RELEASES.at(-1).sequence));
});

test("the reproduction discriminates: any changed input or prefix derives a different entry", () => {
  const ledger = committed();
  const [{ sequence, inputs }] = RECORDED_RELEASES;
  const recorded = ledger.entries[sequence - 1];
  const before = prefixBefore(ledger, sequence);
  for (const change of [
    { releaseId: "release:verchestra:0.0.0-qualification.3:000000000000" },
    { semanticVersion: "0.0.0-qualification.33" },
    { baseUrl: "https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/v33/" },
    { rootDigest: rootWithPrefix("sha256:949fbce3", "0") },
    { rootVersion: 2 },
    { metadataVersion: 4 },
    { publicationRunId: "36785647399" },
    { publicationRunId: undefined },
    { evidence: [RUNBOOK, MATRIX] }
  ])
    assert.notEqual(reviewed(admitRelease(before, { ...inputs, ...change })), reviewed(recorded));
  // why: the same inputs over a different prefix chain to a different entry.
  const shorter = admitRelease(prefixBefore(ledger, 2), inputs);
  assert.notEqual(shorter.previousEntryDigest, recorded.previousEntryDigest);
  assert.equal(shorter.sequence, 2);
});

test("a release already recorded is not admitted again, and the next version is", () => {
  const ledger = committed();
  for (const { sequence, inputs } of RECORDED_RELEASES)
    assert.throws(() => admitRelease(prefixBefore(ledger, sequence + 1), inputs), {
      code: "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC"
    });
  const last = RECORDED_RELEASES.at(-1).inputs;
  const highest = Math.max(
    ...ledger.entries
      .filter((entry) => entryMayShareRoot(entry, last.rootDigest))
      .flatMap((entry) => Object.values(entry.roles))
  );
  const next = admitRelease(ledger, { ...last, metadataVersion: highest + 1 });
  assert.equal(next.sequence, ledger.entries.length + 1);
  assert.equal(next.previousEntryDigest, ledgerEntryDigest(ledger.entries.at(-1)));
  assert.doesNotThrow(() => validatePublicationLedger({ ...ledger, entries: [...ledger.entries, next] }));
});

test("an empty ledger admits a first release, chained to nothing", () => {
  const empty = { ...committed(), entries: [] };
  assert.deepEqual(admitRelease(empty, SAMPLE_RELEASE), {
    sequence: 1,
    previousEntryDigest: null,
    kind: "release",
    releaseId: SAMPLE_RELEASE.releaseId,
    semanticVersion: "9.9.9",
    // why: a release served from the bucket root records an empty prefix, as entry 1 does.
    baseUrl: "https://releases.example.invalid/",
    urlPrefix: "",
    rootDigest: SAMPLE_RELEASE.rootDigest,
    rootDigestPrefix: null,
    roles: { root: 1, snapshot: 1, targets: 1, timestamp: 1 },
    publicationRunId: "4242",
    evidence: [LEDGER]
  });
  assert.deepEqual(Object.keys(admitRelease(empty, SAMPLE_RELEASE)), Object.keys(committed().entries[0]));
  // why: a local run records no workflow run.
  const { publicationRunId, ...local } = SAMPLE_RELEASE;
  assert.equal(publicationRunId, "4242");
  assert.equal(admitRelease(empty, local).publicationRunId, null);
  // why: a nested prefix stays one prefix; the origin keeps a non-default port.
  const nested = admitRelease(empty, { ...SAMPLE_RELEASE, baseUrl: "https://releases.example.invalid:8443/a/b.c/" });
  assert.deepEqual([nested.baseUrl, nested.urlPrefix], ["https://releases.example.invalid:8443/", "a/b.c/"]);
});

test("the admission derives the chain and the kind itself, whatever the caller passes", () => {
  const ledger = committed();
  const entry = admitRelease(ledger, {
    ...SAMPLE_RELEASE,
    sequence: 1,
    previousEntryDigest: null,
    kind: "role-refresh",
    urlPrefix: "elsewhere/",
    rootDigestPrefix: "sha256:00000000",
    roles: { snapshot: 99, timestamp: 99 }
  });
  assert.equal(entry.sequence, ledger.entries.length + 1);
  assert.equal(entry.previousEntryDigest, ledgerEntryDigest(ledger.entries.at(-1)));
  assert.equal(entry.kind, "release");
  assert.equal(entry.urlPrefix, "");
  assert.equal(entry.rootDigestPrefix, null);
  assert.deepEqual(entry.roles, { root: 1, snapshot: 1, targets: 1, timestamp: 1 });
  // why: the entry never aliases the caller's evidence list.
  assert.notEqual(entry.evidence, SAMPLE_RELEASE.evidence);
});

test("the admission refuses a release it cannot record faithfully", () => {
  const ledger = committed();
  refused(ledger, { rootDigest: "sha256:short", metadataVersion: 1 }, /root digest is invalid/u);
  assert.throws(() => admitRelease(ledger, { ...SAMPLE_RELEASE, rootDigest: "sha256:short" }), {
    code: "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC"
  });
  assert.throws(() => admitRelease(ledger, { ...SAMPLE_RELEASE, metadataVersion: 0 }), {
    code: "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC"
  });
  // why: a location that would not concatenate back to the pinned base URL.
  for (const baseUrl of [
    "https://user:secret@releases.example.invalid/v9/",
    "https://releases.example.invalid/v9/?channel=stable",
    "https://releases.example.invalid/v9/#latest",
    "https://RELEASES.example.invalid/v9/",
    "https://releases.example.invalid/v9/../v8/",
    "not a url",
    undefined
  ])
    invalidRelease(ledger, { ...SAMPLE_RELEASE, baseUrl }, /release baseUrl/u);
  // why: a location the ledger's own entry rules refuse.
  for (const baseUrl of [
    "http://releases.example.invalid/v9/",
    "https://releases.example.invalid/v9",
    "https://releases.example.invalid/v%209/"
  ])
    invalidRelease(ledger, { ...SAMPLE_RELEASE, baseUrl }, /baseUrl|urlPrefix/u);
  // invariant: a derived entry records every fact; null is only for the seed entries.
  invalidRelease(ledger, { ...SAMPLE_RELEASE, releaseId: null }, /must record its releaseId/u);
  invalidRelease(ledger, { ...SAMPLE_RELEASE, rootVersion: null }, /must record its root version/u);
  invalidRelease(ledger, { ...SAMPLE_RELEASE, rootVersion: undefined }, /must record its root version/u);
  invalidRelease(ledger, { ...SAMPLE_RELEASE, rootVersion: 0 }, /root version must be a positive integer/u);
  invalidRelease(ledger, { ...SAMPLE_RELEASE, semanticVersion: "" }, /semanticVersion is invalid/u);
  invalidRelease(ledger, { ...SAMPLE_RELEASE, publicationRunId: "run-7" }, /publicationRunId is invalid/u);
  for (const evidence of [[], undefined, LEDGER, ["../outside.md"]])
    invalidRelease(ledger, { ...SAMPLE_RELEASE, evidence }, /evidence/u);
});
