import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign as signBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import {
  RELEASE_DECISION_FILE,
  readReleaseDecisions,
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

const decision = (overrides = {}, signWith = KEY_PAIR) => {
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
  if (!Object.prototype.hasOwnProperty.call(overrides, "signature")) fields.signature = signDecision(fields, signWith);
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

test("a version may have at most one decision file", async (t) => {
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
