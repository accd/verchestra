---
schema: verchestra-feature-handoff/v1
feature: release-decision
issue: 18
status: verification
branch: docs/t77-validation-decision
baseRevision: 3d363f782bad40e5c5be8252e6626216b4f60248
lastCompletedTask: T6
nextTask: "T7 — ratify the canonical decision body definition in prepared-decision.md section 4.1, then extend the validator to verify the signature; T8 — provision the decision signing key, obtain both reviews, sign docs/qualification/release-decision-1.0.0.md, and open the pull request that carries it."
lastGate: "gate:quick PASS, agent:check PASS, site:test PASS on this branch; the candidate's own evidence is run 32967293127 — five targets x five gate profiles, all pass at 3d363f78"
updatedAt: 2026-08-26T00:00:00Z
---

# Scope

RD-01 through RD-06 in `spec.md`. Enforcement for
`docs/qualification/RELEASE-DECISION-CONTRACT.md`, and a prepared 1.0.0 decision
whose every machine-derivable value is computed and reproducible.

Out of scope, deliberately: creating `docs/qualification/release-decision-1.0.0.md`.
An unsigned decision file would assert a decision nobody made, and the validator
added here refuses it.

# Completed Evidence

- `scripts/agent-readiness.mjs` — `validateReleaseDecision` and
  `readReleaseDecisions` implement the contract's fail-closed table;
  `checkReleaseDecisions` wires them into `checkRepository` beside
  `checkQualificationChain`, so `pnpm agent:check` is the single command that
  enforces both evidence contracts over `docs/qualification/`. `revisionTrust`
  was extracted so report and decision reachability read the same Git facts
  through one helper rather than two implementations that can drift.
- `tests/agent-readiness/release-decision.test.mjs` — 45 cases, one per
  fail-closed dimension, plus four that need real Git history: side-ref
  reachability, the register digest and count read from Git, an absent register,
  and the at-most-one-file-per-version rule. Every fixture is synthetic.
- `prepared-decision.md` — every derived value with its reproducing command, the
  five per-target release digests and the reconciled closure digest, the pending
  human fields, the signing procedure, the ranked reasons for `reject`, and the
  concrete ask for each reviewer.
- `docs/qualification/t77-validation.md` — the T77 report bound to
  `3d363f782bad40e5c5be8252e6626216b4f60248`, carrying the per-leg gate table
  from candidate run 32967293127 and the twelve-mutation discrimination sensor.

# Next Exact Action

T7: take `prepared-decision.md` section 4.1 to the owner for ratification of the
canonical decision body — which bytes the signature covers. Once ratified, extend
`validateReleaseDecision` to resolve `publicKeyRef` against
`docs/qualification/trust/` and verify the Ed25519 signature over that body, with
a synthetic-key test per failure mode, and update `tasks.md` section 5 to record
the gap as closed.

Do not author `docs/qualification/release-decision-1.0.0.md` before T8's human
acts have happened.

# Blockers

None for T7. T8 is blocked on people, not on the repository: the contract
requires an operational reviewer and a security reviewer, both distinct from the
deciding human and from the implementation author, and `docs/merge-governance.md`
records that no configuration produces an independent reviewer for the
maintainer's own pull requests. That is limitation L1 in
`docs/qualification/acceptance-matrix.md`, and it is reason 1 in
`prepared-decision.md` section 5 for why the verdict is `reject`.

# Decisions

- The decision file is created by the signing step, by the human who signs it.
  Preparing an unsigned one would be a claim nobody made.
- Enforcement lives in `scripts/agent-readiness.mjs` and `pnpm agent:check`, not
  in a new script or gate, because the report contract is already enforced there
  and two mechanisms for two evidence contracts over the same directory would
  drift.
- `gates` for a decision must be exactly `pnpm gate:release`. A broader set that
  merely includes it still names a gate the contract does not admit, and is
  refused.
- The signature is checked for presence and not verified, and that is recorded as
  an open gap in three places rather than left implicit. Verifying it requires
  ratifying which bytes are signed, which is the owner's call.
- `candidateReleaseDigest` is recorded as the reconciled five-target closure
  digest, because a five-target candidate has five per-target release digests and
  the contract's field is singular. The contract question is raised in
  `prepared-decision.md` section 2 rather than settled here.
- Every reviewer and signer identity is left unset. The session that prepared
  this is not any of the three humans the decision names.

# Files Intentionally Left Unchanged

`docs/qualification/RELEASE-DECISION-CONTRACT.md` — it is the canonical contract;
this feature implements it and does not edit it.
`docs/qualification/acceptance-matrix.md` — the enumeration T77 consumes, bound
at its own revision and cited rather than rewritten.
`scripts/requirements-trace.mjs` and `docs/requirements-register.json` — the
closure denominator, used as-is.
