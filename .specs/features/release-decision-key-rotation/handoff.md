---
schema: verchestra-feature-handoff/v1
feature: release-decision-key-rotation
issue: null
status: verification
branch: feat/release-decision-key-rotation
baseRevision: 8e46231aac45c4aaad05396205c5f27946a8d30e
lastCompletedTask: T1
nextTask: "Owner runs the rotate-and-sign script on this branch and stores the new private key in the password manager; then human review and merge."
lastGate: "gate:quick and agent:check PASS before the owner run; dry run with a throwaway key verified the record and the 1.0.0 decision"
updatedAt: 2026-10-29T23:00:00Z
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
