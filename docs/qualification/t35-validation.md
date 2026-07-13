# T35 Claude Code Driver Validation

## Scope

- Task: T35 — Implement Claude Code Driver
- Requirements: VES-MDL-002/005, VES-HOF-004, VES-TST-005/008
- Commit target: `feat(drivers): add claude code adapter`
- Focused evidence: 22 cases (17 contract, 5 integration)
- Spec deviations: none

T35 adapts the qualified Claude Code CLI to the common Driver contract through a locked-down one-shot `stream-json` process. Version/capability probing completes before context resolution or spawn; the runtime model must match the selected Passport; provider session persistence, settings, slash commands, Chrome, MCP expansion, ambient credentials, and session reuse are disabled or excluded.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/claude-code-driver.test.mjs tests/integration/claude-code-driver-lifecycle.test.mjs` | PASS — 22 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,418 unit, 208 contract, 167 integration, 16 E2E, and 49 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion | Evidence | Outcome | Covered |
| --- | --- | --- | --- |
| Probe/compatibility | Available, unsupported, missing, and pre-spawn integration cases | Exact compatible version required before execution | Yes |
| Locked invocation | Argument and environment cases | Structured stdin, no persistence/settings/MCP/tools escalation | Yes |
| Common lifecycle | Success contract | Ordered session/model/content/usage/close events | Yes |
| Exact identity | Passport revision, selected model, and runtime model mutations | Any mismatch blocks or terminates | Yes |
| Stream validation | Malformed JSON, invalid tool, invalid usage, provider error | Closed shapes and nonnegative safe usage required | Yes |
| Privacy/portability | Ambient/explicit session, redaction, portable-result cases | No credential or provider session state crosses the adapter | Yes |
| Cancellation | Pre-abort and live process-tree termination | No spawn on pre-abort; live process is terminated | Yes |
| Local session behavior | Idempotent close and foreign-instance cases | One terminal event; references are adapter-local | Yes |
| Minimum floor | Focused runner: 22 | At least 18 cases | Yes |

## Non-shallow and reverse-mapping checks

- Major/minor incompatibility prevents both execution resolution and process spawn.
- Prompt bytes enter structured stdin and never command arguments.
- Both ambient session inheritance and explicit session-ID injection are removed.
- Runtime model identity is learned from the init event and compared before `model.resolved` is emitted.
- Tool IDs/names and usage values are validated before common events are produced.
- Secret-bearing stdout is redacted; stderr and provider session IDs are never emitted.
- Live abort proves the injected process-tree terminator is called exactly once.

All 22 cases map directly to T35 requirements and done-when criteria. Codex and OpenCode portability remain T36–T37.

## Guideline conformance and verdict

Tests preceded implementation, the focused floor is exceeded, the T33 common port is reused, the T03-qualified CLI protocol is preserved, and the complete gate passes. PASS.
