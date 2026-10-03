# Codex Driver Requalification: Structured Results, Account Checks, Quota, and Method Allowlist

**Task:** T4 of `.specs/features/strands-subscription-integration/` (SSI-46,
SSI-48, SSI-49, SSI-55..58, SSI-81; decision AD-073 and the Codex floor
decision recorded beside it)
**Status:** Candidate pending independent verification, the platform matrix,
and human review
**Installed Codex CLI observed:** `codex-cli 0.159.3` (read-only `--version`,
and `codex app-server generate-ts --experimental` into a disposable directory
with a disposable `HOME` and `CODEX_HOME`; no model invoked, no login read)
**Supersedes:** nothing. `docs/qualification/codex-driver.md` remains the
evidence for the T04 qualification at 0.115.0, and the child-run, process-tree,
cancel-order, and provider-ends reports remain the evidence for how the provider
runs. A session that asks for neither new behaviour sends exactly the T04
messages and emits the same events as before.

## What changed

- **Structured result.** An execution may carry
  `structuredOutput: { schema, maxBytes }`, validated before spawn
  (`VES_CODEX_OUTPUT_SCHEMA_INVALID`). `turn/start` then carries the canonical
  schema as `outputSchema`. The turn's last `agentMessage` item is read as JSON
  and bounded into one `result.structured`; no message, a message that is not
  JSON, or one over the bound is `VES_CODEX_STRUCTURED_OUTPUT_MISSING`,
  `_INVALID`, or `_LIMIT`.
- **Account checks.** An execution with `subscriptionOnly: true` sends
  `account/read` (`refreshToken: false`) and `account/rateLimits/read` after
  `initialized` and before `model/list`. An account that is not `chatgpt`
  (`apiKey`, `amazonBedrock`, none) is `VES_CODEX_AUTH_METHOD_MISMATCH`
  (SSI-55). Credits on any snapshot (`hasCredits`, `unlimited`, a balance that
  is not zero, or a malformed credits value) are `VES_CODEX_CREDITS_PRESENT`
  (SSI-56). `ordinaryUsageAllowed: false` emits `quota.exhausted`
  (`ordinary_usage_disallowed`) and ends the session with
  `VES_CODEX_QUOTA_EXHAUSTED`. No thread starts after a refusal. The e-mail
  address, account identifier, plan, and upsell are read past and never kept.
- **Quota during a turn.** `codexErrorInfo: "usageLimitExceeded"` emits
  `quota.exhausted` (`usage_limit_exceeded`) before the existing failure; an
  `account/rateLimits/updated` snapshot whose `rateLimitReachedType` is a
  usage-limit or credits-depleted kind emits `quota.exhausted` with that kind
  and the latest reset among its fully used windows. One per session; a
  transient `rate_limit_reached` emits none (SSI-58).
- **Method allowlist.** Every frame passes `codexWireFrame`, which refuses any
  method outside `initialize`, `initialized`, `account/read`,
  `account/rateLimits/read`, `model/list`, `thread/start`, `turn/start`, and
  `turn/interrupt` with `VES_CODEX_METHOD_DENIED`.
  `account/rateLimitResetCredit/consume`, `account/sendAddCreditsNudgeEmail`,
  and every login method exist in 0.159.3 and are absent from the list
  (SSI-57).

## Version floors

- **New protocol:** `CODEX_STRUCTURED_MINIMUM_VERSION` is `0.159.3`, the build
  whose generated protocol was read: `TurnStartParams.outputSchema`,
  `account/read` returning `Account` (`apiKey`, `chatgpt`, `amazonBedrock`),
  `account/rateLimits/read` returning `ordinaryUsageAllowed` and
  `RateLimitSnapshot` with `CreditsSnapshot` and `rateLimitReachedType`,
  `CodexErrorInfo.usageLimitExceeded`, `account/rateLimits/updated`, and
  `agentMessage` items. No older build was available, so 0.159.3 is the lowest
  build observed with all of them, not a proven first version.
- **T04 conversation:** the default floor stays `0.115.0`. The v1 verifier uses
  it, and `vestra task` probes no Codex version before a run, so a raised
  default would fail a v1 run on 0.115.0 to 0.159.2 only at verification.

**What an owner with an older Codex sees.** On a build from 0.115.0 to
0.159.2, every v1 run behaves exactly as before. A Codex session that asks for
a structured result or the subscription-only checks is refused with
`VES_CODEX_VERSION_UNSUPPORTED` ("Codex version is unsupported") before any
process starts; T6's preflight is to report it as `not configured`. Below
0.115.0, or on another major line, every Codex session is refused as before.

## What the deterministic fake proved

The production `CodexDriver` runs against the labeled fake
`spikes/codex-driver/test/fake-codex-app-server.mjs`, which now answers the two
account reads (with an e-mail address, an account identifier, and an upsell a
driver must drop), refuses methods it does not serve, and plays the structured
and quota modes in the 0.159.3 shapes.

- `pnpm qualify:codex` runs `spikes/codex-driver/test/codex-driver-structured.test.mjs`
  (5 cases): the exact sequences of a structured subscription-only turn, the two
  account refusals, quota before and during a turn, the floor comparison, and
  the read-only protocol generation of the installed Codex at or above the floor
  (below it, the case reports the build and the refusal instead).
- `tests/contract/codex-driver-structured.test.mjs` (14 cases) pins the
  allowlist, the frame guard, the methods every fake mode sends, the unchanged
  T04 conversation, the structured answer and its failures at the bound, the
  floor, the malformed requests, the account order, every account and credit
  refusal, and the three quota signals.
- `tests/architecture/codex-client-methods.test.mjs` (3 cases) pins the single
  write path through `codexWireFrame`, literal allowlisted method names, and the
  absence of every denied method name from product code.
- `tests/security/driver-structured-results-security.test.mjs` finds no account
  data, provider prose, or thread, turn, or session identity in any event or
  close of five account and quota modes.
- Every existing Codex suite (contract, lifecycle, integration, child run,
  cancel order, process tree, provider ends, identity probe, T04 spike) passes
  with no edit, so no pinned sequence changed.

## Limits

- Deterministic fake plus a read-only protocol generation; no account was read
  and no turn was run. The generated schema types `resetsAt` as an int64
  without a unit; the driver reads it as Unix epoch seconds, as Claude Code
  documents its own, and a value no canonical instant can spell in seconds (a
  millisecond value, for example) is dropped, never guessed.
- The fleet keeps its pinned 0.115.0 for the T04 qualification, so on CI the
  protocol-generation case reports the older build; it ran here against 0.159.3.
  Moving the fleet pin is a separate, owner-approved change.
- The driver reports quota signals; stopping and suspending the run belong to
  the driver execution adapter and T6.
- Codex nodes run on Windows, macOS, and Linux through the same App Server
  path; the platform matrix run is the coordinator's.
