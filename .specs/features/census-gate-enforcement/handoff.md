---
schema: verchestra-feature-handoff/v1
feature: census-gate-enforcement
issue: 395
status: verification
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T3
nextTask: Human review and merge of the census gate enforcement change; then the owner either follows the spec.md #395 break-glass steps to require a Security gate check or records in #395 that the Quality gate coverage suffices (#395).
lastGate: pnpm gate:security PASS; pnpm gate:quick PASS; pnpm agent:check PASS
updatedAt: 2026-09-29T00:00:00Z
---

# Handoff

## State

T1 to T3 are implemented on `fix/gate-census-and-handoff-drift` from
`origin/main` at `20071a7`. T4 is recorded but not performed: requiring a
separate `Security gate` check is owner break-glass. It needs a workflow job
that does not exist yet and a ruleset edit.

## Delivered

- `gate:quick` runs `test:census`, the canonical-JSON census test, on every
  change. The stage adds about 0.5 s.
- `scripts/gate-selection.mjs` selects `gate:security` for every path in
  `docs/canonical-json-census.json` and for the census surface itself. It fails
  closed on an unreadable inventory.
- `docs/canonical-json-compatibility.md` states the proven-local-canonicalizer
  rule. `scripts/canonical-json-census.mjs` enforces it with a closed allowlist
  that holds only `scripts/agent-readiness.mjs`.
- `tests/agent-readiness/release-decision.test.mjs` compares the inlined
  canonicalizer directly with `canonicalizeJsonV2`.

## Next

Independent review of the diff and the owner decision in `spec.md`
("#395: required-check decision").
