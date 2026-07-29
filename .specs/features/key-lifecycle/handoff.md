---
schema: verchestra-feature-handoff/v1
feature: key-lifecycle
issue: 51
status: in_progress
branch: codex/issue-51-key-rotation-main
baseRevision: f027fb797c9a421eea90642166e999505e723c54
lastCompletedTask: T3
nextTask: T4
lastGate: pnpm gate:quick
updatedAt: 2026-07-29T16:08:06Z
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

T2 adds `EncryptedFileKeyProvider` in the Node platform adapter. It persists
one Ed25519 key per requested key identity as an AES-256-GCM authenticated,
scrypt-derived envelope under a machine-local `keys/` directory, with a
temporary owner-only file linked atomically into place. The adapter rejects
symlinked state roots, malformed envelopes, wrong passphrases, ciphertext
tampering, mismatched public-reference identities, and truncation with the
public `VES_KEYSTORE_INTEGRITY` code; it never regenerates after a corrupt
existing keystore. `NodeEd25519Signer` now imports and exports PKCS#8 only
inside this adapter boundary, while its public reference stays stable across
reloads.

T2 evidence: focused provider tests passed; `pnpm gate:quick` passed with
1,624 unit tests and 64 readiness tests; `pnpm test:security` passed with
914 tests. The adversarial coverage includes a wrong passphrase, malformed
JSON, modified GCM ciphertext, and a modified plaintext public-key identity.

T3 adds rotation and revocation to the file adapter. Rotation retains a stable
logical key identity for callers but gives each new signing key a distinct
physical `keyId`, returns the previous public reference with its overlap end,
and persists the new active key. The version-2 encrypted state authenticates
the active reference and revocation bit with the private material, so neither
metadata mutation nor an attempted reactivation is accepted. `revoke()` is
idempotent and later `loadOrCreate()` calls fail with `VES_KEY_REVOKED`.

T3 evidence: the focused tests prove distinct identities, persistence,
revocation, invalid-overlap rejection, in-window verification, and expiry;
`pnpm gate:quick` passed with 1,628 unit tests and 64 readiness tests;
`pnpm test:security` passed with 915 tests, including altered version-2
metadata. The existing verifier supplies the corresponding trust-root
`VES_TRUST_KEY_EXPIRED` outcome after overlap.

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

T4: wire the composition root to obtain signers only through `KeyProviderPort`,
with integration tests proving no production path constructs `NodeEd25519Signer`.

# Blockers

T1 through T3 are complete. T4 is the first CLI-composition slice; it must not
introduce a direct `NodeEd25519Signer` construction. Windows file modes remain
a best-effort ACL limitation documented in the feature design; the provider
uses owner-only modes where the platform enforces POSIX permissions.

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

- `apps/vestra-cli`, which is intentionally reserved for T4 composition.
- The canonical JSON and signature format (owned by the DSSE decision).
- The T69–T77 numbering and every existing qualification report.
