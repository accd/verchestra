# Cedar 4.14.0 validation

**Date:** 2026-10-28
**Diff:** branch `build/563-cedar-4-14` over `main` `b5819c6`
**Verifier:** primary agent local verification on Windows x64, Node 24.14.0;
GitHub required checks remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| CED-01 | `package.json:66` and `packages/policy/package.json:11` pin `4.14.0`, moved with `pnpm add -E`; the lockfile diff is 20 lines and changes only `@cedar-policy/cedar-wasm` and the peer suffix of `@strands-agents/sdk@1.19.0`, which names it as an optional peer `^4.0.0`. pnpm also re-resolved `legacy-javascript` 0.0.3 to 0.0.4; that hunk was reverted to keep one concern, and `pnpm install --frozen-lockfile` passes | PASS |
| CED-02 | `packages/policy/src/cedar-policy.ts:141-142` and `spikes/cedar/src/cedar-policy-oracle.mjs:18` expect engine `4.14.0` and language `4.6`; `spikes/cedar/test/cedar-forms.test.mjs:11`, `:15` assert both loaders report exactly that. The mismatch scenarios keep engine `4.11.1` and language `4.4` and still deny (`engine-version-mismatch`, `language-version-mismatch`) | PASS |
| CED-03 | Review in `docs/qualification/cedar-4.14.0.md`. Corpus entries `policy-validation-action-application` and `schema-external-declaration` (`spikes/cedar/test/policy-corpus.json:31-32`), built by `spikes/cedar/test/cedar-oracle.test.mjs:33-40` and `tests/helpers/policy-fixture.mjs:55-62`, expect `VES_POLICY_VALIDATION_FAILED` from the spike oracle and from the product adapter (`tests/security/cedar-policy.test.mjs:14`) | PASS |
| CED-04 | See "Gates" and "Discrimination" | PASS locally; pending externally |

## Probe of the real engine

A scratch probe against the installed `4.14.0` showed: the misapplied scope
returns `validationErrors: []` and two `validationWarnings` (no applicable
action; impossible policy); a schema declaring `Thing` as `external` parses
(`checkParseSchema` success, `schemaCompleteness` reports it incomplete), and
strict `validate` returns one incomplete-schema error per policy.

## Gates

- `qualify:cedar`: 52 of 52, 0 skipped (50 before, plus the two entries).
- Policy suites (`tests/security/cedar-policy.test.mjs`,
  `tests/unit/policy-{hardening,activation,view-digest}.test.mjs`,
  `tests/unit/nested-template-output.test.mjs`,
  `tests/integration/policy-{activation-runtime,view-digest-reencoding-migration}.test.mjs`):
  106 of 106.
- `gate:quick`: PASS: `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit` 3169 of 3169, `test:agent-readiness` 401 of 401, `test:census` 13 of 13; 0 skipped.
- `agent:check`: PASS.

## Discrimination

| Fault (one at a time, file restored after each) | Failing tests |
| --- | --- |
| The adapter drops `validationWarnings` (`cedar-policy.ts:256`) | `product Cedar policy corpus: policy-validation-action-application` |
| The adapter drops `validationErrors` (`cedar-policy.ts:255`) | `policy-validation-attribute`, `schema-external-declaration` |
| The spike oracle drops `validationWarnings` (`cedar-policy-oracle.mjs:58`) | `frozen policy oracle: policy-validation-action-application` |
| The spike oracle drops `validationErrors` (`cedar-policy-oracle.mjs:57`) | `policy-validation-attribute`, `schema-external-declaration` |

No test killed the first and third faults before this change.

## External verification

Quality gate, Site quality and CodeQL must pass on the exact pushed head
before merge. No production-readiness claim is made.
