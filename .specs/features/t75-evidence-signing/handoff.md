---
schema: verchestra-feature-handoff/v1
feature: t75-evidence-signing
issue: 294
status: complete
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T3
nextTask: "No further action for this feature: the owner-provisioned key signed the T75 evidence index and the attestation was verified outside the producing run (docs/qualification/t75-validation.md:65-73). Independent human verification of future qualification evidence is owned by #408."
lastGate: "T75 report docs/qualification/t75-validation.md (reviewed in PR #354) records signed: true and external verification; agent:check PASS at 20071a7"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Issue #294 adds a T75-specific signing path around the existing canonical
evidence index. It does not replace release metadata, test-only artifact
signers, or the existing DSSE migration.

# Decision

Release qualification uses a repository-owner-provisioned PKCS#8 Ed25519 key
only through a protected GitHub Actions secret. A committed public `PublicKeyRef`
must match the public key derived from that private material before signing.
The trusted output is a DSSE envelope with an in-toto
`qualification-evidence-index` predicate; a separate verifier checks it using
only the public reference and index.

# Completed implementation

T1 provides a closed predicate registry plus a signer and public verifier. The
signer accepts private material only through the protected workflow environment,
derives its public identity, and rejects any mismatch with the committed
`PublicKeyRef` before producing output. T2 regenerates the unsigned canonical
index from all five profile artifacts at the requested revision, rejects
contradictions, verifies the result before publishing, and exposes only public
verification artifacts.

# Reconciliation (2026-09-29, #407)

The blocker below is resolved. It is kept as it was written on 2026-08-23.

- **The owner committed the public reference in `84ae20a`.** The file is
  `docs/qualification/trust/t75-evidence-public-key.json`, and no private
  material is tracked.
- **The signed attestation was committed in `11f9318`.**
  `.specs/features/platform-qualification-matrix/signed-evidence-index.json`
  has `signingState.signed: true` and key id `t75-evidence-20260825`. Its DSSE
  envelope is `qualification-evidence-index.dsse.json`. Both are bound to
  revision `be92397ca0a5caaf7ff8b70dad23659b09899d7d`.
- **`docs/qualification/t75-validation.md:65-73` records the external
  verification.** The index is `signed: true`, and the attestation was verified
  outside the run that produced it, from the committed public key.
  `docs/qualification/acceptance-matrix.md` L16 marks this resolved.
- **What is not claimed.** `t75-validation.md` states that no independent
  verifier distinct from the implementation author reviewed T75. The report
  itself was reviewed in PR #354. Independent human custody for a future
  promotion round is owned by #408. It is not outstanding work for this
  signing feature.
- **Transition note.** The status moves from `blocked` to `complete` in one
  reconciliation. The verification step that `verification` would have
  represented is the T75 report above.

# Blockers (historical, 2026-08-23 — resolved, see Reconciliation)

The implementation is merged in PR #303 and the issue is closed, but the
qualification path is blocked until the owner provisions the protected secret
and commits the matching public reference through human review. The public
reference is intentionally absent until that action, so the workflow cannot
produce a real attestation yet. Automation must not generate, access, print,
or commit either private material or any secret value.
