---
schema: verchestra-feature-handoff/v1
feature: key-lifecycle
issue: 51
status: in_progress
branch: codex/issue-51-key-provider
baseRevision: e08a5cb7cae60d7f29a09121c1784383216ba549
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm gate:quick
updatedAt: 2026-07-29T13:58:00Z
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

T2: implement the encrypted-file provider using only `node:crypto`, including
authenticated encryption, owner-only persistence, and fail-closed malformed or
tampered-keystore handling.

# Blockers

T1 is complete: `KeyProviderPort` now has stable load, rotate, and revoke
shapes; `key-lifecycle-error@1` is the closed canonical schema for
`VES_KEYSTORE_INTEGRITY`, `VES_KEY_REVOKED`, and `VES_KEY_EXPIRED`; generated
contracts are current. `pnpm test:contract` passed 440 tests, `pnpm typecheck`
passed, and `pnpm gate:quick` passed (1,620 unit tests and 64 readiness tests).

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
