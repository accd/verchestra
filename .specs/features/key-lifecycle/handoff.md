---
schema: verchestra-feature-handoff/v1
feature: key-lifecycle
issue: 51
status: in_progress
branch: feat/t68a-status-surfaces
baseRevision: 51c9277ad071187e923ff03b699d56e3f999a222
lastCompletedTask: null
nextTask: T1
lastGate: pnpm gate:full
updatedAt: 2026-07-28T22:56:13Z
---

# Scope

Persistent signing-key lifecycle for the evidence trust boundary:
`KeyProviderPort`, encrypted-file adapter, rotation with overlap,
revocation, composition-root wiring, and the two-machine portability proof
(review item R1 + demo R13). Roadmap task T68a.

# Completed Evidence

Specification, design, and tasks written from verified code reading:
`signer.ts` has only `generate()`; no product wiring constructs a signer;
`PublicKeyRef` already supports purposes and validity windows;
`ArtifactSealer` verifies Ed25519.

T68a is now open as GitHub issue #51, with #52–#54 tracking T68b–T68d and
issue #10 (T69) re-blocked behind them.

The status-surface migration is complete. Rather than moving the literal
"T69" to "T68a" in each surface, the derivation itself was fixed: `nextTask`
was `highestVerifiedTask + 1`, an assumption that broke the moment task
identifiers stopped being integers. It is now read from the ROADMAP.md
mermaid chain by `nextTaskFromRoadmap`, so `ROADMAP.md` is the single
ordering authority and future insertions need no code change. The JSON
context schema moves to version 2 because `qualification.nextTask` changes
from a number to a task identifier string.

`agent:check` no longer hardcodes "T68 complete and T69 next". It asserts
agreement instead: that the roadmap declares the successor edge, that
`.specs/STATE.md` and `ROADMAP.md` both name the current and next task, and
that `llms.txt` carries the exact computed status line. Mutating the roadmap
edge to a wrong successor makes `agent:check` fail, which is the evidence
that the authority is real rather than decorative.

Surfaces migrated: `scripts/agent-readiness.mjs`, `scripts/agent-context.mjs`,
`AGENTS.md`, `docs/AGENTS.md`, `apps/site/AGENTS.md`, `llms.txt`,
`tests/architecture/agent-instructions.test.mjs`,
`tests/agent-readiness/{check,context}.test.mjs`, `tests/agent-eval/corpus.json`,
`apps/site/src/data/product.ts`, `apps/site/src/lib/{repository-content,llm-content}.ts`,
`apps/site/src/pages/index.astro`, `apps/site/scripts/check-built-site.mjs`,
the two site status documents, and the site unit and end-to-end contracts.

Gates: `pnpm gate:full` PASS, `pnpm agent:check` PASS, site unit 31/31,
`astro check` clean across 27 files, 120-page build, and `check:built`
reporting `internalLinks: valid`.

# Next Exact Action

T1: define `KeyProviderPort` in `packages/evidence/src/integrity/` and the
new public error codes (`VES_KEYSTORE_INTEGRITY`, `VES_KEY_REVOKED`,
`VES_KEY_EXPIRED`) through the schema generator in `schemas/`.

# Blockers

None.

# Decisions

- Encrypted-file adapter first; KMS/keychain/sigstore are later adapters
  behind the same port.
- Historical evidence keeps its recorded verdict after revocation;
  revocation blocks new artifacts only.
- Starting T68a includes the deliberate status-surface migration from
  "T69 next" to "T68a next" recorded in the external-review-triage handoff.
- That migration fixes the derivation rather than the literals: the successor
  comes from the ROADMAP.md chain, so the next insertion needs no code change.
- `agent:check` asserts agreement between derived surfaces and the roadmap
  instead of hardcoding the current task pair, removing a literal that had to
  be hand-edited at every task boundary.

# Files Intentionally Left Unchanged

- All product code (`packages/`), which the key lifecycle itself will touch
  from T1 onward; this change moves only status surfaces and their tests.
- The canonical JSON and signature format (owned by the DSSE decision).
- The T69–T77 numbering and every existing qualification report.
