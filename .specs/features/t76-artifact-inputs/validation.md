# T76 Artifact Input Validation

Validation is recorded for the incremental artifact-input slice only. It does
not claim T76/#17 completion.

| Requirement                            | Evidence                                                                                        | Result |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| AI-01 boundary checks                  | `tests/build/release-artifact-inputs.test.mjs` traversal, missing, and directory assertions     | PASS   |
| AI-02 bytes determine identity         | `tests/build/release-artifact-inputs.test.mjs` complete bundle assertion and digest/size checks | PASS   |
| AI-03 no machine path projection       | `tests/build/release-artifact-inputs.test.mjs` root/source-path redaction assertion             | PASS   |
| AI-04 deterministic and duplicate-safe | `tests/build/release-artifact-inputs.test.mjs` reversed-order and duplicate-source assertions   | PASS   |

## Checks

- `node --test tests/build/release-artifact-inputs.test.mjs` — 5 passed, 0
  failed, skipped, or todo.
- `corepack pnpm typecheck` — PASS.
- `corepack pnpm agent:check` — PASS.
- `corepack pnpm gate:quick` — PASS (2093 unit + 153 readiness cases; zero
  failures/skips/todos).
- `corepack pnpm gate:release` — PASS (2093 unit, 39 architecture, 251
  qualification, 1077 security, 284 fault, and 28 release cases; zero
  failures/skips/todos).

Independent sensor review and the original #17 acceptance criteria remain
required for the PR and for T76 completion.
