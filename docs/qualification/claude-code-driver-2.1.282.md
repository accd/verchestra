# Claude Code Driver Requalification: 2.1.282

**Maintenance scope:** fleet pin refresh for #405 (PR #433)
**Status:** Candidate pending exact-head CI qualification
**Qualified build:** `@anthropic-ai/claude-code@2.1.282`

## Qualification boundary

This report records the move of the fleet's exact Claude Code pin from `2.1.168`
to `2.1.282`. It does not change the Driver architecture, the T03 invocation
profile, or the `mediated-mcp` profile. `docs/qualification/claude-code-driver.md`
remains the evidence for the original T03 qualification at `2.1.168`, and
`docs/qualification/claude-code-driver-mediated.md` remains the evidence for the
mediated profile. Neither is edited.

Claude Code remains behind the Driver port and owns no Verchestra policy,
workflow, artifact, Approval, or durable state.

## Why the pin moves

The mediated profile (decision AD-039) passes `--permission-prompts none`, which
the `2.1.168` build does not have. The mediated profile therefore requires
`2.1.282` or later within major 2. With the fleet on `2.1.168`, the read-only
`--help` probe of the mediated flags could not pass on CI. The pin moves to the
build the mediated profile was qualified against, so every fleet workflow now
exercises both profiles on one exact build.

## Version floors

- **T03 profile:** the driver's default minimum stays `2.1.168`. That build was
  qualified for T03 and is still accepted. `2.1.282` is the installed and
  pinned build, not a new floor.
- **Mediated profile:** `CLAUDE_MEDIATED_MINIMUM_VERSION` stays `2.1.282`. An
  older build is refused with `VES_CLAUDE_VERSION_UNSUPPORTED` before any
  process is launched with the mediated flags.

## Upstream review

The upstream changelog range `2.1.169` through `2.1.282` was checked for
changes that touch the flags and environment either profile depends on:
`--print`, stream-json input and output, `--verbose`,
`--include-partial-messages`, `--no-session-persistence`,
`--disable-slash-commands`, `--strict-mcp-config`, `--mcp-config`, `--tools`,
`--allowedTools`, `--permission-mode dontAsk`, `--permission-prompts`,
`--no-chrome`, `--setting-sources`, `--bare`, `--model`, and the
`ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`, and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` variables.

- **Tool surface.** `2.1.186` fixed `--tools` letting feature-gated tools slip
  through on a cold first launch. That tightens the empty `--tools ""` surface
  both profiles rely on.
- **Permissions.** `2.1.200` renamed the `default` permission mode to `Manual`
  and still accepts `default`. `dontAsk` is unchanged and still listed by
  `--help`. `2.1.257` made project settings unable to select
  `bypassPermissions`; both profiles also pass `--setting-sources ""`.
  `2.1.259` added `--permission-prompts none`, which the mediated profile uses.
- **MCP configuration.** `2.1.221` connects `--mcp-config` servers before the
  first print-mode turn. `2.1.246` stopped `--strict-mcp-config` sessions from
  prompting for `.mcp.json` servers they never load. `2.1.274` stopped an empty
  `--mcp-config` from delaying the first non-interactive turn. `2.1.219` added
  `mcp_server_errors` to the stream-json init event. The driver ignores
  unknown init fields and still checks the advertised tools and the
  `verchestra` server status.
- **Stream-json.** `2.1.208` fixed truncated stream-json output at exit, and
  `2.1.257` made non-JSONL stdin fail fast. `2.1.281` fixed stream-json sessions
  failing when an earlier assistant message had plain-string content. The event
  envelope the driver accepts is unchanged.
- **Settings sources.** `2.1.281` forwards `--setting-sources` to spawned
  sessions. `2.1.251` stopped project settings from setting
  `CLAUDE_CONFIG_DIR` or `TMPDIR`. Both changes narrow what ambient
  configuration can reach the child.

No change in the range weakens either profile's tool, permission, settings,
session-persistence, or credential boundary.

## Proven behavior

- The live T03 probe reports exactly `2.1.282` when
  `VES_REQUIRE_PINNED_PROVIDERS=1`, and a supported build that is not the pin is
  still a hard failure on the fleet.
- Every T03 flag, and the `dontAsk` mode, appears in the installed `--help`
  output. This read-only check is new with this requalification.
- Every mediated flag appears in the installed `--help` output. On a build below
  the mediated minimum, the check instead proves that the mediated profile
  refuses that build with `VES_CLAUDE_VERSION_UNSUPPORTED`. On the fleet, a pin
  below the mediated minimum is a hard failure.
- The deterministic fake suites for both profiles are unchanged in scope:
  prompt on stdin only, no built-in tools, bridge-only tools for the mediated
  profile, redaction, cancellation, and private session identity.

## Evidence

The qualification is accepted only after
`VES_REQUIRE_PINNED_PROVIDERS=1 corepack pnpm qualify:claude`, `pnpm gate:quick`,
and the CI Quality gate pass on the exact implementation revision. Every live
check is a read-only `--version` or `--help` probe; no model or paid endpoint is
contacted.
