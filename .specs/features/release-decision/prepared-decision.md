# The prepared 1.0.0 release decision

Everything a machine can compute is computed here, with the command that
reproduces it. Everything only a human can supply is marked **pending** and names
the act that supplies it. Nothing in this file is signed, and nothing in it
records a decision that has been taken.

Bound candidate revision: `3d363f782bad40e5c5be8252e6626216b4f60248`.

---

## 1. Derived values

Every row was produced by running the command shown, in a clean checkout of the
bound revision, on `win32-x64` with Node `v24.14.0`, on 2026-08-26.

| Field | Value | How it was obtained |
| --- | --- | --- |
| `schema` | `verchestra-release-decision/v1` | `RELEASE-DECISION-CONTRACT.md` |
| `version` | `1.0.0` | The version under decision |
| `candidateRevision` | `3d363f782bad40e5c5be8252e6626216b4f60248` | `git rev-parse origin/main` at dispatch; the candidate build checked out this exact SHA and refused to proceed otherwise |
| `candidateReleaseDigest` | `sha256:0572d5d7832af2981b042861ed28cebd2870d5cc2a3bcb2be252866755989f63` | The `digest` field of `t76-target-index.json`, the reconciled five-target closure uploaded by the `collect` job of candidate run 32967293127. See section 2 for why this is the digest and not one of the five per-target values. |
| `requirementsRegister` | `e81e066ad0c1bf30f90e150f57502ea17f036edbb3cecf1e7c5a437adbd54907` | `git cat-file -p 3d363f78:docs/requirements-register.json \| sha256sum` |
| `requirementsClosed` | `93 of 93 requirements evidenced` | `node scripts/requirements-trace.mjs` → `registered: 93`, `referenced: 93`, `declared gaps: 0`, `T77 closure MET` |
| `qualificationReports` | `T69, T70, T71, T72, T73, T74, T75, T76, T77` | The roadmap chain segment after the inserted T68a–T68d hardening tasks; each has a report in `docs/qualification/` that `agent:check` counts |
| `gates` | `pnpm gate:release` | The only gate the contract admits for this decision |
| `gateResults` | `pass` | Candidate run 32967293127, `gate:release PASS` on all five target legs |
| `gateRevision` | `3d363f782bad40e5c5be8252e6626216b4f60248` | Equal to `candidateRevision` by construction: the workflow refuses a checkout that is not at the requested SHA |
| `skipped` | `0` | 94,580 test results across the five legs; `skipped 0` on every one |
| `todo` | `0` | Same source; `todo 0` on every leg |
| `survivingMutants` | `0` | `docs/qualification/t77-validation.md`, twelve mutations introduced and killed, zero survivors |

### Reproducing them

```bash
git rev-parse 3d363f782bad40e5c5be8252e6626216b4f60248^{commit}
git merge-base --is-ancestor 3d363f782bad40e5c5be8252e6626216b4f60248 origin/main && echo reachable
git cat-file -p 3d363f782bad40e5c5be8252e6626216b4f60248:docs/requirements-register.json | sha256sum
node scripts/requirements-trace.mjs
gh run view 32967293127 --repo accd/verchestra --json status,conclusion,jobs
gh run download 32967293127 --repo accd/verchestra \
  --name t76-target-index-3d363f782bad40e5c5be8252e6626216b4f60248-32967293127
```

## 2. The candidate release digest is the reconciled closure digest

A five-target candidate has **five** release digests, one per target bundle, so
the contract's singular `candidateReleaseDigest: sha256:<64 hex>` has no
single-target value to take. The one value that covers the whole candidate is
the reconciled index's own digest, which is computed over the canonical form of
all five target evidence records and therefore changes if any of them changes.

Release identity, common to all five: `release:verchestra:0.0.0-qualification:3d363f782bad`.
Component count, identical on all five: `194`.

| Target | `releaseDigest` |
| --- | --- |
| `darwin-arm64` | `sha256:22e0f2e6c74d03edcdf1a9d558bea1f122bca159713b6e640090cbf5b662c59e` |
| `darwin-x64` | `sha256:33fc6686c44e23c5b25add35d2829a8b0237d379f8ba8cc84c1a4828f68d9d1b` |
| `linux-arm64` | `sha256:9aa3de641f25f3feba26634ed54cda5b43dcf8aa4664a4393a9c5fd55a628d3e` |
| `linux-x64` | `sha256:73008860059df7d21178b8c0554f6216ea5f93cedd1972e16dc8130e1559f1eb` |
| `win32-x64` | `sha256:f2fb3303264939e7b2dc5e075be9611485ec2df51c8575ccaca03bbc74e16697` |

All five legs sealed a **byte-identical** gate-evidence digest,
`sha256:bf9743df82b764f2a2ac21c9613e7ba9425f1322c542f360496ef0180c59a0d0`, which
is what proves the five legs ran the same closed gate set with the same counters
rather than five separately-passing variants.

**Finding for the owner.** `RELEASE-DECISION-CONTRACT.md`'s frontmatter template
assumes a single release digest. Either the field means the reconciled closure
digest, as recorded above, or the contract should carry five per-target digests.
This is a contract question, not something this preparation may settle, and the
validator added for RD-01 only checks the field's shape, not which of the two
readings it holds.

## 3. Pending values — the human acts that supply them

| Field | Supplied by | State |
| --- | --- | --- |
| `decision` | The accountable human | The owner has stated the intended verdict is `reject` — a recorded hold, not a promotion. The contract records rejection identically to promotion. |
| `operationalReviewer` | The operational reviewer | **Pending.** Not performed. |
| `securityReviewer` | The security reviewer | **Pending.** Not performed. |
| `decidedBy` | The accountable human | **Pending.** Must differ from both reviewers. |
| `decidedAt` | The signing step | **Pending.** RFC 3339 UTC instant of signature. |
| `signature` | The signing step | **Pending.** See section 4. |
| `publicKeyRef` | The key provisioning step | **Pending.** See section 4. |
| `reviewedIn` | The pull request that carries the decision | **Pending.** |

No identity is written into this repository for any of these fields by the
session that prepared this document. Three humans are expected to act, and none
of them is that session.

## 4. Signing procedure

This reuses the custody pattern the repository already operates for T75
qualification evidence — an Ed25519 private key held as base64 PKCS#8 in one
named environment variable, injected into exactly one step, never printed, never
written to a file, never committed — and its committed-public-reference
convention under `docs/qualification/trust/`.

It does **not** reuse `scripts/t75-evidence-attestation.mjs`, which is bound to
the T75 evidence-index schema and cannot sign a decision body.

### 4.1 What is signed

The canonical decision body is proposed as the canonical JSON projection of the
decision frontmatter with the `signature` field removed, plus the sha256 of the
Markdown body. That mirrors how the T75 evidence index excludes its own
`bodyDigest` and `signingState` from the bytes it signs, and it makes the
signature cover the decision's claims rather than only its prose.

**This definition is a proposal and needs the owner's ratification.** Until it is
ratified and the validator verifies against it, `signature` is checked for
presence only, and section 5 of `tasks.md` records that as an open gap.

### 4.2 Provision the key and commit its public reference

The private half is generated straight into the environment variable and never
touches disk, so there is no key file to forget to delete. Only the public half
is ever printed. Both commands use `openssl` alone, so they run the same way in
Git Bash on Windows as on Linux or macOS.

```bash
export VESTRA_RELEASE_DECISION_SIGNING_KEY_PKCS8_BASE64="$(openssl genpkey -algorithm ed25519 -outform DER | openssl base64 -A)"

# The public half, base64url SPKI, derived from the private key already held in
# the variable. This is the only value the command prints.
printf '%s' "$VESTRA_RELEASE_DECISION_SIGNING_KEY_PKCS8_BASE64" \
  | openssl base64 -d -A \
  | openssl pkey -inform DER -pubout -outform DER \
  | openssl base64 -A | tr '+/' '-_' | tr -d '='
```

Commit the public half as `docs/qualification/trust/release-decision-public-key.json`,
in the shape the existing trust files use:

```json
{
  "algorithm": "Ed25519",
  "encoding": "spki-der-base64url",
  "keyId": "release-decision-<YYYYMMDD>",
  "publicKey": "<the base64url SPKI from the command above>",
  "purposes": ["release-decision"]
}
```

`publicKeyRef` in the decision is then that committed path.

### 4.3 Sign

Run from the repository root, in the same shell that still holds the variable
from 4.2.

```bash
node --input-type=module <<'NODE'
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalizeJsonV2 } from "./packages/domain/src/index.ts";

const path = "docs/qualification/release-decision-1.0.0.md";
const source = await readFile(path, "utf8");
const parsed = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
if (parsed === null) throw new Error("decision has no frontmatter");
const fields = {};
for (const line of parsed[1].split(/\r?\n/u)) {
  const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
  if (field === null) throw new Error("malformed frontmatter line");
  if (field[1] !== "signature") fields[field[1]] = field[2].trim();
}
const body = {
  claims: fields,
  bodyDigest: `sha256:${createHash("sha256").update(parsed[2], "utf8").digest("hex")}`
};
const key = createPrivateKey({
  key: Buffer.from(process.env.VESTRA_RELEASE_DECISION_SIGNING_KEY_PKCS8_BASE64, "base64"),
  format: "der",
  type: "pkcs8"
});
process.stdout.write(`${sign(null, Buffer.from(canonicalizeJsonV2(body), "utf8"), key).toString("base64url")}\n`);
NODE
unset VESTRA_RELEASE_DECISION_SIGNING_KEY_PKCS8_BASE64
```

Paste the single line it prints into the decision's `signature` field. The
private key is never echoed by any command above, never written to any file, and
leaves no trace once the shell exits or the variable is unset. If the key is to
survive the shell, put it in the repository's GitHub secret store under the same
name and read it back through `env:` in one workflow step, exactly as
`.github/workflows/t75-evidence-signing.yml` does for the T75 evidence key —
never into a file under the repository.

### 4.4 The procedure was executed, not just written

Both commands above were run end to end on `win32-x64` in Git Bash, with a
throwaway Ed25519 key generated for the purpose and a synthetic decision fixture
outside the repository: 4.2 printed a `spki-der-base64url` public half, and 4.3
printed one base64url signature line. The key and the fixture were discarded, and
neither the key, the public half, nor that signature appears in any tracked file
— a real-looking signature in a specification would read as a decision that was
signed.

### 4.5 Verify before opening the pull request

```bash
pnpm agent:check
node scripts/requirements-trace.mjs
```

## 5. Why `reject` is the correct decision now

Ranked by what would have to change to lift each reason — hardest first. Every
row cites a tracked file, and the limitation identifiers are those of
`docs/qualification/acceptance-matrix.md` section 4.

| # | Reason | Cited record | What would have to change |
| --- | --- | --- | --- |
| 1 | **No independent verifier or second reviewer exists, and none is obtainable by configuration.** The contract requires an operational and a security reviewer, both distinct from the deciding human and from the implementation author. | L1; `docs/merge-governance.md` "no configuration produces one"; `t75-validation.md`, `t76-validation.md` both decline to claim independence | A second and third human with repository access who did not author the implementation. This is an organisational change, not a repository change, and it is the reason the decision cannot be `promote` regardless of the evidence. |
| 2 | **Independent verification runs in the same process.** `IndependentVerificationCoordinator` is same-runtime today. | L14; `docs/audits/2026-08-verchestra-product-repository-audit.md`; #35 | A process or host boundary for the verifier. Product work, tracked. |
| 3 | **`doctor` can never report `PASS`.** `releaseDigest` is protocol-null on both the sealed and the source path, so at least one check is permanently `blocked`, in a released bundle exactly as in a checkout — and no tracked file says so. | L2, L13; `release-manifest.ts`, `doctor-composition.ts`, `doctor-facts.ts`, `doctor.ts` | A protocol change that gives a sealed release a non-circular release digest, or an accepted permanently-`BLOCKED` verdict stated in the product documentation. A 1.0 that promises a working diagnostic cannot ship with neither. |
| 4 | **The published package carries a known `self-test` defect** that fires in the default Windows home directory, which is the default location for the one-command demo. | L5; `README.md`; #370; `.specs/features/npx-launcher/handoff.md` | The fix, plus a republished candidate. Until republication the artifact on the public registry is not the artifact a 1.0 would promote. |
| 5 | **Single-operator custody of the signing keys and the storage endpoint.** One operator, one bucket, one npm account; no rotation across operators and no second endpoint. | L8; `t75-validation.md`, `t76-validation.md`; `docs/merge-governance.md` bypass record | Key custody split across operators and a second endpoint. Operational change. |
| 6 | **The sealed-holdout promotion gate shares a process with the candidate**, and contamination is a supplied fact rather than an observed one. | L11; `t74-validation.md` AD-018; `.specs/features/sealed-holdout/handoff.md` PROM-05; #235 | Process and storage isolation plus an observed contamination detector. Explicitly deferred to post-1.0. |
| 7 | **Live coverage is two of five targets.** Deterministic five-profile gates ran on all five; live activation was recorded on `win32-x64` and `linux-x64` only, and no live update, rollback, or disaster recovery has been performed at all. | L7; matrix J01, J02, J10 | Live activation on the three remaining targets and one executed update/rollback and recovery run. Operator work, not a code change. |
| 8 | **Seven of eight database engines are contract-qualified, not live.** Only SQLite is live-qualified. | L4; `platform-qualification-matrix/matrix.json`; AD-017 | Live instances for the remaining seven, or an explicit 1.0 scope that names SQLite alone. |
| 9 | **Two isolation grades are unqualified and vector search is qualified on two platforms.** `native-restricted` and `container-isolated` are `not-qualified`; macOS, ARM, and unknown platforms degrade to lexical-only retrieval. | L10, L9; `docs/qualification/isolation.md`, `docs/qualification/sqlite.md` | Qualification runs for those grades and platforms, or a stated 1.0 capability scope. |
| 10 | **The four TUF source modes are not proven by cross-adapter equivalence**, and the hardening that would prove it is deliberately excluded from the bound revision's evidence. | L6; `t76-validation.md` "Recorded limitation" | Landing the cross-adapter equivalence test and rebuilding a candidate on top of it. |
| 11 | **Probabilistic regression campaigns use frozen sequences** and do not claim a live provider was sampled. | L12; `t73-validation.md` | Live-provider sampling, or a 1.0 claim scoped to frozen corpora. |
| 12 | **Tracked records contradict each other.** Several feature handoffs still read `in_progress` or `blocked` after their reports recorded PASS, and the `#58` canonical-JSON record is internally inconsistent. L19 is stale in the opposite direction: `apps/site/src/data/product.ts` reads `installable: true` at this revision, and it is `.specs/features/npx-launcher/handoff.md:296-303` that still describes the old value. | L17, L18, L19 | A reconciliation pass. Cheap, and it is the only row on this list a documentation change can close — which is why it is last, not first. |

Rows 1 and 3 are the ones that make `reject` the only honest verdict: the first
because the contract's reviewer requirement cannot be satisfied at all today, the
third because it is a promise a 1.0 would be making that the product does not
keep. Everything below them is disclosable rather than disqualifying, and would
belong in a promotion's limitations section if rows 1 and 3 ever clear.

## 6. What the two reviewers are being asked to review

Both reviewers are asked for a judgement on the same bound revision,
`3d363f782bad40e5c5be8252e6626216b4f60248`, and both are asked to record it in
the pull request that carries the decision.

**Operational reviewer.** Whether the evidence supports the recorded verdict for
the product a user would install and operate.

- `docs/qualification/acceptance-matrix.md` — the twelve journeys, their proof
  suites, and the honest qualifications on J01, J02, J07, J08, J09, J10, J11.
- `docs/qualification/t77-validation.md` — this task's gates, closure statement,
  discrimination sensor, and verdict.
- `docs/qualification/t76-validation.md` — the live publication, activation, and
  registry evidence, and its recorded limitation.
- Candidate run <https://github.com/accd/verchestra/actions/runs/32967293127> —
  five legs, five gate profiles each, at the bound revision.
- Sections 5 rows 3, 4, 7, 8, 9, 11 above — the operational limitations.
- The specific question: *is any row in section 5 mis-ranked, and is any journey
  in the matrix claimed as proven on evidence that does not support it?*

**Security reviewer.** Whether the trust, custody, and authority boundaries hold
for a version being decided on.

- `docs/qualification/t75-validation.md` — the signed evidence index and its
  protected custody.
- `docs/merge-governance.md` — the ruleset, the single permanent bypass actor,
  and the record that independent review is unobtainable for the maintainer's own
  pull requests.
- `docs/qualification/RELEASE-DECISION-CONTRACT.md` together with the enforcement
  added by this feature, and the open gap in `tasks.md` section 5: the signature
  is checked for presence, not verified.
- Sections 4 and 5 rows 1, 2, 5, 6 above — custody, isolation, and independence.
- The specific question: *does anything in this decision read as enforcement
  while enforcing nothing, and is the proposed canonical-body definition in
  section 4.1 sufficient to bind the claims the decision makes?*

Neither reviewer is being asked to approve a promotion. The verdict on the table
is a recorded hold.
