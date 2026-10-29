import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXIT_CONDITION_SECTIONS,
  VERSION_LINE_RECORD,
  canonicalJson,
  checkRepository,
  latestLedgerRelease,
  readVersionLineRecord,
  repositoryWarnings,
  retiredDecisionAnchors,
  validateVersionLineRecord
} from "../../scripts/agent-readiness.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

// Everything below is synthetic, as in release-decision.test.mjs: throwaway keys
// generated per run, a fixture decision whose bytes only the digest matters for,
// and evidence files that exist only to be resolvable. No fixture carries a real
// signature or a real identity; a signed fixture in a tracked test would read
// as a record the owner actually signed.
const KEY_PAIR = generateKeyPairSync("ed25519");
const WRONG_KEY_PAIR = generateKeyPairSync("ed25519");
const PUBLIC_KEY_REF = "docs/qualification/trust/version-line-fixture.json";
const DECISION = "docs/qualification/release-decision-1.0.0.md";
const DECISION_BYTES = "---\nschema: verchestra-release-decision/v1\ndecision: reject\n---\n\n# A hold\n";
const DECISION_DIGEST = `sha256:${createHash("sha256").update(DECISION_BYTES).digest("hex")}`;
const LEDGER = {
  schema: "verchestra-tuf-publication-ledger/v1",
  entries: [
    { sequence: 1, kind: "release", semanticVersion: "0.0.0-qualification" },
    { sequence: 2, kind: "release", semanticVersion: "0.0.0-qualification.2" },
    { sequence: 3, kind: "role-refresh", semanticVersion: null }
  ]
};
const EVIDENCE = ["docs/evidence.md", ".github/workflows/fixture.yml"];
const [X_HEADING, R_HEADING] = EXIT_CONDITION_SECTIONS;
const HEADER = "| Condition | Gap | What must be true | Evidence |\n| --- | --- | --- | --- |";
const ROWS = [
  "| X1 | #596 | The next publish carries provenance. | `docs/evidence.md`; `.github/workflows/fixture.yml` |"
];
const ROUND_ROWS = ["| R1 | L8, RR1 | Section 6a is in force. | `docs/evidence.md:385-431` |"];

const anchorFor = (keyPair) =>
  `${JSON.stringify({
    algorithm: "Ed25519",
    encoding: "spki-pem",
    keyId: "version-line-fixture",
    publicKey: keyPair.publicKey.export({ format: "pem", type: "spki" }).toString(),
    purposes: ["release-decision"]
  })}\n`;

const FIELDS = Object.freeze({
  schema: "verchestra-version-line/v1",
  line: "0.0.0-qualification",
  latestRelease: "0.0.0-qualification.2",
  decisionInEffect: DECISION,
  decisionDigest: DECISION_DIGEST,
  decidedBy: "deciding-human-fixture",
  decidedAt: "<RFC 3339 UTC instant, set by the owner when signing>",
  signature: "",
  publicKeyRef: PUBLIC_KEY_REF
});

const body = ({ rows = ROWS, roundRows = ROUND_ROWS, prose = "" } = {}) =>
  ["", "# The line", "", prose, X_HEADING, "", HEADER, ...rows, "", R_HEADING, "", HEADER, ...roundRows, ""].join("\n");

// The signed bytes are the §4.1 projection a decision signs: every frontmatter
// field but `signature`, plus the sha256 of the Markdown body.
const signRecord = (fields, markdown, keyPair) => {
  const claims = {};
  for (const [key, value] of Object.entries(fields)) if (key !== "signature") claims[key] = value;
  const bodyDigest = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
  return signBytes(null, Buffer.from(canonicalJson({ claims, bodyDigest }), "utf8"), keyPair.privateKey).toString(
    "base64url"
  );
};

// `overrides` with a null value drops the field. `signWith` fills `decidedAt`
// and a real signature over the final fields and body.
function record(overrides = {}, { signWith = null, ...layout } = {}) {
  const fields = { ...FIELDS, ...overrides };
  for (const key of Object.keys(fields)) if (fields[key] === null) delete fields[key];
  const markdown = body(layout);
  if (signWith !== null) {
    fields.decidedAt = overrides.decidedAt ?? "2026-11-01T00:00:00Z";
    fields.signature = signRecord(fields, markdown, signWith);
  }
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => (value === "" ? `${key}:` : `${key}: ${value}`))
    .join("\n");
  return `---\n${frontmatter}\n---\n${markdown}`;
}

const OPTIONS = {
  ledgerRelease: "0.0.0-qualification.2",
  readDecision: (reference) => (reference === DECISION ? Buffer.from(DECISION_BYTES) : null),
  pathExists: (path) => EVIDENCE.includes(path),
  resolveKeyRef: (reference) => (reference === PUBLIC_KEY_REF ? anchorFor(KEY_PAIR) : null)
};

async function repositoryFixture(t, { withRecord = true } = {}) {
  const root = await temporaryDirectory(t, "verchestra-version-line-");
  await mkdir(join(root, "docs", "qualification", "trust"), { recursive: true });
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(join(root, PUBLIC_KEY_REF), anchorFor(KEY_PAIR));
  await writeFile(join(root, DECISION), DECISION_BYTES);
  await writeFile(join(root, "docs", "qualification", "tuf-publication-ledger.json"), `${JSON.stringify(LEDGER)}\n`);
  for (const path of EVIDENCE) await writeFile(join(root, path), "evidence\n");
  if (withRecord) await writeFile(join(root, VERSION_LINE_RECORD), record());
  return root;
}

const writeRecord = (root, source) => writeFile(join(root, VERSION_LINE_RECORD), source);

test("the ledger's latest release is its highest-sequence release entry, never a refresh", () => {
  assert.equal(latestLedgerRelease(LEDGER), "0.0.0-qualification.2");
  const reordered = { entries: [LEDGER.entries[1], LEDGER.entries[2], LEDGER.entries[0]] };
  assert.equal(latestLedgerRelease(reordered), "0.0.0-qualification.2");
  assert.equal(latestLedgerRelease({ entries: [LEDGER.entries[2]] }), null);
  assert.equal(latestLedgerRelease({}), null);
  assert.equal(latestLedgerRelease(null), null);
});

test("a complete record with an empty signature is unsigned, with no error", () => {
  const result = validateVersionLineRecord(record(), OPTIONS);
  assert.deepEqual(result.errors, []);
  assert.equal(result.signature, "unsigned");
  assert.equal(result.fields.latestRelease, "0.0.0-qualification.2");
});

test("a signed record verifies against the resolved key, and nothing less than that is verified", () => {
  const verified = validateVersionLineRecord(record({}, { signWith: KEY_PAIR }), OPTIONS);
  assert.deepEqual(verified.errors, []);
  assert.equal(verified.signature, "verified");

  const wrongKey = validateVersionLineRecord(record({}, { signWith: WRONG_KEY_PAIR }), OPTIONS);
  assert.equal(wrongKey.signature, "invalid");
  assert.deepEqual(wrongKey.errors, [`${VERSION_LINE_RECORD}: signature does not verify against publicKeyRef`]);

  // The body edited after signing: the recomputed bodyDigest no longer matches.
  const edited = validateVersionLineRecord(
    record({}, { signWith: KEY_PAIR }).replace("# The line", "# The line (edited)"),
    OPTIONS
  );
  assert.equal(edited.signature, "invalid");
  assert.ok(edited.errors.some((problem) => problem.includes("signature does not verify")));

  // A claim edited after signing is a different set of signed bytes.
  const retyped = validateVersionLineRecord(
    record({}, { signWith: KEY_PAIR }).replace("decidedBy: deciding-human-fixture", "decidedBy: someone-else"),
    OPTIONS
  );
  assert.equal(retyped.signature, "invalid");

  // A present signature with no resolver fails closed rather than passing.
  const unresolved = validateVersionLineRecord(record({}, { signWith: KEY_PAIR }), {
    ...OPTIONS,
    resolveKeyRef: undefined
  });
  assert.equal(unresolved.signature, "invalid");
  assert.ok(unresolved.errors.some((problem) => problem.includes("publicKeyRef does not resolve to a committed key")));
});

test("a signed record needs a real decision instant; an unsigned one may keep the placeholder", () => {
  const signed = validateVersionLineRecord(
    record({ decidedAt: "<RFC 3339 UTC instant, set by the owner when signing>" }, { signWith: KEY_PAIR }),
    OPTIONS
  );
  assert.ok(
    signed.errors.some((problem) => problem.includes("a signed record needs decidedAt as an RFC 3339 UTC timestamp"))
  );
  assert.deepEqual(validateVersionLineRecord(record({ decidedAt: "TBD" }), OPTIONS).errors, []);
});

// One row per fail-closed condition. Each fixture breaks exactly the dimension
// it names, so a passing row proves that dimension is what rejected it.
for (const [label, source, expected] of [
  ["an empty file", "", "missing or malformed version-line frontmatter"],
  ["a heading-only placeholder", "# The line\n", "missing or malformed version-line frontmatter"],
  ["a wrong schema", record({ schema: "verchestra-version-line/v2" }), "unsupported version-line schema"],
  ["a line that is not a version", record({ line: "qualification" }), "line must be a semantic version"],
  ["a missing deciding identity", record({ decidedBy: null }), "decidedBy must name a GitHub identity"],
  [
    "the template placeholder as the deciding identity",
    record({ decidedBy: "<GitHub identity>" }),
    "decidedBy must name a GitHub identity"
  ],
  ["no latest release", record({ latestRelease: null }), "latestRelease must name the ledger's latest release"],
  [
    "a latest release that is not the ledger's",
    record({ latestRelease: "0.0.0-qualification" }),
    "latestRelease 0.0.0-qualification is not the ledger's latest release 0.0.0-qualification.2"
  ],
  [
    "a latest release from another line",
    record({ latestRelease: "0.1.0" }),
    "latestRelease 0.1.0 is not a build of line 0.0.0-qualification"
  ],
  [
    "a decision outside the decision-file convention",
    record({ decisionInEffect: "docs/qualification/RELEASE-DECISION-CONTRACT.md" }),
    "decisionInEffect must name a docs/qualification/release-decision-<version>[.round-<n>].md file"
  ],
  [
    "a decision outside docs/qualification",
    record({ decisionInEffect: "docs/release-decision-1.0.0.md" }),
    "decisionInEffect must name a docs/qualification/release-decision-<version>[.round-<n>].md file"
  ],
  [
    "a decision file that cannot be read",
    record({ decisionInEffect: "docs/qualification/release-decision-2.0.0.md" }),
    "docs/qualification/release-decision-2.0.0.md could not be read"
  ],
  [
    "a decision digest that is not sha256:<64 hex>",
    record({ decisionDigest: "sha256:abc" }),
    "decisionDigest must read sha256:<64 hex>"
  ],
  [
    "a decision digest that is not the decision's current bytes",
    record({ decisionDigest: `sha256:${"0".repeat(64)}` }),
    "decisionDigest does not match the current bytes of docs/qualification/release-decision-1.0.0.md"
  ],
  ["a missing public key reference", record({ publicKeyRef: null }), "publicKeyRef must be present"],
  [
    "a missing exit-conditions section",
    record({}).replace(X_HEADING, "## Something else"),
    `missing the "${X_HEADING}" section`
  ],
  [
    "a missing round-2 section",
    record({}).replace(R_HEADING, "## Something else"),
    `missing the "${R_HEADING}" section`
  ],
  ["an exit-conditions table with no row", record({}, { rows: [] }), `the "${X_HEADING}" table names no condition`],
  [
    "a condition with no gap id",
    record({}, { rows: ["| X1 | | Something. | `docs/evidence.md` |"] }),
    "X1 must name the gap ids it closes (#<issue>, L<n>, F<n>, or RR<n>), found nothing"
  ],
  [
    "a condition whose gap is prose",
    record({}, { rows: ["| X1 | the npm gap | Something. | `docs/evidence.md` |"] }),
    "X1 must name the gap ids it closes (#<issue>, L<n>, F<n>, or RR<n>), found the npm gap"
  ],
  [
    "a condition with no evidence path",
    record({}, { rows: ["| X1 | #596 | Something. | the workflow |"] }),
    "X1 names no evidence path"
  ],
  [
    "a condition whose evidence does not resolve",
    record({}, { rows: ["| X1 | #596 | Something. | `docs/missing.md` |"] }),
    "X1 evidence path docs/missing.md does not resolve"
  ],
  [
    "a condition row with the wrong number of columns",
    record({}, { rows: ["| X1 | #596 | `docs/evidence.md` |"] }),
    "X1 is not a four-column row"
  ],
  ["a condition id named twice", record({}, { rows: [...ROWS, ...ROWS] }), "X1 is named twice"]
]) {
  test(`the record is refused for ${label}`, () => {
    const { errors } = validateVersionLineRecord(source, OPTIONS);
    assert.ok(
      errors.some((problem) => problem.includes(expected)),
      `expected an error naming "${expected}", got ${JSON.stringify(errors)}`
    );
    assert.ok(
      errors.every((problem) => problem.startsWith(`${VERSION_LINE_RECORD}: `)),
      `every error must name the record, got ${JSON.stringify(errors)}`
    );
  });
}

test("a line suffix on an evidence path is read as a location, not as part of the path", () => {
  const rows = ["| X1 | L2 | Something. | `docs/evidence.md:12`; `.github/workflows/fixture.yml:3-9` |"];
  assert.deepEqual(validateVersionLineRecord(record({}, { rows }), OPTIONS).errors, []);
});

test("the ledger and the decision are read from the repository, not from the record", async (t) => {
  const root = await repositoryFixture(t);
  const clean = await readVersionLineRecord(root);
  assert.deepEqual(clean.errors, []);
  assert.equal(clean.signature, "unsigned");
  assert.deepEqual(clean.warnings, [
    `${VERSION_LINE_RECORD}: signature is empty; the record is unsigned until the owner signs it`
  ]);

  // A release appended to the ledger after the record was written.
  const grown = {
    ...LEDGER,
    entries: [...LEDGER.entries, { sequence: 4, kind: "release", semanticVersion: "0.0.0-qualification.3" }]
  };
  await writeFile(join(root, "docs", "qualification", "tuf-publication-ledger.json"), `${JSON.stringify(grown)}\n`);
  assert.ok(
    (await readVersionLineRecord(root)).errors.some((problem) =>
      problem.includes("latestRelease 0.0.0-qualification.2 is not the ledger's latest release 0.0.0-qualification.3")
    )
  );
  await writeFile(join(root, "docs", "qualification", "tuf-publication-ledger.json"), `${JSON.stringify(LEDGER)}\n`);

  // The decision in effect edited by one byte after the record bound to it.
  await writeFile(join(root, DECISION), DECISION_BYTES.replace("# A hold", "# A hold "));
  assert.ok(
    (await readVersionLineRecord(root)).errors.some((problem) =>
      problem.includes("decisionDigest does not match the current bytes")
    )
  );
  await writeFile(join(root, DECISION), DECISION_BYTES);

  // A ledger that cannot be read is no release, not a pass.
  await writeFile(join(root, "docs", "qualification", "tuf-publication-ledger.json"), "not json\n");
  assert.ok(
    (await readVersionLineRecord(root)).errors.some((problem) =>
      problem.includes("the publication ledger records no release")
    )
  );
});

test("evidence paths resolve inside the repository only", async (t) => {
  const root = await repositoryFixture(t);
  // A sibling directory under the OS temp directory, removed with the test: the
  // file exists, and only the repository boundary refuses it.
  const outside = await temporaryDirectory(t, "verchestra-version-line-outside-");
  await writeFile(join(outside, "outside.md"), "outside\n");
  const escape = `../${basename(outside)}/outside.md`;
  await writeRecord(root, record({}, { rows: [`| X1 | #1 | Something. | \`${escape}\` |`] }));
  const { errors } = await readVersionLineRecord(root);
  assert.ok(
    errors.some((problem) => problem.includes(`X1 evidence path ${escape} does not resolve`)),
    `expected the escaping path to be refused, got ${JSON.stringify(errors)}`
  );
});

test("a signed record on disk is verified with the committed key and carries no warning", async (t) => {
  const root = await repositoryFixture(t);
  await writeRecord(root, record({}, { signWith: KEY_PAIR }));
  const signed = await readVersionLineRecord(root);
  assert.deepEqual(signed.errors, []);
  assert.equal(signed.signature, "verified");
  assert.deepEqual(signed.warnings, []);

  await writeRecord(root, record({}, { signWith: WRONG_KEY_PAIR }));
  const forged = await readVersionLineRecord(root);
  assert.equal(forged.signature, "invalid");
  assert.deepEqual(forged.warnings, []);
  assert.deepEqual(forged.errors, [`${VERSION_LINE_RECORD}: signature does not verify against publicKeyRef`]);
});

// invariant: a rotation retires the old anchor under trust/retired/ with
// `validUntil` and puts the new key in the role's file (docs/release-custody.md
// 7.4). What the old key signed before that instant still verifies; nothing it
// signs at or after it does, and a retired key of another purpose never does.
test("a record signed by a retired key verifies only inside the key's window", async (t) => {
  const root = await repositoryFixture(t);
  const retiredAt = "2026-11-01T00:00:00.000Z";
  const retire = (keyPair, purposes) =>
    writeFile(
      join(root, "docs", "qualification", "trust", "retired", "version-line-fixture-old.json"),
      `${JSON.stringify({ ...JSON.parse(anchorFor(keyPair)), keyId: "version-line-fixture-old", purposes, validUntil: retiredAt })}\n`
    );
  await mkdir(join(root, "docs", "qualification", "trust", "retired"), { recursive: true });
  await retire(WRONG_KEY_PAIR, ["release-decision"]);

  await writeRecord(root, record({ decidedAt: "2026-10-31T23:59:59Z" }, { signWith: WRONG_KEY_PAIR }));
  assert.equal((await readVersionLineRecord(root)).signature, "verified");

  await writeRecord(root, record({ decidedAt: "2026-11-01T00:00:00Z" }, { signWith: WRONG_KEY_PAIR }));
  const late = await readVersionLineRecord(root);
  assert.equal(late.signature, "invalid");
  assert.deepEqual(late.errors, [`${VERSION_LINE_RECORD}: signature does not verify against publicKeyRef`]);

  await retire(WRONG_KEY_PAIR, ["qualification-evidence-index"]);
  await writeRecord(root, record({ decidedAt: "2026-10-31T23:59:59Z" }, { signWith: WRONG_KEY_PAIR }));
  assert.equal((await readVersionLineRecord(root)).signature, "invalid");

  await writeRecord(root, record({}, { signWith: KEY_PAIR }));
  assert.equal((await readVersionLineRecord(root)).signature, "verified", "the active key is unaffected");
});

test("only a same-purpose retired anchor whose window covers the instant is a candidate", () => {
  const active = anchorFor(KEY_PAIR);
  const anchor = (fields) => JSON.stringify({ ...JSON.parse(active), ...fields });
  const inside = anchor({ keyId: "a", validUntil: "2026-11-01T00:00:00.000Z" });
  const otherPurpose = anchor({ keyId: "b", validUntil: "2026-11-01T00:00:00.000Z", purposes: ["other"] });
  const unretired = anchor({ keyId: "c" });
  const all = [inside, otherPurpose, unretired, "not json"];
  assert.deepEqual(retiredDecisionAnchors(active, all, "2026-10-31T00:00:00Z"), [inside]);
  assert.deepEqual(retiredDecisionAnchors(active, all, "2026-11-01T00:00:00Z"), []);
  assert.deepEqual(retiredDecisionAnchors(active, all, "<placeholder>"), []);
  assert.deepEqual(retiredDecisionAnchors("not json", all, "2026-10-31T00:00:00Z"), []);
});

test("no record is not a failure, because nothing has been recorded", async (t) => {
  const root = await repositoryFixture(t, { withRecord: false });
  assert.deepEqual(await readVersionLineRecord(root), { errors: [], warnings: [], signature: "absent", fields: null });
  assert.deepEqual(await repositoryWarnings(root), []);
});

test("the record's errors reach checkRepository and its unsigned state reaches repositoryWarnings", async (t) => {
  const root = await repositoryFixture(t);
  // The least a repository check needs to run; every other audit dimension
  // reports its own absence, and only the record's line is asserted here.
  await writeFile(
    join(root, "package.json"),
    '{"version":"0.0.0-qualification","license":"Apache-2.0","scripts":{}}\n'
  );
  await writeRecord(root, record({ latestRelease: "0.0.0-qualification" }));
  const errors = await checkRepository(root);
  assert.ok(
    errors.includes(
      `${VERSION_LINE_RECORD}: latestRelease 0.0.0-qualification is not the ledger's latest release 0.0.0-qualification.2`
    ),
    `expected the record's error among ${JSON.stringify(errors)}`
  );
  assert.deepEqual(await repositoryWarnings(root), [
    `${VERSION_LINE_RECORD}: signature is empty; the record is unsigned until the owner signs it`
  ]);
});

test("the committed record validates, and is never reported as a pass while unsigned", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const committed = await readVersionLineRecord(root);
  assert.deepEqual(committed.errors, []);
  assert.ok(["unsigned", "verified"].includes(committed.signature), `signature state ${committed.signature}`);
  assert.equal(committed.fields.line, "0.0.0-qualification");
  assert.equal(committed.fields.decisionInEffect, "docs/qualification/release-decision-1.0.0.md");
  // Unsigned means a warning and nothing else; verified means no warning.
  assert.equal(committed.warnings.length, committed.signature === "unsigned" ? 1 : 0);
  const source = await readFile(join(root, VERSION_LINE_RECORD), "utf8");
  for (const heading of EXIT_CONDITION_SECTIONS) assert.ok(source.includes(`\n${heading}\n`), heading);
});
