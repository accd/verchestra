# T06 Validation — Cedar Engine and Policy Oracle

**Gate:** `corepack pnpm@10.34.5 gate:security`  
**Result:** 122 passed, 0 failed, 0 skipped, 0 todo (50 T06 cases)  
**SPEC_DEVIATION:** none; native form was evaluated and rejected because no qualified release artifact exists.

## Check A — Sufficient coverage

| Done-when / requirement | Assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Parse and schema failures | `cedar-oracle.test.mjs:65-66` — `assert.equal(decision.decision, entry.expectedDecision)` and exact `decision.code`; corpus lines 27-28 | Stable deny | Yes |
| Strict policy validation | same assertions; corpus lines 29-30 | Stable deny | Yes |
| Request/schema incompatibility | same assertions; corpus lines 31-34 | Stable deny | Yes |
| Implicit deny | same assertions; corpus lines 3-7 and 20-25 | Deny when no permit matches | Yes |
| Forbid precedence | same assertions; corpus lines 9-13 and `cedar-oracle.test.mjs:82-83` | Deny; winning forbid identified | Yes |
| Lower layers only restrict | same assertions; corpus lines 14-18 | Every lower-layer permit is `VES_POLICY_NON_MONOTONIC` deny | Yes |
| Diagnostics/errors fail closed | same assertions; corpus lines 37-40 | Stable diagnostic/evaluation/engine deny | Yes |
| Explanation | `cedar-oracle.test.mjs:74-75,82-83` — exact determining IDs and explanation strings | Safe explainable allow/deny | Yes |
| Version incompatibility | corpus lines 35-36 through exact assertions at `cedar-oracle.test.mjs:65-66` | Engine/language mismatch deny | Yes |
| Egress attributes | corpus lines 19-25 through exact assertions at `cedar-oracle.test.mjs:65-66` | Classification, purpose, destination, retention, Workspace, policy all required | Yes |
| Approval/effect bindings | corpus lines 2-8 through exact assertions at `cedar-oracle.test.mjs:65-66` | Changed Approval/policy/capability/evidence/claim denies | Yes |
| Untrusted content | corpus line 41 through exact assertions at `cedar-oracle.test.mjs:65-68` | Content cannot promote authority or leak engine detail | Yes |
| Cross-form differential | `cedar-forms.test.mjs:31` — `assert.deepEqual(esmCedar.isAuthorized(call), nodeCedar.isAuthorized(call))` across five decisions | Official forms are semantically identical | Yes |
| One selected form | `cedar-forms.test.mjs:40` — `assert.equal(selected.id, "wasm-node")` | Exactly qualified Node WASM selected | Yes |
| No eligible form | `cedar-forms.test.mjs:44` — `assert.throws(... { code: "VES_CEDAR_FORM_UNQUALIFIED" })` | Selection fails closed | Yes |

## Check B — Non-shallow

The 40-case corpus asserts both the exact decision and exact stable code, requires a non-empty explanation, and checks that a thrown internal detail is absent. Separate assertions verify determining policy IDs and explanation text. Differential cases compare full official Cedar response objects rather than call counts.

## Check C — Necessary reverse mapping

| Test evidence | Maps to | Keep |
| --- | --- | --- |
| Corpus lines 2-18 + `cedar-oracle.test.mjs:65-68` | VES-SEC-001, VES-EXE-001…003 | Yes |
| Corpus lines 19-25 + `cedar-oracle.test.mjs:65-68` | VES-CTX-006 | Yes |
| Corpus lines 26-40 + `cedar-oracle.test.mjs:65-68` | VES-SEC-002 and T06 parse/schema/diagnostic/version criteria | Yes |
| Corpus line 41 + `cedar-oracle.test.mjs:65-68` | VES-SEC-006 | Yes |
| `cedar-oracle.test.mjs:74-75,82-83` | T06 explanation criterion | Yes |
| `cedar-forms.test.mjs:9-16,31` | T06 cross-form and exact-version criteria | Yes |
| `cedar-forms.test.mjs:40,44-47` | T06 release-form selection and fail-closed edge | Yes |

## Check D — Guidelines

Tests follow the policy/security expectations in `spec.md`, `design.md` sections 4.5 and 10, the T06 task, and the generated Test Coverage Matrix. They use the official exact-pinned engine and frozen expected outcomes; no dependency behavior is asserted without a Verchestra requirement mapping.

## Adequacy verdict

PASS — all T06 criteria have evidence-or-zero mappings, all 50 new cases are requirement-bound, the security gate passes without skips, and no test was weakened or removed.

