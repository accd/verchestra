# T05 Validation — OpenCode/Qwen Driver

**Gate:** `corepack pnpm@10.34.5 gate:full`  
**Result:** 72 passed, 0 failed, 0 skipped, 0 todo (17 T05 cases)  
**SPEC_DEVIATION:** T05 refines `run --format json` to fallback-only; the complete Driver uses Server + SDK because `run` owns permission replies internally.

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Required outcome | Covered |
| --- | --- | --- | --- |
| Exact binary probe | `opencode-driver.test.mjs` — repo-local 1.17.18 | Detection without inference | Yes |
| Version drift blocks | unsupported 1.16 fixture | No silent compatibility assumption | Yes |
| Safe run fallback | pure/json/stdin flags; bypass flags absent | Read-only/no-tools fallback only | Yes |
| Generic catalog | Qwen and other model share resolver | No hard-coded model-family branch | Yes |
| Missing model blocks | prompt call absent | Hard filter before invocation | Yes |
| Server policy | loopback/ephemeral/share-disabled/ask-all exact | Controlled integration baseline | Yes |
| Explicit tools | exact prompt tool map | No implicit tool grant | Yes |
| Built-in tool rejection | non-`vestra_*` tool blocks before prompt | Effects cannot bypass the MCP bridge | Yes |
| Permission allow | normalized request and `once` | Controller mediates grant | Yes |
| Permission deny | exact `reject` | Policy denial fails closed | Yes |
| Events and accounting | identity/text/tokens/cache/cost/close exact | Common Driver obligations preserved | Yes |
| Malformed envelope | stable stream error | Invalid events rejected | Yes |
| Provider failure | stable typed error | Failure remains evidence | Yes |
| Cancellation | abort precedes close | Protocol cancel before teardown | Yes |
| Credential isolation | ambient corporate key absent | Explicit binding only | Yes |
| Redaction and state | secret/session ID absent | No sensitive or session state in portable output | Yes |

## Checks B–D

- **Non-shallow:** tests execute the real pinned version probe and exercise an asynchronous SDK-compatible provider/session/event/permission server boundary. Assertions verify values, call ordering, absence, and fail-closed outcomes.
- **Necessary:** cases map to VES-MDL-001…005, VES-BST-002, VES-HOF-003…004, and the T05 Done-when. The protocol refinement closes an authorization gap discovered in upstream source rather than weakening the requirement.
- **Guidelines:** official OpenCode docs and source establish CLI stdin, JSON events, server/SDK control, provider/model identity, and permission behavior. Real inference is intentionally excluded.

## Independent adequacy verdict

PASS — the recorded full gate is 72/72. Tests were written before the adapter implementation, the missing module failure was observed, and no assertion was deleted, skipped, or relaxed. T37 remains responsible for production process, authentication, local-profile, MCP-effect, and network isolation controls explicitly listed in the qualification record.
