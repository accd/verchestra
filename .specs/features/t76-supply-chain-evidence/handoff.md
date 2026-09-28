---
schema: verchestra-feature-handoff/v1
feature: t76-supply-chain-evidence
issue: 17
status: complete
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T4
nextTask: "No further action for this feature; superseded by docs/qualification/t76-validation.md (T76 PASS, #17 closed). Open follow-ups it does not claim: independent verification and key custody (#408), live update/rollback (#387, #393)."
lastGate: "T76 report docs/qualification/t76-validation.md PASS at a49f3dd (5 profiles x 5 targets, run 32927839487; publication run 32929312169); agent:check PASS at 20071a7"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope completed

The generator emits and verifies four deterministic unsigned supply-chain
documents from a pinned revision, target, component metadata, and evaluation
outcomes. It preserves failures and incomplete evidence rather than relabeling
them as passes.

# Remaining work (historical, superseded — see Reconciliation)

The documents still need to be materialized by the real T76 build, included as
bundle components, signed with the approved trust identity, published through
TUF, resolved through all four views, and independently validated. This PR does
not close #17 or advance T77.

# Reconciliation (2026-09-29, #407)

The T76 qualification report `docs/qualification/t76-validation.md` supersedes
the "Remaining work" below. It is bound to
`a49f3dd5aa3e639db87f8715077446ec075600e9`, reviewed in PR #369, and issue #17
is closed. It records the following:

- **Candidate build.** Run 32927839487 built the five-target fleet at exactly
  that revision, with all five gate profiles on every target: 25 executions,
  zero failures, skips, or todos (`t76-validation.md:48-62`).
- **Publication.** Run 32929312169 consumed the sealed candidate and emitted
  the signed per-target TUF repositories. The rollback proof is drawn from the
  prior sealed candidate `af8bcf044cf8` (`t76-validation.md:64-71`).
- **Public service.** All 990 assets were sha256-verified and served from the
  R2 endpoint, and `verchestra@0.0.0-qualification` was published to npm
  under the owner's 2FA (`t76-validation.md:176-221`).
- **Four views.** The views became auditable in the emitted manifest in
  `bc2280f`. Real cross-adapter equivalence over every source mode was proven
  in `f8fa711` (acceptance matrix L6, resolved). Both landed after the report's
  revision. The report records them as post-revision hardening, not as T76
  evidence (`t76-validation.md:102-135`).
- **Supply-chain evidence, specific to this feature.** The real target builder
  binds license, SBOM, provenance, and evaluation evidence into each target
  (`scripts/t76-build-candidate.mjs`; the `tests/build/reproducible-target-build.test.mjs`
  case "the real target builder binds exact revision, host assets, and all
  supply-chain evidence", which is T76 sensor mutation 2). Those targets were
  sealed by run 32927839487. The report does not enumerate the four documents
  individually. That is a limit of the report's wording, not an open task.

Open, and not claimed by the T76 report (`t76-validation.md:33-44,248-256`):

- **No independent verifier distinct from the implementation author.** The
  owner reviewed and merged every pull request, but that review is not
  independent. Signing-key custody is single-operator (acceptance matrix L1,
  L8). Owner: #408, for a fresh promotion round.
- **No live update or rollback against the published endpoint.** The rollback
  proof is a sealed publication-side index; no client rollback ran live
  (acceptance matrix L7). Owners: #387 for the `.3` republication and the
  update leg, and #393 for a genuine rollback.

Neither item is outstanding implementation for this feature. The feature's
own deliverables are merged and exercised by the T76 report. The status moves
from `in_progress` to `complete` in this one reconciliation, and the T76
report is the verification evidence.
