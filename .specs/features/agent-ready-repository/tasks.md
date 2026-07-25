# Agent-Ready Repository and LLM Discovery Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification | Commit |
| --- | --- | --- | --- | --- |
| T1 | Feature spec, decisions, GitHub issue, corrected website state | None | Status consistency tests | `docs(ai): specify the agent-ready repository contract` |
| T2 | Root/scoped AGENTS files, repository map, Claude/Gemini pointers | T1 | Instruction hierarchy and pointer contract tests | `docs(ai): add model-agnostic repository instructions` |
| T3 | `agent:context`, handoff parser, `agent:check`, quick-gate integration | T2 | Unit, contract, Windows/Linux path, and mutation tests | `feat(ai): expose verified repository context` |
| T4 | Neutral feature templates, contribution process, issue and PR handoff fields | T3 | Handoff transition and schema tests | `docs(ai): standardize portable feature handoffs` |
| T5 | Evaluation corpus, generic runner, fake adapter, optional live matrix | T4 | Deterministic corpus plus available real-agent runs | `test(ai): qualify cross-agent repository collaboration` |
| T6 | Root `llms.txt`, site endpoints, full-context compiler, Markdown alternates | T3 | Content, path, size, status, and link tests | `feat(site): publish LLM-readable documentation` |
| T7 | Public agent guide, metadata, navigation, robots, topics, governance docs | T5, T6 | Site unit, Playwright, Axe, Lighthouse, SEO checks | `docs(site): expose agent contribution and discovery metadata` |
| T8 | Clean-clone acceptance, public deployment readiness, independent verification and handoff | T7 | Full gates, built-output checks, discrimination sensor | `docs(ai): complete the agent-ready repository handoff` |

T5 and T6 may be developed independently after T3, but commits remain
sequential for an auditable history.

## Gate Commands

| Level | Command |
| --- | --- |
| Task-focused | The exact verification command listed for the task evidence. |
| Quick | `pnpm gate:quick` |
| Site | `pnpm site:test && pnpm site:build` |
| Acceptance | `pnpm agent:check && pnpm gate:quick && pnpm site:test && pnpm site:build` |

## Test Coverage Matrix

| Layer | Required evidence |
| --- | --- |
| Instructions and commands | Exact hierarchy, pointer, path, link, budget, command, and workspace coverage assertions. |
| Context and handoff | Clean/dirty/detached/missing-Git, Windows/POSIX, transitions, replay, and redaction assertions. |
| Agent evaluation | Deterministic correct-routing and malicious-instruction cases with patch/result assertions. |
| LLM compiler | Structure, ordering, provenance, digest, status, size, redaction, and alternate parity assertions. |
| Site and metadata | Direct base-path URLs, sitemap, robots, alternate links, navigation, accessibility, and prohibited claims. |
| Acceptance | Clean-clone commands plus independent requirement evidence and mutation kills. |

## Requirement Traceability

| Task | Requirements |
| --- | --- |
| T1 | AGT-03, AGT-06, LLM-07 |
| T2 | AGT-01, AGT-02, AGT-03, AGT-04, AGT-07 |
| T3 | AGT-05, AGT-06, AGT-08 |
| T4 | AGT-06, AGT-07 |
| T5 | AGT-09, AGT-10 |
| T6 | LLM-01, LLM-02, LLM-03, LLM-04, LLM-05 |
| T7 | AGT-07, LLM-06, LLM-07 |
| T8 | AGT-01–AGT-10, LLM-01–LLM-07 |

## Completion Rules

- One task, one passing task gate, one atomic commit.
- Tests derive from specification outcomes; no assertions are weakened,
  deleted, or skipped.
- T68 remains complete, T69 remains next, and this feature stays independent of
  the T69–T77 dependency chain.
- An independent verifier runs after T8 and human review remains required.

## Execution Evidence

| Task | Status | Commit |
| --- | --- | --- |
| T1 | Complete locally; issue write blocked externally | Pending |
| T2 | Complete | Pending |
| T3 | Complete | Pending |
| T4 | Complete | Pending |
| T5 | Complete | Pending |
| T6 | Complete | Pending |
| T7 | Planned | Pending |
| T8 | Planned | Pending |
