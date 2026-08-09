---
schema: verchestra-feature-handoff/v1
feature: dsse-attestation
issue: 217
status: in_progress
branch: main
baseRevision: 1f21582850ec48973794e3cb7f6c11f0531c97e5
lastCompletedTask: T1
nextTask: T2
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
- Scope is the 8 `ArtifactSealer` kinds only. Policy bundles, passport
  registry, skill registry, work claims, trust egress, and the context
  manifest keep their current mechanism; TUF metadata already uses an
  external standard and is untouched.
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
