---
schema: verchestra-feature-handoff/v1
feature: release-decision-key-rotation
issue: null
status: complete
branch: feat/release-decision-key-rotation
baseRevision: 8e46231aac45c4aaad05396205c5f27946a8d30e
lastCompletedTask: T2
nextTask: "None. Merged by the owner on 2026-10-29 as d3c64cce (#701) after the required checks passed on the exact head; no independent review is recorded (#553). The owner signed the exit record again for .9 with the new key on 2026-10-30."
lastGate: "gate:quick and agent:check PASS before the owner run; dry run with a throwaway key verified the record and the 1.0.0 decision"
updatedAt: 2026-11-03T15:50:00Z
---

# Scope

The owner could not find the 2026-08-28 release-decision private key, so the
qualification-line exit record could not be signed. This change rotates that
key as `docs/release-custody.md` 7.4 describes and signs the record with the
new key.

# What changes

- `scripts/agent-readiness.mjs`: a decision or exit record still names the
  role's file in `publicKeyRef`. The verifier now also accepts a signature from
  a retired anchor under `docs/qualification/trust/retired/` that has the same
  purpose and whose `validUntil` is after the record's `decidedAt`. Without this,
  rotating the key would break the signed `release-decision-1.0.0.md`, which
  cannot be edited. The window rule is the one `t75-evidence-attestation.mjs`
  applies to a retired evidence key.
- `docs/qualification/trust/retired/release-decision-20260828.json`: the old
  anchor, unchanged except for `validUntil`.
- `docs/qualification/trust/release-decision-public-key.json`: the new key,
  `release-decision-20261029`.
- `docs/qualification/qualification-line-exit-record.md`: `decidedAt` and
  `signature`, signed with the new key.

# Evidence

- `tests/agent-readiness/version-line-record.test.mjs`: "a record signed by a
  retired key verifies only inside the key's window" (inside verifies; at
  `validUntil` and with another purpose it does not; the active key is
  unaffected). The test fails when the resolver returns the active anchor
  alone. "only a same-purpose retired anchor whose window covers the instant
  is a candidate" pins the selection.
- `tests/security/trust-key-separation.test.mjs`: the retired decision key is
  in the set that may never shrink.
- A dry run with a throwaway key in a disposable worktree: `agent:check` PASS
  with no unsigned warning, so the record verified under the new key and the
  1.0.0 decision under the retired one. The throwaway key was discarded.

# Known risks

- A holder of the lost key could still sign a backdated decision (a
  `decidedAt` before 2026-10-29T22:xx). The key is lost, not known to be
  compromised, and a decision only takes effect through a reviewed pull
  request. This is the same bound T75 accepts for a retired evidence key.
- No independent reviewer exists (L1); the owner reviews and merges.

# Reconciliation (2026-11-03)

Merged to `main` through #701 on 2026-10-29 as `d3c64cce`, by rebase
through the maintainer bypass, after every required check passed on the
exact head `e10ad10e`. The owner's is the only review; #553 governs a
post-merge independent review. Nothing is left in this feature.

The owner signed `docs/qualification/qualification-line-exit-record.md`
again for `.9` with the new key at 2026-10-30T21:09:54Z. On `031e032d`,
`pnpm agent:check` verifies the record under the active key and the 1.0.0
decision under the retired one, with no warning.
