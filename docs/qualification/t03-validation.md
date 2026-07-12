# T03 Validation — Claude Code Driver

**Gate:** `corepack pnpm@10.34.5 gate:full`  
**Result:** 40 passed, 0 failed, 0 skipped, 0 todo (12 T03 cases)  
**SPEC_DEVIATION:** none

## Check A — Sufficient coverage

| Criterion | Assertion evidence | Required outcome | Covered |
| --- | --- | --- | --- |
| Installed CLI is detected without model use | `spikes/claude-code-driver/test/claude-driver.test.mjs:15-18` — available/version/stream/no-session fields exact | Read-only capability probe succeeds for 2.1.168 | Yes |
| Incompatible version blocks | `claude-driver.test.mjs:23-24` — unavailable and `VES_CLAUDE_VERSION_UNSUPPORTED` | Unsupported CLI fails before session | Yes |
| Invocation is structured and locked down | `claude-driver.test.mjs:29-35` — required flags true, dangerous flags false | Safe stream-json baseline | Yes |
| Prompt is stdin-only | `claude-driver.test.mjs:40-41` — exact echo and argv absence | Private prompt is not process metadata | Yes |
| Identity/events/usage are normalized | `claude-driver.test.mjs:46-50` — model, lifecycle, delta, usage/cost exact | Common Driver evidence is preserved | Yes |
| Tool request is data only | `claude-driver.test.mjs:55-60` — exact normalized tool object | Claude request does not execute a tool in the Driver | Yes |
| Malformed stream fails closed | `claude-driver.test.mjs:65-66` — stop error and `VES_CLAUDE_STREAM_INVALID` | Invalid NDJSON cannot become events/actions | Yes |
| Execution failure is stable | `claude-driver.test.mjs:71-73` — stop/code/message exact | Claude error remains typed evidence | Yes |
| Cancellation terminates process contract | `claude-driver.test.mjs:84-86` — integer terminated PID, aborted/code exact | Controller cancel reaches tree terminator | Yes |
| Ambient credentials are excluded | `claude-driver.test.mjs:95-96` — no API key, explicit fixture env preserved | Environment is allowlist plus explicit binding | Yes |
| Sensitive output is redacted | `claude-driver.test.mjs:107-109` — secret absent; stdout/stderr redacted exact | No credential material leaves adapter | Yes |
| Session identity is non-portable | `claude-driver.test.mjs:114-115` — private ID absent and no session field | Claude session never enters portable result | Yes |

## Checks B–D

- **Non-shallow:** tests execute a real local version probe and real child processes; they assert output/state/error values, not spawn call counts alone.
- **Necessary:** each test maps to T03 Done-when, VES-MDL-002/005, or VES-HOF-004; no speculative provider behavior is tested.
- **Guidelines:** follows the Driver contract matrix and T03 in `tasks.md`; model calls are intentionally excluded because T03 qualification needs protocol proof, not paid output quality.

## Verdict

PASS — all prior and 12 T03 cases pass with zero skip. Tests are spec-anchored and were not weakened, deleted, skipped, or deferred.
