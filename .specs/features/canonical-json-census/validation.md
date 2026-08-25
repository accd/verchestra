# Canonical JSON Census Validation

**Date**: 2026-08-22
**Spec**: `.specs/features/canonical-json-census/spec.md`
**Diff range**: `d250c7c994be1c9aa9194118c757b67079d23ad3..df9617f42e7755f86e8754302659cbecc7576686`
**Verifier**: independent sub-agent (author != verifier)

---

## Task Completion

| Task | Recorded status | Independent result |
| --- | --- | --- |
| T0 | Complete | ✅ Specification, design, task, and portable-handoff artifacts are coherent. |
| T1 | Complete | ✅ The source-derived scanner, 85-entry inventory, closed scope exclusions, and security assertions satisfy CJC-01 through CJC-04. |
| T2 | Complete | ✅ The compatibility matrix and handoff reconcile the inventory and preserve the required migration order. |

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | `file:line` evidence | Result |
| --- | --- | --- | --- |
| CJC-01 | Detect every local canonicalizer, structured `JSON.stringify` serialization, ambient `localeCompare`, or SHA-256 producer; any non-product serialization exclusion is closed and test-protected. | `scripts/canonical-json-census.mjs:38-44` defines all four signal classes; `:70-79` applies them to every declared source root. The only exclusions are the ten reasoned paths in `:6-18`, asserted exactly by `tests/security/canonical-json-census.test.mjs:104-118`. Independent AST re-derivation found 58 actual `JSON.stringify` source files: nine are listed scope exclusions, every other serializer is in the candidate set. | ✅ PASS |
| CJC-02 | Every detected source has one closed inventory classification and unclassified, duplicate, stale, or signal-mismatched input fails. | Independent re-derivation found 87 candidates and 87 inventory entries, with no missing, stale, duplicate, signal-mismatched, invalid-reason, invalid-exception, or invalid-classification path. `scripts/canonical-json-census.mjs:101-131` implements these findings; `tests/security/canonical-json-census.test.mjs:22-37,136-195` asserts the actual inventory and discriminator cases. The T75 attestation signer, T76 target builder, and T76 candidate materializer are classified as migrated V2. | ✅ PASS |
| CJC-03 | Presentation/fixture ordering exception is explicit, closed, test-protected, and unavailable to trust or persistent paths. | `scripts/canonical-json-census.mjs:28-37,95-99` fixes the allowed paths and the exact non-trust/non-persistent reason. `tests/security/canonical-json-census.test.mjs:39-52,120-134` asserts the exception's signals/reason and rejects an authority-relevant replacement path. | ✅ PASS |
| CJC-04 | Distinguish V2, retained V1, pending versioned work, and raw-byte digest paths. | `docs/canonical-json-census.json:3-8` defines the closed classes. Independent inventory count: 33 `migrated-v2`, 13 `retained-v1-versioned`, 23 `pending-versioned-migration`, 12 `raw-byte-digest`, and 6 `presentation-or-fixture`; every entry has a non-empty reason. | ✅ PASS |
| CJC-05 | Matrix and portable handoff name signed evidence, release bundle/activation, then portable owners in order. | `docs/canonical-json-compatibility.md:79-90` and `.specs/features/canonical-json-census/handoff.md:30-35` state the required order. `tests/security/canonical-json-census.test.mjs:198-212` asserts the inventory link and ordering. | ✅ PASS |

**Status**: ✅ All CJC-01 through CJC-05 criteria have file-and-assertion evidence.

## Independent Re-Derivation

The verifier independently walked every `.ts` and `.mjs` source under
`packages/`, `apps/`, and `scripts/`, parsed actual `JSON.stringify` call
expressions with the TypeScript parser, and separately computed the local
canonicalizer, digest, and locale signals.

| Check | Result |
| --- | --- |
| Actual structured `JSON.stringify` source files | 58 |
| Actual serialization sources in the closed exclusion list | 9 |
| Non-serialization source exclusion | `scripts/canonical-json-census.mjs`, the scanner itself |
| Unexcluded actual serialization absent from candidates | 0 |
| Independently derived candidates / tracked inventory entries | 87 / 87 |
| Missing, stale, duplicate, signal-mismatched, unreasoned, invalid-exception, or unknown-classification entries | 0 |

The seven prior survivors are now present with reconciled serialization
signals, classifications, and reviewed reasons:

- `apps/site/src/lib/repository-docs-loader.ts` — raw-byte digest.
- `packages/application/src/self-test/self-test.ts` — pending versioned migration.
- `packages/workspace/src/init/safe-init.ts` — retained V1/versioned.
- `packages/workspace/src/placement/artifact-placement.ts` — migrated V2.
- `packages/platform-node/src/authority-store-adapter.ts` — pending versioned migration.
- `packages/platform-node/src/machine-bootstrap-adapters.ts` — pending versioned migration.
- `packages/platform-node/src/policy-store-adapter.ts` — retained V1/versioned.

The scanner also reconciles serialization signals within already-candidate
sources, including digest-bound `canonicalBody` in the promotion gate and the
context snapshot projection.

## Discrimination Sensor

All mutations used a disposable temporary root or in-memory inventory values;
no tracked source or untracked `.tmp-*` directory was modified.

| Mutation | Result | Killed? |
| --- | --- | --- |
| `canonicalDriverReview(value) { return JSON.stringify(value); }` in a disposable product source | Detected with `serialization: 1`. | ✅ Killed |
| `save(record) { return JSON.stringify(record); }` durable-record shape | Detected with `serialization: 1`. | ✅ Killed |
| `generateDigest(JSON.stringify(data))` build-digest shape | Detected with `serialization: 1`. | ✅ Killed |
| Clear a tracked entry's reviewed reason | Returned the path in `invalidReasons`. | ✅ Killed |
| Move a presentation entry to the Self-Test authority path | Returned the path in `invalidExceptionPaths`. | ✅ Killed |
| Increment an entry's serialization signal | Returned the path in `signalMismatches`. | ✅ Killed |

**Sensor depth**: lightweight
**Result**: 6/6 killed — ✅ PASS

## Focused Test and Gate Evidence

- `node --test tests/security/canonical-json-census.test.mjs` — 10 passed, 0 failed, 0 skipped, 0 todo.
- `corepack pnpm agent:check` — passed.
- `git diff --check d250c7c994be1c9aa9194118c757b67079d23ad3..df9617f42e7755f86e8754302659cbecc7576686` — passed.
- The focused test did not exist at the base revision; it now contains 10 cases.
- `.specs/features/canonical-json-census/tasks.md:6-7` and `handoff.md:46-47` record post-correction `pnpm gate:security` and `pnpm gate:quick` passes. They were inspected as the implementer's reported gate evidence and were not re-executed by this verifier under the assigned no-full-gate scope.

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum scope and surgical correction | ✅ |
| Candidate derivation is deterministic | ✅ |
| Inventory is canonical and scanner never rewrites it | ✅ |
| Scope exclusions are closed, reasoned, and test-protected | ✅ |
| Tests are spec-anchored and discriminate all new serialization shapes | ✅ |
| No unrelated user work was modified | ✅ |
| Documented guidance followed | ✅ `AGENTS.md`, `.specs/AGENTS.md`, and `tests/AGENTS.md` |

## Summary

**Overall**: ✅ Ready for human review

**Spec-anchored check**: 5/5 requirements matched their specified outcomes.
**Sensor**: 6/6 mutations killed.
**Focused test**: 10 passed, 0 failed, 0 skipped, 0 todo.
**Gate evidence**: reported `gate:security` and `gate:quick` passes reconciled in the task and handoff; `agent:check` independently rerun and passed.

The next action is human review of the feature branch; this report does not
claim that issue #58 or product qualification is complete.
