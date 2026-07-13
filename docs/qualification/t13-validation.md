# T13 Validation — Domain Value Objects and Public Errors

**Gate:** `corepack pnpm@10.34.5 gate:quick`  
**Result:** 51 T13 unit/property cases and 21 retained unit cases passed; 0 failed, 0 skipped, 0 todo. Format, lint, and strict TypeScript passed. The 10-case architecture suite also passed independently.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| Stable entity and requirement IDs | `domain-primitives.test.mjs:23–55` | Canonical kind + UUID v4/v7 and `VES-AAA-000`; wrong kind/form rejected | Yes |
| Portable logical paths | `domain-primitives.test.mjs:57–103` | Relative POSIX form; traversal, Windows paths/reserved names, ambiguity, non-portable characters, and bounds rejected | Yes |
| Typed digests | `domain-primitives.test.mjs:106–131` | `sha256:<hex>` canonical value, raw-schema projection, algorithm/length/case validation, equality | Yes |
| Typed instants and clocks | `domain-primitives.test.mjs:133–195` | Real millisecond UTC instants, ordering/arithmetic, deterministic injected clock, Node wall clock adapter | Yes |
| Actors and classifications | `domain-primitives.test.mjs:198–237` | Closed actor vocabulary, minimal references, ordered five-level data classification | Yes |
| Public error construction | `domain-primitives.test.mjs:252–280` | Exact stable envelope; private text changes without code identity drift | Yes |
| Registry and safe-detail denial | `domain-primitives.test.mjs:282–366` | Unknown/duplicate codes, undeclared/missing/wrong/sensitive/oversized/non-finite details fail | Yes |
| Immutability and serialization safety | `domain-primitives.test.mjs:369–405` | Caller mutation cannot alter envelope; JSON excludes message, cause, stack, and raw secret-like text | Yes |
| Canonical catalog/schema agreement | `domain-primitives.test.mjs:408–428` | All 11 T13 public codes exist and validate against `public-error@1` | Yes |

## Check B — Non-shallow

Tests execute the production constructors, immutable snapshots, error registry, schema registry, and real Node clock adapter. Negative cases target type confusion, path portability/traversal, malformed time, unsupported digest algorithms, registry drift, sensitive detail names, exception leakage, and mutation after construction. The schema agreement test compiles the canonical JSON Schema and validates every built-in T13 error envelope.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| Stable IDs, paths, instants, actors, classifications | VES-DSC-005 and shared domain invariants | Yes |
| Public code identity and safe envelopes | VES-CLI-004…005 | Yes |
| Canonical catalog/schema validation | VES-CLI-005, VES-TST-007 | Yes |
| Injectable/domain clock plus Node adapter | deterministic execution and clock-bound verification | Yes |

## Check D — Guidelines

Tests were authored before implementation. Domain source imports no Node module or third-party library. `Clock` is an inward port; `FixedClock` is deterministic and the real `SystemClock` lives in `platform-node`. Logical paths are OS-neutral identifiers, never ambient filesystem paths. `Digest.value` is algorithm-qualified while `Digest.hex` is the explicit projection for existing raw-hex schema fields. Error definitions allowlist every public detail key and primitive type; internal exception messages and causes cannot serialize through `PublicErrorException`.

## Adequacy verdict

PASS — all T13 criteria have exact executable evidence, 51 focused cases exceed the ≥35 threshold, canonical error schemas and architecture boundaries remain intact, and `gate:quick` passed.
