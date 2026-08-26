# Release Decision Specification

Issue: #18 (T77)

This feature covers the two things T77 needs that did not exist: enforcement for
`docs/qualification/RELEASE-DECISION-CONTRACT.md`, and a prepared decision whose
every machine-derivable value is already computed so that the accountable human
signs a fact rather than a draft.

It deliberately does **not** cover authoring
`docs/qualification/release-decision-1.0.0.md`. That file is created by the
signing step in `prepared-decision.md`, by the human who signs it. An unsigned
decision file would assert a decision nobody made, and the validator added here
would refuse it anyway.

## Requirements

- **RD-01** — `agent:check` enforces every fail-closed condition in
  `RELEASE-DECISION-CONTRACT.md` for any file named
  `docs/qualification/release-decision-<version>.md`: at most one file per
  version; the exact schema; a verdict in `{promote, reject}`; a
  `candidateRevision` that `git cat-file` proves exists and
  `git merge-base --is-ancestor` proves is reachable from the trusted target;
  `gateRevision` equal to `candidateRevision`; a `candidateReleaseDigest` of the
  form `sha256:<64 hex>`; a `requirementsRegister` equal to the actual sha256 of
  `docs/requirements-register.json` at that revision; a `requirementsClosed`
  string in the exact form `<n> of <n> requirements evidenced` whose `n` is the
  register's real count at that revision; `gates` and `gateResults` naming
  `gate:release` and nothing else, with every result `pass`; `skipped`, `todo`,
  and `survivingMutants` all `0`; every task in `qualificationReports` carrying a
  qualification report that satisfies `REPORT-CONTRACT.md`; three present and
  mutually distinct identities in `operationalReviewer`, `securityReviewer`, and
  `decidedBy`; an RFC 3339 UTC `decidedAt`; a present `signature` and
  `publicKeyRef`; and a `reviewedIn` pull request URL.
- **RD-02** — The absence of a decision file is not a failure. A repository that
  has not decided must not read as one that decided badly.
- **RD-03** — Enforcement lives in the module and command that already enforce
  `REPORT-CONTRACT.md` (`scripts/agent-readiness.mjs`, surfaced by
  `pnpm agent:check`), in the same error style, with no parallel mechanism and no
  new gate.
- **RD-04** — Every fail-closed dimension of RD-01 has a behavior test in which a
  fixture violating exactly that dimension is rejected and the otherwise
  identical valid fixture is accepted. Every fixture is synthetic: no real
  signature, key, or reviewer identity appears in one.
- **RD-05** — Every machine-derivable value the 1.0 decision needs is computed
  from the repository and the candidate build at the bound revision and recorded
  with the command that reproduces it, so no value in the eventual decision is
  retyped from memory.
- **RD-06** — The signing procedure is exact and copy-pasteable, reuses the
  evidence-key custody pattern this repository already operates (PKCS#8 held in a
  named environment variable, injected in one step, never printed and never
  committed), and contains no key material and no machine-local path.

## Acceptance criteria

1. A decision fixture violating any single condition in RD-01 is rejected by
   `validateReleaseDecision`, naming that condition, and the otherwise identical
   valid fixture is accepted.
2. `pnpm agent:check` passes on a repository with no decision file, and fails
   with a decision file that violates the contract.
3. `docs/qualification/release-decision-<version>.md` is discovered by the same
   command that discovers qualification reports, and a supporting document in
   `docs/qualification/` that is not a decision stays silent.
4. Every value in `prepared-decision.md` marked *derived* is reproducible by
   running the command printed beside it, and every value marked *pending* names
   the human act that supplies it.
5. The ranked reasons for the recorded decision each cite a tracked file by path,
   and each names what would have to change for the reason to be lifted.
6. The signing procedure is exact, has been executed end to end with a throwaway
   key rather than only written, reuses the existing evidence-key custody
   pattern, and runs on every platform the repository supports.
7. No tracked file added by this feature contains a secret-like value, a
   machine-local path, or a real signature or key.

## Safety and authority

- Nothing here signs, promotes, or publishes. The validator reads; the prepared
  decision is a document.
- The three identities the decision names are supplied by the humans who act.
  This feature never writes an identity into a signed field on their behalf, and
  no artifact it produces claims a review that has not happened.
- The signing key is provisioned and held by the accountable human. No procedure
  in this feature reads, prints, echoes, or stores key material, and no command
  it prescribes writes a key to the repository.
- `RELEASE-DECISION-CONTRACT.md` is the canonical statement of the contract.
  This specification does not extend it, and where the two disagree the contract
  governs and the code follows it.

## What this feature does not establish

Enforcement here proves that three distinct identities are named, that the
signature and key reference are present, and that the decision binds to trusted
history and to the reviewed register. It does **not** verify the signature
cryptographically, and does not resolve `publicKeyRef` to a key. That is a
documented condition in the contract's fail-closed table that this validator
does not yet enforce; it is recorded as an open gap in `tasks.md` rather than
implied to be covered, because a check that reads as enforcement while enforcing
nothing is the failure `REPORT-CONTRACT.md` already names.
