---
schema: verchestra-feature-handoff/v1
feature: canonical-json
issue: 58
status: verification
branch: codex/issue-58-canonical-json-census
baseRevision: 7bcc236255742ad3edf2c16094abbabbcd4f50e4
lastCompletedTask: T14
nextTask: Obtain independent verification and human review, then start the refreshed whole-repository canonicalization census.
lastGate: pnpm gate:quick PASS; pnpm gate:security PASS
updatedAt: 2026-08-22T19:18:00Z
---

# Current scope

T4i closes the deferred durable-effect portion of #58. It does not claim that
the whole #58 census is complete: the remaining portable-identity owners,
Execution Package, hermetic bundle, transactional activation, and the closed
presentation/fixture allowlist still require separate, reviewable verticals.

# Delivered

- `EffectIntent` now carries `canonicalizationVersion`. New intents default to
  V2 and emit a `v2:sha256:` key derived from `canonicalizeJsonV2`; explicitly
  requested V1 retains its frozen material and bare `sha256:` key.
- The effect broker and both repositories converge V1 and V2 forms through
  logical identity before scheduling an adapter call. A forged key still fails
  before the logical lookup can return an existing intent.
- Additive runtime migration `011_effect_identity_canonicalization` records
  V1 for existing rows and adds logical-identity uniqueness. Invalid stored
  versions fail closed as `VES_RUNTIME_CORRUPT`.
- The compatibility matrix records the completed vertical without changing
  unrelated deferred rows.

# Evidence

- `tests/unit/effect-kernel.test.mjs`: V1 bytes stay pinned, V2 is explicit,
  unknown versions fail closed, and an in-memory V2 plan reuses V1.
- `tests/integration/effect-kernel.test.mjs`: an actual pre-011 SQLite V1 row
  migrates, is reused by V2, and is applied exactly once.
- `tests/fault-injection/effect-kernel-faults.test.mjs`: two runtime
  connections converge V1/V2 planning on one durable row.
- `tests/security/canonical-json-sensor.test.mjs`: a mutant that replaces V2
  canonical JSON with `JSON.stringify` is killed.
- Focused checks passed: `pnpm format:check`, `pnpm lint`,
  `pnpm complexity:check`, `pnpm typecheck`, `pnpm test:unit`, focused
  integration and fault suites, and `pnpm test:security`.

# Required next action

The declared quick and security gates pass on this branch. Independent
verification must now review the implementation and evidence before a PR is
opened. Then resume #58 with a fresh mechanical census of every
canonicalizer, `localeCompare`, and digest producer; do not mark the issue
complete until all rows are migrated or appear in a tested closed allowlist.

# Decisions

- V1 is read compatibility only; V2 is the default emission format. The
  logical-identity index excludes canonicalization version specifically to
  prevent cross-version double application.
- Migration `011` is additive. The original effects schema remains unchanged
  because its checksum is authoritative for already-created stores.
- No private material, environment value, provider state, or local path is
  included in this handoff.
