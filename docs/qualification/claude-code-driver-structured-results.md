# Claude Code Driver Requalification: Structured Results, Authentication Source, and Quota

**Task:** T4 of `.specs/features/strands-subscription-integration/` (SSI-46,
SSI-48, SSI-49, SSI-54, SSI-57, SSI-58, SSI-81; decision AD-073)
**Status:** Candidate pending independent verification, the platform matrix,
human review, and the optional owner-run probe below
**Installed Claude Code observed:** 2.1.282 (read-only `--version` and `--help`,
and a read of the message schemas the installed build declares; no model
invoked, no login or token command run)
**Supersedes:** nothing. `docs/qualification/claude-code-driver-subscription.md`,
`docs/qualification/claude-code-driver-mediated.md`, and
`docs/qualification/claude-code-driver.md` remain the evidence for the
subscription, mediated, and T03 profiles. A session that asks for no structured
result runs the same invocation and emits the same events as before.

## What changed

- **Structured result (mediated profiles only).** An execution may carry
  `structuredOutput: { schema, maxBytes }`. Before spawn the driver requires
  exactly those two members, a schema that is a canonical JSON object of at most
  16 KiB, and a bound from 1 byte to 1 MiB; anything else, or a structured
  request on the T03 profile, is `VES_CLAUDE_OUTPUT_SCHEMA_INVALID`. The
  invocation then adds `--json-schema <canonical schema>` just before `--model`
  and allows `StructuredOutput` beside the five bridge tools in
  `--allowedTools`; nothing else moves. The final `result` event's
  `structured_output` becomes one `result.structured { value, bytes }`, bounded
  before it is emitted. A success without it, or
  `error_max_structured_output_retries`, is
  `VES_CLAUDE_STRUCTURED_OUTPUT_MISSING`; an answer over the bound is
  `VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT`. The `StructuredOutput` call carries the
  answer and has no effect, so it is no `tool.requested` in a structured
  session; a session that asked for no schema refuses the tool at init and
  keeps an unasked call a tool request, which the driver execution adapter
  refuses.
- **Effective authentication (subscription profile).** The `system/init`
  event must report `apiKeySource: "none"`. Any other source fails the session
  with `VES_CLAUDE_AUTH_METHOD_MISMATCH` before it is announced and before any
  tool effect. The bare profile authenticates with an API key by design and is
  not checked.
- **Quota.** A `rate_limit_event` with `rate_limit_info.status: "rejected"`
  emits one `quota.exhausted` per session: the window (`five_hour`,
  `seven_day`, `seven_day_opus`, `seven_day_sonnet`,
  `seven_day_overage_included`, `overage`, otherwise `unknown`) as its scope,
  and `resetsAt` only when the event gave one. `allowed_warning` records one
  `VES_CLAUDE_QUOTA_WARNING` and the session continues. Nothing else of the
  event (purchase offers, overage reasons, utilization, the session) is read.
- **No paid fallback.** No `--fallback-model`, `--max-budget-usd`, API key, or
  key helper is ever passed (SSI-57); the argument lists are pinned.

## Message shapes

The fake's `system/init` (`apiKeySource`), `result` (`structured_output`,
`subtype`, `is_error`), and `rate_limit_event` (`rate_limit_info.status`,
`resetsAt` in Unix epoch seconds, `rateLimitType`) follow the schemas the
installed 2.1.282 declares for its SDK messages, read from the installed build
without running it. That build sets `apiKeySource` from its API-key source, which
is `none` when only `CLAUDE_CODE_OAUTH_TOKEN` is set, and answers a schema
through a tool named `StructuredOutput`.

## What the deterministic fake proved

Mandatory gates contact no provider. The production `ClaudeCodeDriver` runs
against the labeled fake `spikes/claude-code-driver/test/fake-claude-mediated.mjs`,
which refuses a structured invocation whose arguments differ from the profile's.

- `pnpm qualify:claude` runs
  `spikes/claude-code-driver/test/claude-driver-structured.test.mjs` (5 cases):
  the exact event sequences of a structured success, a missing answer, exhausted
  retries, an answer one byte over its bound, a rejected rate limit, and an
  API-key source; and the read-only check that the installed build documents
  `--json-schema`.
- `tests/contract/claude-code-driver-structured.test.mjs` (9 cases) pins the
  invocation delta, the refusals before spawn, the init surface with and without
  a schema, both quota mappings, and the single warning.
- `tests/security/driver-structured-results-security.test.mjs` runs a structured
  session and a rejected rate limit through the driver execution adapter and
  finds no token, session, purchase field, or temporary path in its checkpoints,
  payload, or refusal.
- Every existing Claude Code suite (child run, cancel order, provider ends,
  input failure, mediated, subscription, lifecycle) passes with no edit, so no
  pinned sequence changed.

## What needs the owner

None of the following was observed against a real session; each is checked so
that a wrong assumption fails closed.

| To observe | What happens if the assumption is wrong |
| --- | --- |
| `stream-json` carries `structured_output` on the final `result` event of a `--json-schema` session | `VES_CLAUDE_STRUCTURED_OUTPUT_MISSING`; nothing is handed on |
| `--tools ""` with `--permission-mode dontAsk` lets `StructuredOutput` answer when it is named in `--allowedTools` | `VES_CLAUDE_STRUCTURED_OUTPUT_MISSING` or a retries error |
| Whether `system/init` lists `StructuredOutput` | Either is accepted in a structured session |
| A `CLAUDE_CODE_OAUTH_TOKEN` session reports `apiKeySource: "none"` | `VES_CLAUDE_AUTH_METHOD_MISMATCH` before any tool effect |
| A `rejected` rate limit arrives before the session's error result | The quota signal is missed and the session fails as before |

The optional owner-run probe is one small print-mode session on the owner's
subscription, outside any Verchestra run, in an empty directory, with a schema
such as `{"type":"object","additionalProperties":false,"required":["outcome"],"properties":{"outcome":{"enum":["done"]}}}`
passed to `claude --print --output-format stream-json --verbose --tools "" --allowedTools StructuredOutput --permission-mode dontAsk --json-schema <schema>`,
asking for the outcome `done`. It makes one model call. The owner checks the
`system/init` line (`apiKeySource`, `tools`) and the final `result` line
(`structured_output`) and records the observation in the T9 pilot record.

## Limits

- Deterministic fake plus read-only reads of the installed build; live
  behaviour is listed above and not claimed.
- macOS and Linux only. On Windows every mediated profile, and so every
  structured session, is refused at construction (`VES_CLAUDE_MEDIATION_UNSUPPORTED`)
  until T7 qualifies the named-pipe transport; the new tests assert that refusal
  there instead of skipping.
- A quota signal is reported, not acted on: stopping and suspending the run
  belong to the driver execution adapter and T6.
