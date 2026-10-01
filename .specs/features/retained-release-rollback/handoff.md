---
schema: verchestra-feature-handoff/v1
feature: retained-release-rollback
issue: 393
status: verification
branch: feat/393-retained-release-rollback
baseRevision: ac7021bd8b45a29ea636d30cd020196675eef7f4
lastCompletedTask: T5
nextTask: "Human review of AD-036 and this change. After merge, the owner publishes two same-root releases built from a revision carrying it (each with a strictly greater metadataVersion) and runs the live-activation matrix (T6)."
lastGate: "pnpm gate:quick, gate:build, gate:security, gate:release, test:e2e, test:fault, agent:check"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Issue #393: after a successful update, re-invoking the base launcher is a TUF
metadata downgrade that anti-rollback refuses. Requirements RR-01 to RR-08 in
`spec.md`; decision AD-036 in `.specs/STATE.md`; threat model and pre-mortem in
`design.md`.

# Completed Evidence

- T1: `design.md` threat model, residual risks R1–R3, pre-mortem PM1–PM11;
  AD-036 recorded as proposed.
- T2–T4: verified-release record under `<installRoot>/verified/`, trust-bound
  `rollback` with a `rollback` journal, `retainedRelease` lookup,
  `TufUpdateClient.trustAnchored()`, and the closure's retained path. Evidence
  mapped per requirement in `validation.md`.
- T5: the live-activation workflow documents both rollback mechanisms and fails a
  leg unless update moved the active pointer and rollback restored it; J02/L7,
  the `.3` runbook, and the launcher README describe the deterministic state
  only.
- Discrimination: the #393 launcher test fails against the `origin/main` closure.

# Next Exact Action

Submit for independent review. Reviewers should check AD-036's residual risks
(no revocation or expiry check for a superseded retained release) and the new
workflow pointer check, which makes the live `rollback` phase stricter.

# Blockers

None for review. The live demonstration (T6) is owner-gated: signing keys,
publication, and npm 2FA.

# Decisions

- Only a *superseded* retained release takes the local path; the latest
  verified release under a root keeps the network path (preserves expiry and
  revocation for the steady state).
- Records are keyed by trust-root digest and written only by a TUF-verified
  `activate` given the digest; `rollback` never writes one.
- A failed local re-activation throws; it never falls back to the network.
- An unbound `rollback(digest)` keeps its existing operator semantics; it now
  also journals the pointer switch.

# Files Intentionally Left Unchanged

- `apps/site/src/content/docs/docs/install-and-run.md`: it documents the
  published `0.0.0-qualification`, which does not carry this path.
- `docs/qualification/t76-validation.md` and the live-matrix `validation.md`:
  dated records of runs that did not exercise this path.
- The TUF client's refresh, caching, and version comparison: unchanged by design.
