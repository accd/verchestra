# T11 Validation — Canonical Schema Registry and Generated Types

**Gate:** `corepack pnpm@10.34.5 gate:full`  
**Result:** 41 passed, 0 failed, 0 skipped, 0 todo. Format, lint, and strict TypeScript passed.  
**SPEC_DEVIATION:** none.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Spec outcome | Covered |
| --- | --- | --- | --- |
| Declared registry | `schema-registry.test.mjs:42` — exact four `name@version` entries | Only canonical declared schemas | Yes |
| Positive validation | line 47 — validated value deep-equals input for every schema | Valid values accepted unchanged | Yes |
| Version negotiation | line 51 — `[0,1]` selects exact `1` for every schema | Highest mutually supported version | Yes |
| Strict negative corpus | line 82 — every schema rejects unknown field, missing/wrong version, null, array, string, and number with exact code/schema | Boundary fails closed | Yes |
| Unknown name/version | lines 91–99 — exact `VES_SCHEMA_UNKNOWN` and `VES_SCHEMA_VERSION_UNSUPPORTED` | Stable compatibility errors | Yes |
| No compatible version | lines 102–105 — exact `VES_SCHEMA_NEGOTIATION_FAILED` | Negotiation fails rather than guessing | Yes |
| Generated type drift | lines 113–114 — generator check exits `0` and reports current | Canonical schemas and TypeScript remain byte-aligned | Yes |

## Check B — Non-shallow

The 41 tests execute Ajv 2020 strict compilation/validation against real schema files, compare full registry/value results, assert exact stable errors, and run the generator as a subprocess. Each of four schemas has one positive, one negotiation, and seven distinct negative document-shape cases.

## Check C — Necessary reverse mapping

| Test group | Maps to | Keep |
| --- | --- | --- |
| Registry/positive/negative cases | VES-SPC-001…005, VES-CLI-005 | Yes |
| Version compatibility | VES-SPC-005 | Yes |
| Generator drift | T11 done criterion and VES-TST-007 | Yes |

## Check D — Guidelines

Tests follow AD-014, T11, JSON Schema 2020-12 strict boundaries, and T10 gates. Ajv is the only third-party library permitted inside contracts. Generated unconstrained JSON is `unknown`, not `any`.

## Adequacy verdict

PASS — all criteria have exact evidence, 41 discriminating cases exceed the ≥30 threshold, and no test exceeds T11 scope.
