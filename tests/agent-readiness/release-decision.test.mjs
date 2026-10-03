import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import {
  RELEASE_DECISION_FILE,
  canonicalJson,
  readReleaseDecisions,
  releaseDecisionFileName,
  validateReleaseDecision
} from "../../scripts/agent-readiness.mjs";

// Everything below is synthetic. The keys are throwaway pairs generated per run,
// no real reviewer identity appears in any fixture, and none of it is committed:
// a decision fixture carrying a real signature or key would read as a decision
// that was actually taken.
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const REGISTER_DIGEST = "9".repeat(64);
const RELEASE_DIGEST = `sha256:${"c".repeat(64)}`;
const CHAIN = ["T69", "T70", "T71", "T72", "T73", "T74", "T75", "T76"];

// The signing key the fixtures use, and its committed-shape public anchor. The
// decision points publicKeyRef at a path under docs/qualification/trust/, which
// the repository fixtures write, so readReleaseDecisions can resolve and verify.
const KEY_PAIR = generateKeyPairSync("ed25519");
const WRONG_KEY_PAIR = generateKeyPairSync("ed25519");
const PUBLIC_KEY_REF = "docs/qualification/trust/release-decision-fixture.json";
const anchorFor = (keyPair) =>
  `${JSON.stringify({
    algorithm: "Ed25519",
    encoding: "spki-pem",
    keyId: "release-decision-fixture",
    publicKey: keyPair.publicKey.export({ format: "pem", type: "spki" }).toString(),
    purposes: ["release-decision"]
  })}\n`;
const provisionKey = async (root, keyPair = KEY_PAIR) => {
  await mkdir(join(root, "docs", "qualification", "trust"), { recursive: true });
  await writeFile(join(root, PUBLIC_KEY_REF), anchorFor(keyPair));
};

// The Markdown body every fixture decision carries, and the §4.1 canonical body
// over which the signature is computed — the same bytes the validator recomputes.
const BODY = "\n# Release decision 1.0.0\n";
const signDecision = (fields, keyPair = KEY_PAIR) => {
  const claims = {};
  for (const [key, value] of Object.entries(fields)) if (value !== null && key !== "signature") claims[key] = value;
  const bodyDigest = `sha256:${createHash("sha256").update(BODY, "utf8").digest("hex")}`;
  return signBytes(null, Buffer.from(canonicalizeJsonV2({ claims, bodyDigest }), "utf8"), keyPair.privateKey).toString(
    "base64url"
  );
};

const REPOSITORY = {
  isRepositoryCommit: (revision) => revision === SHA,
  isTrustedRevision: (revision) => revision === SHA,
  registerAt: (revision) => (revision === SHA ? { digest: REGISTER_DIGEST, count: 93 } : null),
  validatedTasks: new Set(CHAIN)
};

// why: `unsignedField` signs every claim but that one, which is what a verifier
// that ignored the field would accept; it proves a field is in the signed bytes.
const decision = (overrides = {}, signWith = KEY_PAIR, unsignedField = null) => {
  const fields = {
    schema: "verchestra-release-decision/v1",
    version: "1.0.0",
    decision: "reject",
    candidateRevision: SHA,
    candidateReleaseDigest: RELEASE_DIGEST,
    requirementsRegister: REGISTER_DIGEST,
    requirementsClosed: "93 of 93 requirements evidenced",
    qualificationReports: CHAIN.join(", "),
    gates: "pnpm gate:release",
    gateResults: "pass",
    gateRevision: SHA,
    skipped: "0",
    todo: "0",
    survivingMutants: "0",
    operationalReviewer: "operational-reviewer-fixture",
    securityReviewer: "security-reviewer-fixture",
    decidedBy: "deciding-human-fixture",
    decidedAt: "2026-08-26T00:00:00Z",
    publicKeyRef: PUBLIC_KEY_REF,
    reviewedIn: "https://github.com/accd/verchestra/pull/371",
    ...overrides
  };
  // A real signature over the final fields, unless the caller pins one (to test
  // a missing/placeholder/tampered signature) or signs with a different key.
  if (!Object.prototype.hasOwnProperty.call(overrides, "signature"))
    fields.signature = signDecision(
      Object.fromEntries(Object.entries(fields).filter(([key]) => key !== unsignedField)),
      signWith
    );
  const body = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${body}\n---\n${BODY}`;
};

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

const commit = (root, message) =>
  git(root, "-c", "user.name=Decision fixture", "-c", "user.email=fixture@example.test", "commit", "-m", message);

// The ids are deliberately not `VES-`-shaped. `scripts/requirements-trace.mjs`
// scans `tests/` for requirement ids, so a realistic-looking id in this file
// would enter the real traceability view as a requirement nothing registers.
const REGISTER_BYTES = `${JSON.stringify(
  {
    schemaVersion: 1,
    requirements: Array.from({ length: 4 }, (_, index) => ({ id: `FIXTURE-REQUIREMENT-${index}` })),
    openGaps: []
  },
  null,
  2
)}\n`;

async function repositoryFixture(root) {
  await mkdir(join(root, "docs", "qualification"), { recursive: true });
  await provisionKey(root);
  git(root, "init", "--initial-branch=main");
  git(root, "config", "core.autocrlf", "false");
  await writeFile(join(root, "docs", "requirements-register.json"), REGISTER_BYTES);
  git(root, "add", "docs/requirements-register.json");
  commit(root, "register");
  return git(root, "rev-parse", "HEAD");
}

// The census admits agent-readiness.mjs's inlined canonicalizer only on a
// byte-equality proof against the shared V2 encoder (#395). The signature test
// below proves it for one fixture; this proves it over the orderings and scalars
// a decision body can carry, including the code-unit member order JCS requires.
test("the inlined decision canonicalizer is byte-equal to canonicalizeJsonV2", () => {
  const values = [
    {
      claims: {
        schema: "verchestra-release-decision/v1",
        version: "1.0.0",
        decision: "reject",
        requirementsClosed: "93 of 93 requirements evidenced",
        candidateRevision: SHA,
        count: 93,
        reviewedIn: null
      },
      bodyDigest: RELEASE_DIGEST
    },
    { "\uffff": 1, "\u{1f600}": 2, "\u00e9": 3, Z: 4, a: 5, "": 6, 10: 7, 9: 8 },
    { quote: 'say "hi"\\', control: "\u0000\u001f\n\t", unicode: "caf\u00e9 \u2028 \u{1f600}" },
    [0, -0, 1, -1, 0.1, 1e21, 1e-7, 123456789012345, Number.MAX_SAFE_INTEGER, true, false, null],
    { nested: [{ b: [], a: {} }, [[["deep"]]]] }
  ];
  for (const value of values) assert.equal(canonicalJson(value), canonicalizeJsonV2(value));
});

test("a complete decision is accepted", () => {
  assert.deepEqual(validateReleaseDecision(decision(), "1.0.0", REPOSITORY), []);
  assert.deepEqual(validateReleaseDecision(decision({ decision: "promote" }), "1.0.0", REPOSITORY), []);
});

test("the decision filename pattern accepts a version and rejects anything else", () => {
  for (const name of ["release-decision-1.0.0.md", "release-decision-0.0.0-qualification.md"])
    assert.equal(RELEASE_DECISION_FILE.test(name), true, `must accept ${name}`);
  for (const name of ["release-decision.md", "release-decision-1.0.md", "RELEASE-DECISION-CONTRACT.md"])
    assert.equal(RELEASE_DECISION_FILE.test(name), false, `must reject ${name}`);
});

// One row per fail-closed condition in RELEASE-DECISION-CONTRACT.md. Each
// fixture violates exactly the dimension it names and nothing else, so a passing
// row proves that dimension is what rejected it.
for (const [label, source, expected] of [
  ["an empty file", "", "missing the release-decision frontmatter"],
  ["a heading-only placeholder", "# Release decision 1.0.0\n", "missing the release-decision frontmatter"],
  ["a malformed frontmatter line", "---\nnot a field\n---\n", "malformed frontmatter line"],
  ["a wrong schema", decision({ schema: "verchestra-release-decision/v9" }), "unsupported decision schema"],
  ["a version the filename does not name", decision({ version: "2.0.0" }), "decision claims version 2.0.0"],
  ["a verdict outside promote and reject", decision({ decision: "hold" }), "decision must be promote or reject"],
  ["a missing verdict", decision({ decision: null }), "decision must be promote or reject, found nothing"],
  [
    "a candidate revision that is not a full commit id",
    decision({ candidateRevision: "3d363f7", gateRevision: "3d363f7" }),
    "candidateRevision is not a full commit id"
  ],
  [
    "a well-formed candidate revision this repository does not contain",
    decision({ candidateRevision: OTHER_SHA, gateRevision: OTHER_SHA }),
    "is not a commit in this repository"
  ],
  ["gate evidence from another revision", decision({ gateRevision: OTHER_SHA }), "not bound to the candidate revision"],
  [
    "a release digest that is not sha256:<64 hex>",
    decision({ candidateReleaseDigest: "sha256:deadbeef" }),
    "candidateReleaseDigest must read sha256:<64 hex>"
  ],
  [
    "a register digest that is not a sha256",
    decision({ requirementsRegister: "the reviewed register" }),
    "requirementsRegister must be the sha256 of docs/requirements-register.json"
  ],
  [
    "a register digest that is not the register at the candidate revision",
    decision({ requirementsRegister: "0".repeat(64) }),
    "requirementsRegister does not match the register at"
  ],
  [
    "requirement counts relabelled to read as complete",
    decision({ requirementsClosed: "5 open, 93 total" }),
    'requirementsClosed must read "<n> of <n> requirements evidenced"'
  ],
  [
    "requirements that are not all evidenced",
    decision({ requirementsClosed: "90 of 93 requirements evidenced" }),
    "only 90 of 93 requirements are evidenced"
  ],
  [
    "a denominator the register does not declare",
    decision({ requirementsClosed: "98 of 98 requirements evidenced" }),
    "requirementsClosed names 98 requirements; the register declares 93"
  ],
  [
    "a gate other than the release gate",
    decision({ gates: "pnpm gate:quick", gateResults: "pass" }),
    "gate:quick is not the release decision gate"
  ],
  [
    "a broader gate set that merely includes the release gate",
    decision({ gates: "pnpm gate:quick, pnpm gate:release", gateResults: "pass, pass" }),
    "gate:quick is not the release decision gate"
  ],
  ["no gate at all", decision({ gates: null, gateResults: null }), "gate:release was not recorded"],
  ["a failing gate", decision({ gateResults: "fail" }), "gate gate:release did not pass"],
  ["a gate with no recorded result", decision({ gateResults: null }), "every gate needs a recorded result"],
  ["a skipped case", decision({ skipped: "2" }), "skipped must be 0, found 2"],
  ["a todo case", decision({ todo: "1" }), "todo must be 0, found 1"],
  ["a surviving mutant", decision({ survivingMutants: "1" }), "survivingMutants must be 0, found 1"],
  [
    "a qualification report the chain does not have",
    decision({ qualificationReports: `${CHAIN.join(", ")}, T77` }),
    "no qualification report satisfies the contract for: T77"
  ],
  [
    "a chain entry that is not a task id",
    decision({ qualificationReports: "all of them" }),
    "qualificationReports names a value that is not a task id: all of them"
  ],
  ["no chain at all", decision({ qualificationReports: null }), "qualificationReports names no task in the chain"],
  [
    "an operational reviewer who is the deciding human",
    decision({ operationalReviewer: "deciding-human-fixture" }),
    "must be three distinct identities"
  ],
  [
    "a security reviewer who is the deciding human",
    decision({ securityReviewer: "deciding-human-fixture" }),
    "must be three distinct identities"
  ],
  [
    "one person holding both reviewer roles",
    decision({ securityReviewer: "operational-reviewer-fixture" }),
    "must be three distinct identities"
  ],
  ["a missing security reviewer", decision({ securityReviewer: null }), "securityReviewer must name a GitHub identity"],
  [
    "the contract template copied verbatim",
    decision({ decidedBy: "<GitHub identity of the accountable human>" }),
    "decidedBy must name a GitHub identity"
  ],
  [
    "a decision instant that is not RFC 3339 UTC",
    decision({ decidedAt: "2026-08-26 00:00:00 +0100" }),
    "decidedAt must be an RFC 3339 UTC timestamp"
  ],
  ["a missing signature", decision({ signature: null }), "signature must be present"],
  ["an unfilled signature placeholder", decision({ signature: "TBD" }), "signature must be present"],
  ["a missing public key reference", decision({ publicKeyRef: null }), "publicKeyRef must be present"],
  ["no reviewed pull request", decision({ reviewedIn: null }), "reviewedIn must name the pull request"],
  [
    "a reviewedIn that is not a pull request URL",
    decision({ reviewedIn: "https://github.com/accd/verchestra/issues/18" }),
    "reviewedIn must name the pull request"
  ]
]) {
  test(`a release decision is refused for ${label}`, () => {
    const errors = validateReleaseDecision(source, "1.0.0", REPOSITORY);
    assert.ok(
      errors.some((problem) => problem.includes(expected)),
      `expected an error naming "${expected}", got ${JSON.stringify(errors)}`
    );
    assert.ok(
      errors.every((problem) => problem.startsWith("release-decision-1.0.0.md: ")),
      `every error must name the decision file, got ${JSON.stringify(errors)}`
    );
  });
}

test("a candidate revision reachable only through a side ref is refused", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-reachability-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registerRevision = await repositoryFixture(root);

  git(root, "switch", "-c", "side-candidate");
  await writeFile(join(root, "side.txt"), "side-ref-only candidate\n");
  git(root, "add", "side.txt");
  commit(root, "side candidate");
  const sideRevision = git(root, "rev-parse", "HEAD");
  git(root, "switch", "main");

  const path = join(root, "docs", "qualification", "release-decision-1.0.0.md");
  await writeFile(path, decision({ candidateRevision: sideRevision, gateRevision: sideRevision }));
  const sideErrors = (await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors;
  assert.ok(
    sideErrors.some((problem) => problem.includes("is not reachable from the trusted release target")),
    `expected a side-ref candidate to fail reachability, got ${JSON.stringify(sideErrors)}`
  );

  // The same decision bound to trusted history clears reachability, so the
  // rejection above is the reachability check and not an unrelated failure.
  await writeFile(path, decision({ candidateRevision: registerRevision, gateRevision: registerRevision }));
  const trustedErrors = (await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors;
  assert.equal(
    trustedErrors.some((problem) => problem.includes("reachable from the trusted release target")),
    false,
    `expected trusted history to clear reachability, got ${JSON.stringify(trustedErrors)}`
  );
});

test("the register digest and count come from Git, not from the decision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-register-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const revision = await repositoryFixture(root);
  const digest = createHash("sha256").update(REGISTER_BYTES).digest("hex");

  const path = join(root, "docs", "qualification", "release-decision-1.0.0.md");
  const bound = {
    candidateRevision: revision,
    gateRevision: revision,
    requirementsRegister: digest,
    requirementsClosed: "4 of 4 requirements evidenced"
  };
  await writeFile(path, decision(bound));
  assert.deepEqual((await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors, []);

  // The register on disk moves; the digest typed into the decision does not.
  await writeFile(
    join(root, "docs", "requirements-register.json"),
    REGISTER_BYTES.replace("FIXTURE-REQUIREMENT-0", "FIXTURE-REQUIREMENT-9")
  );
  git(root, "add", "docs/requirements-register.json");
  commit(root, "register drift");
  const drifted = git(root, "rev-parse", "HEAD");
  await writeFile(path, decision({ ...bound, candidateRevision: drifted, gateRevision: drifted }));
  const errors = (await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors;
  assert.ok(
    errors.some((problem) => problem.includes("requirementsRegister does not match the register at")),
    `expected the moved register to reject the retyped digest, got ${JSON.stringify(errors)}`
  );
});

test("the decision signature is verified against the resolved key, not merely present", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-signature-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const revision = await repositoryFixture(root);
  const digest = createHash("sha256").update(REGISTER_BYTES).digest("hex");
  const bound = {
    candidateRevision: revision,
    gateRevision: revision,
    requirementsRegister: digest,
    requirementsClosed: "4 of 4 requirements evidenced"
  };
  const path = join(root, "docs", "qualification", "release-decision-1.0.0.md");
  const errorsFor = async () => (await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors;

  // A genuine signature over this exact decision verifies — nothing else was
  // wrong, so the whole decision clears.
  await writeFile(path, decision(bound));
  assert.deepEqual(await errorsFor(), []);

  // Signed with a key other than the committed anchor.
  await writeFile(path, decision(bound, WRONG_KEY_PAIR));
  assert.ok(
    (await errorsFor()).some((problem) => problem.includes("signature does not verify")),
    "a signature from the wrong key must be refused"
  );

  // The body edited after signing: the recomputed bodyDigest no longer matches.
  await writeFile(path, decision(bound).replace("# Release decision 1.0.0", "# Release decision 1.0.0 (edited)"));
  assert.ok(
    (await errorsFor()).some((problem) => problem.includes("signature does not verify")),
    "an edited body must invalidate the signature"
  );

  // A claim edited after signing: the signed claims no longer match the file.
  await writeFile(path, decision(bound).replace(RELEASE_DIGEST, `sha256:${"d".repeat(64)}`));
  assert.ok(
    (await errorsFor()).some((problem) => problem.includes("signature does not verify")),
    "an edited claim must invalidate the signature"
  );
});

test("the decision signature fails closed when the key reference cannot be resolved", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-keyref-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const revision = await repositoryFixture(root);
  const digest = createHash("sha256").update(REGISTER_BYTES).digest("hex");
  const bound = {
    candidateRevision: revision,
    gateRevision: revision,
    requirementsRegister: digest,
    requirementsClosed: "4 of 4 requirements evidenced"
  };
  const path = join(root, "docs", "qualification", "release-decision-1.0.0.md");
  const errorsFor = async () => (await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors;

  // A reference outside docs/qualification/trust/ is not a committed key.
  await writeFile(path, decision({ ...bound, publicKeyRef: "docs/qualification/keys/elsewhere.json" }));
  assert.ok(
    (await errorsFor()).some((problem) => problem.includes("publicKeyRef does not resolve to a committed key"))
  );

  // The reference resolves, but the anchor is not a usable Ed25519 key.
  await writeFile(
    join(root, PUBLIC_KEY_REF),
    `${JSON.stringify({ algorithm: "Ed25519", encoding: "spki-pem", publicKey: "not a public key" })}\n`
  );
  await writeFile(path, decision(bound));
  assert.ok((await errorsFor()).some((problem) => problem.includes("usable Ed25519 public key")));
});

test("a candidate revision with no register at all is refused rather than assumed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-no-register-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs", "qualification"), { recursive: true });
  git(root, "init", "--initial-branch=main");
  git(root, "config", "core.autocrlf", "false");
  await writeFile(join(root, "README.md"), "no register here\n");
  git(root, "add", "README.md");
  commit(root, "no register");
  const revision = git(root, "rev-parse", "HEAD");

  await writeFile(
    join(root, "docs", "qualification", "release-decision-1.0.0.md"),
    decision({ candidateRevision: revision, gateRevision: revision })
  );
  const errors = (await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) })).errors;
  assert.ok(
    errors.some((problem) => problem.includes("could not be read at")),
    `expected an unreadable register to fail closed, got ${JSON.stringify(errors)}`
  );
});

// why: renamed from "a version may have at most one decision file", which a
// version with later rounds made false. The old name is a prefix of this one,
// so the citation in docs/qualification/t77-validation.md still finds it.
test("a version may have at most one decision file per round", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-duplicate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const revision = await repositoryFixture(root);
  const bound = {
    candidateRevision: revision,
    gateRevision: revision,
    requirementsRegister: createHash("sha256").update(REGISTER_BYTES).digest("hex"),
    requirementsClosed: "4 of 4 requirements evidenced"
  };
  const directory = join(root, "docs", "qualification");
  await writeFile(join(directory, "release-decision-1.0.0.md"), decision(bound));
  // A second file for a different filename version that nonetheless declares
  // 1.0.0: the name says one release, the frontmatter decides another.
  await writeFile(join(directory, "release-decision-1.0.1.md"), decision(bound));

  const { decisions, errors } = await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) });
  assert.deepEqual([...decisions.keys()], ["1.0.0"]);
  assert.ok(
    errors.some((problem) => problem.includes("version 1.0.0 already has a decision file")),
    `expected a duplicate version to be reported, got ${JSON.stringify(errors)}`
  );
});

test("no decision file is not a failure, because no decision has been made", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-absent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await repositoryFixture(root);
  await writeFile(join(root, "docs", "qualification", "t76-validation.md"), "# T76\n");
  await writeFile(join(root, "docs", "qualification", "RELEASE-DECISION-CONTRACT.md"), "# contract\n");

  const { decisions, errors } = await readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) });
  assert.deepEqual([...decisions.keys()], []);
  assert.deepEqual(errors, []);
});

// Release decision rounds. A later round supersedes an earlier reject without
// editing it: it binds to the earlier file's exact bytes, decides later, and
// decides on a fresh candidate built on top of the earlier one.
const VERSION = "1.0.0";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ROUND_DECIDED_AT = ["2026-08-26T00:00:00Z", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"];
const roundFile = (round) => releaseDecisionFileName(VERSION, round);
const roundFields = (round, superseded) => ({
  decidedAt: ROUND_DECIDED_AT[round - 1],
  round: String(round),
  supersedes: roundFile(round - 1),
  supersedesDigest: `sha256:${sha256(superseded)}`
});
const laterRound = (round, superseded, overrides = {}) => decision({ ...roundFields(round, superseded), ...overrides });
const boundTo = (revision) => ({
  candidateRevision: revision,
  gateRevision: revision,
  requirementsRegister: sha256(REGISTER_BYTES),
  requirementsClosed: "4 of 4 requirements evidenced"
});
const readRounds = (root) => readReleaseDecisions(root, { validatedTasks: new Set(CHAIN) });
const writeDecision = (root, file, source) => writeFile(join(root, "docs", "qualification", file), source);
const effectiveOf = (round, verdict) => ({ file: roundFile(round), round, decision: verdict });
const historyOf = (round, verdict, valid = true) => ({ ...effectiveOf(round, verdict), valid });
const byCodeUnit = (left, right) => Number(left > right) - Number(left < right);

// Three candidates in trusted history, each built on the one before.
async function roundsFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-decision-rounds-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidates = [await repositoryFixture(root)];
  for (const name of ["second", "third"]) {
    await writeFile(join(root, `${name}.txt`), `${name} candidate\n`);
    git(root, "add", `${name}.txt`);
    commit(root, `${name} candidate`);
    candidates.push(git(root, "rev-parse", "HEAD"));
  }
  return { root, candidates };
}

test("a later round supersedes a hold without editing it and becomes the effective decision", async (t) => {
  const { root, candidates } = await roundsFixture(t);
  const hold = decision(boundTo(candidates[0]));
  await writeDecision(root, roundFile(1), hold);
  const alone = await readRounds(root);
  assert.deepEqual(alone.errors, []);
  assert.deepEqual(alone.decisions.get(VERSION), { ...effectiveOf(1, "reject"), rounds: [historyOf(1, "reject")] });

  const secondHold = laterRound(2, hold, boundTo(candidates[1]));
  await writeDecision(root, roundFile(2), secondHold);
  await writeDecision(
    root,
    roundFile(3),
    laterRound(3, secondHold, { ...boundTo(candidates[2]), decision: "promote" })
  );
  const { decisions, errors } = await readRounds(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(decisions.get(VERSION), {
    ...effectiveOf(3, "promote"),
    rounds: [historyOf(1, "reject"), historyOf(2, "reject"), historyOf(3, "promote")]
  });
  assert.equal(await readFile(join(root, "docs", "qualification", roundFile(1)), "utf8"), hold);
});

test("the signature covers round, supersedes, and supersedesDigest", () => {
  const options = {
    ...REPOSITORY,
    round: 2,
    resolveKeyRef: (reference) => (reference === PUBLIC_KEY_REF ? anchorFor(KEY_PAIR) : null)
  };
  const fields = roundFields(2, decision());
  assert.deepEqual(validateReleaseDecision(decision(fields), VERSION, options), []);
  // A signature over every claim but one is what a verifier blind to that field
  // would accept. It must not verify, so each round field is in the signed bytes.
  for (const field of ["round", "supersedes", "supersedesDigest"])
    assert.deepEqual(
      validateReleaseDecision(decision(fields, KEY_PAIR, field), VERSION, options),
      [`${roundFile(2)}: signature does not verify against publicKeyRef`],
      `${field} must be covered by the signature`
    );
});

test("the committed 1.0.0 hold stays round 1 and still verifies byte for byte", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const source = await readFile(join(root, "docs", "qualification", roundFile(1)), "utf8");
  const reference = /^publicKeyRef: (.*)$/mu.exec(source)?.[1] ?? "";
  assert.match(reference, /^docs\/qualification\/trust\/[\w.-]+\.json$/u);
  const anchor = await readFile(join(root, reference), "utf8");
  const resolveKeyRef = (candidate) => (candidate === reference ? anchor : null);

  assert.equal(/^(?:round|supersedes|supersedesDigest):/mu.test(source), false, "round 1 carries no round fields");
  assert.deepEqual(validateReleaseDecision(source, VERSION, { resolveKeyRef }), []);
  // The same bytes under a round 2 name are refused: the name decides the round.
  assert.ok(
    validateReleaseDecision(source, VERSION, { round: 2, resolveKeyRef }).includes(
      `${roundFile(2)}: frontmatter round nothing disagrees with the filename's round 2`
    )
  );
});

test("the decision filename pattern reads a later round's number and nothing else", () => {
  for (const [name, version, round] of [
    ["release-decision-1.0.0.round-2.md", "1.0.0", "2"],
    ["release-decision-0.0.0-qualification.round-12.md", "0.0.0-qualification", "12"],
    ["release-decision-1.0.0-rc.1.round-3.md", "1.0.0-rc.1", "3"]
  ]) {
    const named = RELEASE_DECISION_FILE.exec(name);
    assert.deepEqual([named?.[1], named?.[2]], [version, round], `must read ${name}`);
  }
  for (const name of [
    "release-decision-1.0.0.round2.md",
    "release-decision-1.0.0-round-2.md",
    "release-decision-1.0.0.round-.md",
    "release-decision-1.0.0.round-2.txt"
  ])
    assert.equal(RELEASE_DECISION_FILE.test(name), false, `must reject ${name}`);
});

// One row per round field a single file must get right. Each fixture is
// otherwise a valid decision, so the named rule is the only thing rejecting it.
for (const [label, round, overrides, expected] of [
  ["round 1 carrying round", 1, { round: "1" }, "round 1 must not carry round;"],
  ["round 1 carrying supersedes", 1, { supersedes: "release-decision-0.9.0.md" }, "round 1 must not carry supersedes;"],
  ["round 1 carrying supersedesDigest", 1, { supersedesDigest: RELEASE_DIGEST }, "must not carry supersedesDigest;"],
  [
    "a frontmatter round the filename does not name",
    2,
    { ...roundFields(2, decision()), round: "3" },
    "frontmatter round 3 disagrees with the filename's round 2"
  ],
  [
    "a later round with no round field",
    2,
    { ...roundFields(2, decision()), round: null },
    "frontmatter round nothing disagrees with the filename's round 2"
  ],
  [
    "round 2 superseding something other than round 1",
    2,
    { ...roundFields(2, decision()), supersedes: "release-decision-1.0.0.round-1.md" },
    "supersedes must name release-decision-1.0.0.md, the immediately previous round"
  ],
  [
    "round 3 superseding round 1 rather than round 2",
    3,
    { ...roundFields(3, decision()), supersedes: roundFile(1) },
    "supersedes must name release-decision-1.0.0.round-2.md, the immediately previous round"
  ],
  [
    "a later round with no supersedes",
    2,
    { ...roundFields(2, decision()), supersedes: null },
    "the immediately previous round, found nothing"
  ],
  [
    "a supersedes digest that is not sha256:<64 hex>",
    2,
    { ...roundFields(2, decision()), supersedesDigest: "sha256:deadbeef" },
    "supersedesDigest must read sha256:<64 hex>"
  ]
]) {
  test(`a release decision round is refused for ${label}`, () => {
    const errors = validateReleaseDecision(decision(overrides), VERSION, { ...REPOSITORY, round });
    assert.equal(errors.length, 1, `expected exactly one error, got ${JSON.stringify(errors)}`);
    assert.ok(errors[0].startsWith(`${roundFile(round)}: `), `the error must name ${roundFile(round)}`);
    assert.ok(errors[0].includes(expected), `expected an error naming "${expected}", got ${errors[0]}`);
  });
}

test("a round suffix outside the convention is refused rather than skipped", async (t) => {
  const { root, candidates } = await roundsFixture(t);
  await writeDecision(root, roundFile(1), decision(boundTo(candidates[0])));
  const promote = decision({ ...boundTo(candidates[1]), decision: "promote" });
  for (const suffix of ["round-1", "round-02", "round2"])
    await writeDecision(root, `release-decision-1.0.0.${suffix}.md`, promote);

  const { decisions, errors } = await readRounds(root);
  const misnumbered =
    "a round suffix must be a number of 2 or more without leading zeros; round 1 is release-decision-1.0.0.md";
  assert.deepEqual(errors.toSorted(byCodeUnit), [
    `release-decision-1.0.0.round-02.md: ${misnumbered}`,
    `release-decision-1.0.0.round-1.md: ${misnumbered}`,
    "release-decision-1.0.0.round2.md: decision file is named outside the release-decision-<version>[.round-<n>].md convention"
  ]);
  assert.equal(decisions.get(VERSION).decision, "reject", "a misnamed promote never takes effect");
});

test("an earlier round edited after the next was signed breaks the next round, even unseen by its signature", async (t) => {
  const { root, candidates } = await roundsFixture(t);
  const hold = decision(boundTo(candidates[0]));
  await writeDecision(root, roundFile(2), laterRound(2, hold, boundTo(candidates[1])));
  // One byte: the space after `decision:` becomes a tab. The parsed claim is
  // unchanged, so round 1's own signature still verifies; only the bytes moved.
  const edited = hold.replace("\ndecision: reject\n", "\ndecision:\treject\n");
  assert.equal(Buffer.byteLength(edited), Buffer.byteLength(hold));
  await writeDecision(root, roundFile(1), edited);

  const { decisions, errors } = await readRounds(root);
  assert.deepEqual(errors, [
    `${roundFile(2)}: supersedesDigest does not match the current bytes of ${roundFile(1)}; an earlier round is never edited`
  ]);
  assert.deepEqual(decisions.get(VERSION), {
    ...effectiveOf(1, "reject"),
    rounds: [historyOf(1, "reject"), historyOf(2, "reject", false)]
  });
});

// One row per succession rule. Round 1 is valid in every row that has one, so
// the rule named is what refuses the later round; `effective` is the round
// still in effect. `hold` gives round 1's fields, or null for no round 1.
const ON_FIRST = ([first]) => boundTo(first);
for (const [label, holdFields, build, expected, effective] of [
  [
    "a gap between rounds",
    ON_FIRST,
    ([, , third], hold) => [[roundFile(3), laterRound(3, hold, boundTo(third))]],
    `${roundFile(3)}: round 2 is missing; a version's rounds run 1, 2, 3 without a gap`,
    1
  ],
  [
    "a later round with no round 1",
    () => null,
    ([first, second]) => [[roundFile(2), laterRound(2, decision(boundTo(first)), boundTo(second))]],
    `${roundFile(2)}: round 1 is missing; a version's rounds run 1, 2, 3 without a gap`,
    null
  ],
  [
    "two files claiming the same later round",
    ON_FIRST,
    ([, second, third], hold) => [
      [roundFile(2), laterRound(2, hold, boundTo(second))],
      [roundFile(3), laterRound(2, hold, boundTo(third))]
    ],
    `${roundFile(3)}: version 1.0.0 already has a decision file for round 2`,
    2
  ],
  [
    "a round that follows a promote",
    ([first]) => ({ ...boundTo(first), decision: "promote" }),
    ([, second], hold) => [[roundFile(2), laterRound(2, hold, boundTo(second))]],
    `${roundFile(2)}: ${roundFile(1)} is a promote; a promote is final, so no round may follow it`,
    1
  ],
  [
    "a decision instant equal to the previous round's",
    ON_FIRST,
    ([, second], hold) => [[roundFile(2), laterRound(2, hold, { ...boundTo(second), decidedAt: ROUND_DECIDED_AT[0] })]],
    `${roundFile(2)}: decidedAt ${ROUND_DECIDED_AT[0]} is not later than ${roundFile(1)}'s ${ROUND_DECIDED_AT[0]}`,
    1
  ],
  [
    "a decision instant earlier than the previous round's",
    ON_FIRST,
    ([, second], hold) => [
      [roundFile(2), laterRound(2, hold, { ...boundTo(second), decidedAt: "2026-08-25T23:59:59Z" })]
    ],
    `${roundFile(2)}: decidedAt 2026-08-25T23:59:59Z is not later than ${roundFile(1)}'s ${ROUND_DECIDED_AT[0]}`,
    1
  ],
  [
    "the previous round's candidate decided again",
    ON_FIRST,
    ([first], hold) => [[roundFile(2), laterRound(2, hold, boundTo(first))]],
    `${roundFile(2)}: candidateRevision is ${roundFile(1)}'s candidate; a later round decides on a fresh candidate`,
    1
  ],
  [
    "a candidate the previous round's candidate is not an ancestor of",
    ([, second]) => boundTo(second),
    ([first], hold) => [[roundFile(2), laterRound(2, hold, boundTo(first))]],
    "does not descend from release-decision-1.0.0.md's candidate",
    1
  ]
]) {
  test(`a release decision round is refused for ${label}`, async (t) => {
    const { root, candidates } = await roundsFixture(t);
    const fields = holdFields(candidates);
    const hold = fields === null ? null : decision(fields);
    if (hold !== null) await writeDecision(root, roundFile(1), hold);
    for (const [file, source] of build(candidates, hold)) await writeDecision(root, file, source);

    const { decisions, errors } = await readRounds(root);
    const refusal = errors.find((problem) => problem.includes(expected));
    assert.ok(refusal !== undefined, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(errors)}`);
    assert.equal(
      errors.some((problem) => problem.startsWith(`${roundFile(1)}: `)),
      false,
      `round 1 stays valid; only the later round is refused, got ${JSON.stringify(errors)}`
    );
    assert.equal(decisions.get(VERSION).round, effective, "a refused round never takes effect");
  });
}
