---
schema: verchestra-feature-handoff/v1
feature: dsse-attestation
issue: 217
status: in_progress
branch: main
baseRevision: 1f21582850ec48973794e3cb7f6c11f0531c97e5
lastCompletedTask: T3
nextTask: none
lastGate: null
updatedAt: 2026-08-09T16:00:00Z
---

# Scope

Adopt DSSE + in-toto as the Verchestra signature envelope before 1.0 (review
item R5, issue #217). **The decision is made** — Option A, recorded as
**AD-014** in `.specs/STATE.md` on 2026-08-09. This feature now carries the
implementation, specified in `migration.md`, which must land before T76
(#17) qualification starts.

# Completed Evidence

- **T1 (decision) — DONE.** Owner chose Option A on 2026-08-09 against
  measured evidence at `1f21582`: a single signing choke point
  (`ArtifactSealer.seal` 8 call sites / `.verify` 5 call sites over one
  `NodeEd25519Signer.sign`), 8 sealed artifact kinds, no installed base
  (so DSSE-02/DSSE-03 are at their minimum cost), and a
  `provenance.intoto.jsonl` bundle slot that nothing produces. Recorded as
  AD-014 (DSSE-01 satisfied).
- **DSSE-02 satisfied** by `migration.md`: target envelope + PAE, the
  in-toto Statement mapping, the eight exact predicate type URIs, the
  pre-decision artifact inventory and its fail-closed rule, and a seven-step
  fixture/contract-test migration plan.

# T2 — DSSE migration IMPLEMENTED (2026-08-09)

All seven steps of `migration.md` are done in one coherent change:
envelope + PAE + Statement (`integrity/dsse.ts`), sealer rewritten, the four
structural re-validation blocks migrated, fixtures and assertion suites
updated, `docs/proof/` re-sealed, discrimination sensor run.

Two findings worth carrying forward:

- **The four modules no longer duplicate the envelope shape.** They each held
  their own `unsigned*` copy of the sealer's digest input — four places that
  could drift from the sealer and from each other. They now share
  `sealedProjectionMatches`.
- **The key id moved outside the signed Statement**, because under DSSE it is
  `signatures[].keyid` — envelope metadata. The pre-DSSE content address
  covered it; the new one cannot. Verification would still catch a swap via the
  trust lookup, but the storage-integrity checks run *without* a trust root and
  would not have, so the binding is asserted explicitly rather than quietly
  lost in the move.

# T3 — bare-envelope persistence DONE (2026-08-09, #248)

The persisted object is now the DSSE envelope and nothing else. Every flat
field is **derived** from the signed Statement on read via
`sealedArtifactFromEnvelope`, so a stored projection cannot disagree with what
was signed — the disagreement became impossible rather than merely detected.

`tests/security/dsse-interoperability.test.mjs` proves the claim from the
outside: it rebuilds the PAE and checks Ed25519 with no sealer, no projection
and no repository types in the loop, exactly as an external verifier would.

# Next Exact Action

**T2 — implement step 1 of `migration.md`:** replace `SealedArtifact`
(`packages/evidence/src/integrity/types.ts:33-42`) with the DSSE envelope
types, add `VES_ENVELOPE_UNSUPPORTED` to `VerificationErrorCode`
(`types.ts:52-65`), and rewrite `ArtifactSealer.seal`/`verify`
(`artifact-sealer.ts:111,142`) to sign the DSSE Pre-Authentication Encoding
in place of the current `canonicalizeJson({ artifactId, ...base })` bytes at
`artifact-sealer.ts:137`. Keep the binding block inside the signed payload —
five verification error codes depend on it. Then proceed through steps 2-7
in order.

# Blockers

None. The decision that blocked this feature is made.

# Decisions

- **AD-014 (owner, 2026-08-09):** Option A — DSSE envelope with in-toto
  Statement payloads, Ed25519 and the trust root unchanged.
- Scope is the 8 `ArtifactSealer` kinds plus the T75 qualification evidence
  index (added 2026-08-12; migration.md section 2.1). The index has no sealing
  call site yet — it is generated unsigned and says so — so this migration is
  what gives it one. Policy bundles, passport registry, skill registry, work
  claims, trust egress, and the context manifest keep their current mechanism;
  TUF metadata already uses an external standard and is untouched.
- V1 envelopes are **rejected**, never dual-verified: no sealed artifact
  exists outside the repository, so pre-decision artifacts are re-sealed
  under recorded evidence instead (`migration.md` section 3). The inventory
  is re-run at implementation time; if anything was published in the
  meantime, a genuine dual-format path must be specified first.
- Predicate type URIs are hosted at `accd.github.io/verchestra` because that
  domain is provably controlled today; a custom domain would supersede them
  via a versioned `/v2` and a new AD.
- Any format change lands on top of `KeyProviderPort` (T68a), never on
  direct signer construction.

# Files Intentionally Left Unchanged

- Historical `docs/qualification/*` prose describing the pre-DSSE format —
  those reports accurately describe the format in force when written.
- The parallel signature surfaces listed under Decisions.
- `packages/distribution/src/tuf-update-client.ts` and its `tuf-js`
  dependency.
