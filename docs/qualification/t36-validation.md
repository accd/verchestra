# T36 Codex Driver Validation

## Scope

- Task: T36 — Implement Codex Driver
- Requirements: VES-MDL-001…005, VES-HOF-004, VES-TST-005/008
- Commit target: `feat(drivers): add codex adapter`
- Focused evidence: 25 cases (19 contract, 6 integration)
- Spec deviations: none

T36 adapts the qualified Codex app-server JSONL protocol to the common Driver port. It requires a compatible CLI before resolution/spawn, selects the exact Passport model from the live catalog, creates only ephemeral read-only threads, exposes only declared dynamic tools, declines built-in effects, streams common events, and cancels through protocol interrupt before process-tree termination.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/codex-driver.test.mjs tests/integration/codex-driver-lifecycle.test.mjs` | PASS — 25 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,418 unit, 227 contract, 173 integration, 16 E2E, and 49 fault cases |

## Adequacy matrix

| Criterion | Evidence | Covered |
| --- | --- | --- |
| Version/capability preflight | Compatible, unsupported, unavailable, and pre-spawn integration cases | Yes |
| Local locked transport | Stdio arguments and JSONL handshake cases | Yes |
| Read-only ephemeral authority | Thread params and built-in approval denial | Yes |
| Exact model identity | Passport mutations and missing live-catalog model | Yes |
| Dynamic tools | Name/schema-digest binding, declared request, undeclared rejection | Yes |
| Stream/usage | Ordered success, malformed, provider error, output bound | Yes |
| Cancellation | Pre-abort plus interrupt-before-tree-kill integration | Yes |
| Privacy | Ambient credential/thread exclusion, redaction, portable lifecycle | Yes |
| Local lifecycle | Idempotent close and foreign-instance rejection | Yes |
| Minimum floor | 25 focused cases versus required 18 | Yes |

## Non-shallow checks

- Prompt exists only inside `turn/start` JSONL and never argv/session references.
- Runtime selection comes from `model/list`; a requested but absent model fails before thread creation.
- Thread authority is always ephemeral, read-only, untrusted, and human-reviewed.
- Undeclared dynamic tool calls terminate; declared calls emit a request but receive no inline execution authority.
- Command/file approval requests are explicitly declined and evidenced.
- Valid `turn/completed` followed by controller shutdown is not misclassified as provider failure.
- Cancellation ordering proves `turn/interrupt` precedes bounded process-tree termination.
- Thread/turn IDs, credentials, and secret-bearing content never enter portable outputs.

## Verdict

PASS. Tests preceded implementation, the common Driver contract is preserved, the T04-qualified app-server behavior is reused, the focused floor is exceeded, and the complete repository gate passes.
