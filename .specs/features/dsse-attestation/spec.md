# DSSE Attestation Decision Specification

## Problem Statement

Verchestra signatures are base64url detached signatures over a
project-specific canonical JSON. This works and verifies correctly, but it
isolates the project: no existing tool (cosign, Kyverno, Gatekeeper, GitHub
attestations, SLSA tooling) can verify a Verchestra artifact. The data model
is already close to an in-toto attestation — subject, predicate, materials
linked by digest. Wrapping signatures in DSSE with an in-toto predicate
would give immediate interoperability: an enterprise could verify a Handoff
with tools it already runs. This is the highest-leverage format decision in
the repository and the most expensive one to change after 1.0, because every
sealed artifact, trust root, and verification path speaks the current
format.

## Decision Required Before

T76 (Verified release candidate). After 1.0 the format is effectively
frozen by compatibility promises.

## Options

### Option A — Adopt DSSE envelope + in-toto predicate (review recommendation)

- Wrap the existing canonical payload in a DSSE envelope
  (`payloadType`, `payload`, `signatures[{keyid, sig}]`).
- Map Execution Package / Handoff / Capsule metadata onto an in-toto
  `Statement` with a Verchestra predicate type.
- Keep Ed25519 and the existing trust root; only the envelope changes.
- Gains: cosign/Kyverno/GitHub-attestation/SLSA interoperability; the
  `provenance.intoto.jsonl` bundle slot
  (`tests/helpers/hermetic-bundle-fixture.mjs:39`) becomes truthful.
- Costs: every verification path, fixture, contract test, and the canonical
  JSON story changes; dual-format verification needed for pre-1.0 artifacts.

### Option B — Keep the proprietary format, document it formally

- Publish the canonicalization and signature spec so third parties can
  implement verifiers.
- Gains: zero migration cost; full control.
- Costs: interoperability stays at zero; "documented proprietary" is still
  proprietary for admission-control tooling.

### Option C — Dual format: proprietary canonical + DSSE projection

- Keep the current signing path; add a DSSE/in-toto projection as an
  additional signed artifact.
- Gains: no breaking change; interoperability for consumers that want it.
- Costs: two formats to verify, keep consistent, and secure forever; the
  projection can drift from the canonical source unless generated
  deterministically.

## Evaluation Criteria

- Interoperability with admission-control and attestation tooling.
- Migration cost across `packages/evidence`, contract tests, fixtures, and
  qualification evidence.
- Verification simplicity (one format beats two).
- Reversibility before 1.0 versus after.

## Acceptance Criteria

1. **DSSE-01** — WHEN the decision is made THEN it SHALL be recorded as an
   architecture decision in `.specs/STATE.md` with the chosen option and
   rationale, before T76 qualification starts.
2. **DSSE-02** — IF Option A or C is chosen THEN a migration spec SHALL
   define dual-format verification for pre-decision artifacts, the exact
   predicate type URI, and the fixture/contract-test migration plan.
3. **DSSE-03** — WHEN any format change ships THEN previously sealed
   artifacts SHALL remain verifiable or be explicitly re-sealed under
   recorded evidence.

## Success Criteria

- The 1.0 release ships one deliberate, documented signature-format story —
  chosen, not inherited by default.
