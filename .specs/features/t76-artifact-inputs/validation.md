# T76 Artifact Input Validation

Validation is recorded for the incremental artifact-input slice only. It does
not claim T76/#17 completion.

| Requirement                            | Evidence                                                                                        | Result |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| AI-01 boundary checks                  | `tests/build/release-artifact-inputs.test.mjs` traversal, missing, and directory assertions     | PASS   |
| AI-02 bytes determine identity         | `tests/build/release-artifact-inputs.test.mjs` complete bundle assertion and digest/size checks | PASS   |
| AI-03 no machine path projection       | `tests/build/release-artifact-inputs.test.mjs` root/source-path redaction assertion             | PASS   |
| AI-04 deterministic and duplicate-safe | `tests/build/release-artifact-inputs.test.mjs` reversed-order and duplicate-source assertions   | PASS   |
| T76-INPUT-01 exact revision and host binding | `tests/build/reproducible-target-build.test.mjs` exact `HEAD`, platform/architecture, Node runtime, and native asset assertions | PASS |
| T76-INPUT-02 complete gate evidence | `tests/build/reproducible-target-build.test.mjs` rejects missing, failed, skipped, todo, and surviving-mutant evaluations | PASS |
| T76-INPUT-03 byte reproducibility | `tests/build/reproducible-target-build.test.mjs` runs two isolated builds from identical inputs and compares every emitted file | PASS |
| T76-CANDIDATE-01 closure from real projections | `tests/build/t76-candidate-materializer.test.mjs` validates bundle, component manifest, build-info, payload bytes, four views, and rollback before writing | PASS |
| T76-CANDIDATE-02 fail-closed mutation handling | `tests/build/t76-candidate-materializer.test.mjs` rejects payload mutation, output overwrite, and self-referential rollback | PASS |

## Checks

- `node --test tests/build/release-artifact-inputs.test.mjs` — 5 passed, 0
  failed, skipped, or todo.
- `node --test tests/build/reproducible-target-build.test.mjs` — 3 passed, 0
  failed, skipped, or todo.
- `node --test tests/build/t76-candidate-materializer.test.mjs` — 3 passed, 0
  failed, skipped, or todo.
- `corepack pnpm typecheck` — PASS.
- `corepack pnpm agent:check` — PASS.
- `corepack pnpm gate:quick` — PASS (2093 unit + 153 readiness cases; zero
  failures/skips/todos).
- `corepack pnpm gate:security` — PASS (2093 unit, 39 architecture, 251
  qualification, 1087 security, 165 e2e, and 284 fault cases; zero
  failures/skips/todos).
- `corepack pnpm gate:release` — PASS (2093 unit, 39 architecture, 251
  qualification, 1087 security, 165 e2e, 284 fault, and 28 release cases;
  zero failures/skips/todos).
- SonarCloud Code Analysis for PR #324 at `d330848` — PASS.

Independent sensor review and the original #17 acceptance criteria remain
required for the PR and for T76 completion.
