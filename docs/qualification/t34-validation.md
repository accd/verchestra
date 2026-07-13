# T34 Pi Driver Validation

## Scope

- Task: T34 — Implement Pi Driver
- Requirements: VES-MDL-001/005, VES-CTX-001, VES-SKL-005
- Commit target: `feat(drivers): add pi adapter`
- Focused evidence: 23 cases (17 contract, 6 integration)
- Spec deviations: none

T34 supplies the first production adapter behind the T33 Driver port. It resolves one exact Passport-bound Pi model, consumes only the already serialized neutral context, streams common events, mediates tools, reports provider usage, propagates abort, preserves contiguous event sequence across follow-ups, and confines transcript/session state to the adapter instance until explicit close or cancellation.

## Deterministic gates

| Command | Result |
| --- | --- |
| `node --test tests/contract/pi-driver.test.mjs tests/integration/pi-driver-lifecycle.test.mjs` | PASS — 23 passed, 0 failed/skipped |
| `node scripts/gate.mjs full` | PASS — format, lint, typecheck, 1,418 unit, 191 contract, 162 integration, 16 E2E, and 49 fault cases |

## Check A — sufficient, spec-anchored coverage

| Criterion / requirement | Exact assertion evidence | Spec-defined outcome | Covered |
| --- | --- | --- | --- |
| Qualified probe | `tests/contract/pi-driver.test.mjs` | Exact package/version and stream/tool/usage/abort capabilities | Yes |
| Common lifecycle | `tests/contract/pi-driver.test.mjs` | Session, model, content, usage, and close events are common and contiguous | Yes |
| Resolved identity | Four identity mutations | Passport ID/revision, provider, API, and resolved model must all agree | Yes |
| Context boundary | Capacity and system-prompt negatives | Overflow blocks before provider; Pi receives no extra system instructions | Yes |
| Tool boundary | Declaration/digest/allow/deny cases | Concrete tools match exact authorized schemas and execute only after mediation | Yes |
| Provider failures | Error and output-limit cases | Private provider text is redacted into stable common diagnostics | Yes |
| Abort | Pre-start and live-provider cases | Pre-abort prevents resolution; live abort reaches Pi and emits stable evidence | Yes |
| Follow-up | Integration lifecycle case | `send()` reuses only its session and preserves contiguous event ordering | Yes |
| Session locality | Fresh-run, close, cancel, and foreign-instance cases | No transcript crosses runs/instances or enters returned artifacts | Yes |
| Minimum floor | Focused runner: 23 | At least 18 common/Pi-specific contract and integration cases | Yes |

## Check B — non-shallow litmus

- Identity mutations isolate Passport revision, provider, API, and resolved model independently.
- Context capacity is rejected before the faux provider receives any call.
- An extra Pi system prompt is rejected because T30 already sealed all semantics inside the serialized context.
- Tool name and input-schema digest are both bound; an allowed call executes once and a denied call executes zero times.
- A secret-bearing provider error is absent from every emitted event.
- A live `AbortSignal` terminates an in-flight real Pi `Agent` stream rather than only changing local state.
- Two starts observe fresh transcript length, while a follow-up intentionally stays within one session and one event sequence.

## Check C — necessary reverse mapping

| Test evidence | Requirement / criterion | Keep |
| --- | --- | --- |
| `pi-driver.test.mjs` | Probe, identity, context, tools, usage, provider errors, redaction | Yes |
| `pi-driver-lifecycle.test.mjs` | Fresh state, follow-up, live abort, idempotent terminal behavior, instance isolation | Yes |

All 23 focused cases map to T34 requirements or done-when criteria. CLI-based Claude/Codex/OpenCode portability remains T35–T37.

## Check D — guideline conformance

- Followed `.specs/features/verchestra-1.0/tasks.md`: contract/integration tests preceded implementation, the focused floor is exceeded, and `gate:full` passes.
- Reuses the T33 Driver port/event contract and T30 Pi serialization rule instead of creating a Pi-specific orchestration path.
- Uses the pinned and T02-qualified `@earendil-works/pi-agent-core` runtime.
- Encapsulates vendor declarations behind a narrow structural boundary so optional provider SDK declaration defects cannot weaken strict project typechecking.
- Provider messages, prompts, transcripts, model headers, and tool results are never returned as canonical artifacts.

## Adequacy verdict

PASS. T34 exceeds its test floor, binds exact resolved identity and tool schemas, proves streaming/usage/abort/follow-up behavior, redacts provider failures, keeps Pi state session-local, and passes the complete repository gate.
