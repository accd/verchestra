# canonicalize 5.1.0 validation

**Date:** 2026-10-28
**Diff:** branch `build/655-canonicalize-5` over `main` `2f6bce7`
**Verifier:** primary agent local verification on Windows x64, Node 24.14.0;
GitHub required checks remain authoritative

| Requirement | Evidence | Result |
| --- | --- | --- |
| CAN-01 | `packages/evidence/package.json` pins `5.1.0`, moved with `pnpm add -E`; the lockfile diff changes only `canonicalize` (pnpm's re-resolution of `legacy-javascript` was reverted); `pnpm install --frozen-lockfile` passes | PASS |
| CAN-02 | `tests/unit/evidence-integrity.test.mjs`, "canonicalization refuses, with its own code, every shape canonicalize 4 and 5 changed": a sparse array, a function element, a boxed number and string, a `toJSON` returning `undefined` (`VES_INTEGRITY_NON_JSON_VALUE`), and lone surrogates in a key and a nested string (`VES_INTEGRITY_INVALID_UNICODE`), each an `IntegrityError` | PASS |
| CAN-03 | Same file, "V1 and V2 write the same bytes for every JSON value V1 accepts": key order, number serialization across magnitudes and signs, `-0`, escapes, U+0000, combining marks, a null-prototype object, and keys whose UTF-16 code-unit order differs from code-point order. A probe over the same corpus gave identical bytes on 3.0.0 before the move | PASS |
| CAN-04 | `test:contract` 981 of 981; `tests/security/canonical-json-*`, `*evidence*` and `*dsse*` 68 of 68; `agent:check` PASS (it verifies the signed release decision) | PASS |

## Discrimination

| Fault in `canonical.ts` (file restored after each) | Killed by |
| --- | --- |
| `canonicalizeJson` skips its input checks | the refusal test (a sparse array reaches the library and is written as `[null,null,1]`) |
| `JSON.stringify` replaces the library | the V1/V2 agreement test |

## External verification

Quality gate, Site quality and CodeQL must pass on the exact pushed head
before merge. No production-readiness claim is made.
