# T23 Canonical CLI Validation

## Scope

- Task: T23 — Implement canonical CLI, JSON output, and alias equivalence
- Requirements: VES-CLI-001…005, VES-WSP-001/006, and VES-BST-002/004 at the command-surface boundary
- Commit target: `feat(cli): add vestra command surface`
- Focused evidence: 47 cases — 41 contract and 6 e2e
- Spec deviations: none

T23 creates the canonical `apps/vestra-cli/` composition root, two package launchers, a pure installed-manifest-driven parser, human/JSON renderers, stable public errors and exit codes, and an application `CommandBus` port. The invocation spelling is deliberately absent from dispatched commands and contexts, making alias equivalence structural rather than handler convention.

Signed bundle installation, atomic active-release switching, and concrete command composition remain owned by later release and command tasks. This slice preserves the active release on manifest/compatibility failure because all validation is read-only and occurs before `CommandBus.execute`.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/cli-surface.test.mjs tests/e2e/cli-launchers-e2e.test.mjs` | PASS — 47 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,208 unit, 82 contract, 135 integration, 16 e2e, and 32 fault cases |
| `node --test tests/architecture/*.test.mjs` | PASS — 10 passed, 0 failed/skipped |
| `corepack pnpm@10.34.5 install --offline --frozen-lockfile --ignore-scripts` | PASS — all 17 workspace projects restored from the frozen lock |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| VES-CLI-001: canonical version identity | `tests/contract/cli-surface.test.mjs:28`, `:35`, `:43` | Both names exit 0 and emit the same semantic version/release digest; JSON validates | Yes |
| VES-CLI-002: alias equivalence is structural | `tests/contract/cli-surface.test.mjs:91`, `:97`; `tests/e2e/cli-launchers-e2e.test.mjs:16` | Alias spelling cannot enter dispatch; commands, context, stdout, stderr, and exit code match for version/help/sync/unknown | Yes |
| VES-CLI-003: help is installed-manifest-driven | `tests/contract/cli-surface.test.mjs:51`, `:58`, `:64` | Product and canonical name appear; only installed commands are listed | Yes |
| VES-CLI-004/005: stable pre-dispatch failure | `tests/contract/cli-surface.test.mjs:161`, `:170`, `:191` | Unsupported output, incompatible release, and invalid installed manifest return stable non-zero outcomes with zero dispatch | Yes |
| VES-CLI-005: clean versioned JSON stdout | `tests/contract/cli-surface.test.mjs:43`, `:122`, `:129`, `:198`; `tests/e2e/cli-launchers-e2e.test.mjs:25` | One `cli-output@1` document on stdout; diagnostics use stderr; private text is absent | Yes |
| Canonical command dispatch | `tests/contract/cli-surface.test.mjs:83` | Every installed command becomes one typed canonical command | Yes |
| Schema-driven option parsing | `tests/contract/cli-surface.test.mjs:106`, `:112`, `:118` | Boolean/string/enum options preserve exact manifest names and values | Yes |
| Unknown/ambiguous input fails before mutation | `tests/contract/cli-surface.test.mjs:152` | Eight unknown, missing, duplicated, positional, and mixed-global cases cause zero bus calls | Yes |
| Stable safe public errors | `tests/contract/cli-surface.test.mjs:198`, `:212`, `:221`, `:232` | Known errors preserve schema/exit; unknown exceptions sanitize; human failures use stderr; exact catalog validates | Yes |
| Hermetic launchers | `tests/e2e/cli-launchers-e2e.test.mjs:16`, `:25` | Real child processes prove byte-identical alias behavior and parseable clean stdout | Yes |
| Minimum test floor | Focused runner: 47 passed | At least 35 contract/e2e cases | Yes |

No T23-owned precision gap remains. Existing T20/T22 services own init/reconcile semantics; T23 defines the typed dispatch boundary and does not duplicate them.

## Check B — non-shallow litmus

- Alias tests compare real child-process status/stdout/stderr across success, JSON, mutable-command failure, and unknown-command paths.
- The contract test verifies invocation spelling is not present anywhere in the bus call, preventing implementation branches by alias.
- Help removes a command from the installed manifest and asserts the output removes it; a hard-coded help surface fails.
- Eight invalid-input cases assert zero bus calls, so post-dispatch validation fails.
- JSON tests parse and validate the exact stdout document against `cli-output@1` and independently assert diagnostics on stderr.
- A private sentinel exception is injected and asserted absent from serialized output.
- Offline frozen installation proves package-bin and workspace dependency metadata are reproducible.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `cli-surface.test.mjs:28,35,43` | VES-CLI-001 version/digest and alias identity | Yes |
| `cli-surface.test.mjs:51,58,64` | VES-CLI-003 manifest-derived help | Yes |
| `cli-surface.test.mjs:83,91,97` | VES-CLI-002 typed dispatch and structural alias equivalence | Yes |
| `cli-surface.test.mjs:106,112,118,152` | Pure schema-driven parsing and fail-before-dispatch | Yes |
| `cli-surface.test.mjs:122,129,198,212,221,232` | VES-CLI-005 stream separation, schema, stable safe failures | Yes |
| `cli-surface.test.mjs:170,191` | VES-BST-005-style installed release compatibility preflight | Yes |
| `cli-launchers-e2e.test.mjs:16,25` | Real launcher equivalence and clean JSON process output | Yes |

All 47 cases map to a named requirement or T23 done-when criterion. No speculative test remains.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: contract and e2e layers exceed the mandated floor and `gate:full` passes.
- Followed Design §4.1: parser/renderers are in `apps/vestra-cli`, dispatch is through an application port, and JSON never shares stdout with diagnostics.
- Followed AD-013/026: the CLI is the composition root; application owns only backend-neutral command contracts; all architecture tests remain green.
- Followed AD-027/029: JSON uses the generated `CliOutput` contract and public errors come from an immutable safe-detail registry.
- Followed AD-037/038: incompatible installed configuration is rejected before bootstrap/sync/reconcile dispatch.

## Adequacy verdict

PASS. Every T23-owned surface criterion has discriminating evidence, all 47 focused cases are traceable, the complete full gate and architecture suite are green, and frozen offline installation succeeds.
