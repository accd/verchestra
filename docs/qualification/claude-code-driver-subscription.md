# Claude Code Driver Requalification: Subscription Profile

**Task:** ADP-A (TA2) of `.specs/features/architecture-deepening/`; requirements
SPA-01..08 of `.specs/features/subscription-provider-auth/`
**Status:** Candidate pending independent verification, human review, and the
owner's first supervised run with a real subscription token
**Installed Claude Code observed:** 2.1.282 (read-only `--version`, `--help`,
and subcommand `--help`; no model invoked, no login or token command run)
**Supersedes:** nothing. `docs/qualification/claude-code-driver-mediated.md`
remains the evidence for the `mediated-mcp` profile, and
`docs/qualification/claude-code-driver.md` for the T03 profile. Both profiles
are unchanged.

## Why a second mediated profile

The `mediated-mcp` profile passes `--bare`. `claude --help` (2.1.282) says of
`--bare`: "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via
--settings (OAuth and keychain are never read)". A subscription credential is
an OAuth token, so a profile that authenticates with one cannot be bare. This
profile keeps the mediated tool surface and rebuilds what `--bare` gave from
named controls. The mapping, with its sources and its gaps, is in
`.specs/features/subscription-provider-auth/spec.md` (E2).

## Qualified invocation profile (`mediated-mcp-subscription`)

Selected with `profile: { kind: "mediated-mcp-subscription" }` on
`ClaudeCodeDriver`. The executable must be absolute. Minimum build: `2.1.282`
within major version 2.

- Arguments: `--print`, stream-json input and output, `--verbose`,
  `--include-partial-messages`, `--include-hook-events`,
  `--no-session-persistence`, `--disable-slash-commands`,
  `--strict-mcp-config`, `--mcp-config <per-run file>`, `--tools ""`,
  `--allowedTools` limited to
  `mcp__verchestra__{read_file,list_dir,search,write_file,delete_file}`,
  `--permission-mode dontAsk`, `--permission-prompts none`, `--no-chrome`,
  `--setting-sources ""`,
  `--settings '{"disableAllHooks":true,"autoMemoryEnabled":false}'`,
  `--model <model>`. `--bare`, a bypass flag, `--add-dir`, and a plugin flag
  are never passed.
- Working directory: an empty per-run directory, `workspace/`, inside the
  isolation directory. It is not the run worktree: the model reaches the
  worktree only through the bridge, so nothing the repository carries can be
  discovered from the working directory.
- Isolation: the same per-run `0700` directory as `mediated-mcp`, with `home/`,
  `config/`, and `config/mcp.json` (`0600`) naming only the `verchestra`
  server. It is removed after the child exits, including after cancellation.
- Environment: the allowlisted `PATH`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, and
  `TMPDIR` values the composition declares; the per-run `HOME` and
  `CLAUDE_CONFIG_DIR`; `DISABLE_AUTOUPDATER`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
  `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`,
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`,
  `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`, and
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, each `1`; and exactly
  `CLAUDE_CODE_OAUTH_TOKEN` from `resolveExecution`. The token must be a
  sensitive value, so it is redacted from events. A missing token is
  `VES_CLAUDE_CREDENTIAL_MISSING` and any other supplied variable, including
  `ANTHROPIC_API_KEY`, is `VES_CLAUDE_ENVIRONMENT_DENIED`, before any process
  starts.
- Stream checks: the `system/init` event must advertise only bridge tools,
  report the `verchestra` server as connected, and list no other MCP server;
  any hook lifecycle event ends the session. The codes are
  `VES_CLAUDE_TOOL_SURFACE_UNEXPECTED`, `VES_CLAUDE_BRIDGE_UNAVAILABLE`, and
  `VES_CLAUDE_HOOK_UNEXPECTED`.
- Managed policy: when a documented machine-wide Claude Code policy location
  exists, the profile refuses with `VES_CLAUDE_MANAGED_POLICY_PRESENT` before
  the isolation directory is created.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`ClaudeCodeDriver` and the production bridge run against the labeled
deterministic fake `spikes/claude-code-driver/test/fake-claude-mediated.mjs`.
The fake now refuses, by itself, an invocation whose arguments are not exactly
the profile's or whose credential variable is not the profile's alone, so a
drifted invocation cannot pass by the driver and the test agreeing with each
other.

`pnpm qualify:claude` runs
`spikes/claude-code-driver/test/claude-driver-subscription.test.mjs`:

- The handshake completes and a write reaches the controller as an executor
  tool request whose `payloadRef` is the SHA-256 of the content.
- The observed argument list is exactly the one above. The prompt and the
  token are not in argv. The MCP configuration is in the isolation directory,
  names one server, and has mode `0600`.
- The child's working directory is empty, per-run, and not the worktree.
  `HOME` and `CLAUDE_CONFIG_DIR` are per-run. The environment is exactly the
  declared keys. With `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_SESSION`, and `CLAUDE_CONFIG_DIR` set
  in the parent process, none is inherited, and the token the child echoes is
  the brokered one.
- A session that advertises a built-in tool, whose bridge is not connected,
  that lists a second MCP server, or that reports a hook event fails closed
  before any tool request is forwarded.
- The same hook event and second server do not fail the `mediated-mcp`
  profile, which runs bare and was not changed.
- The token is redacted from model output.
- A missing or empty token, an API key instead of or beside the token, a
  redirected config directory, an unredacted token, and a missing mediation
  block are each refused before spawn. The `mediated-mcp` profile refuses the
  subscription token.
- A managed policy file, or a policy directory that is not empty, refuses the
  launch before spawn; an absent path and an empty directory do not.
- Construction refuses a relative executable, a non-allowlisted environment
  value, a relative managed-policy path, the managed-policy option on the bare
  profile, and an unknown profile kind.
- A build below the qualified minimum is refused before spawn.
- Cancellation terminates the session and removes the isolation directory,
  including the working directory.

Also covered:

- `tests/contract/claude-code-driver-subscription.test.mjs` pins the exact
  argument list, the credential variable of each profile, the settings value,
  and that the two mediated invocations differ only by `--bare` against
  `--include-hook-events` and `--settings`. It also pins the refusal without
  the token and on a non-bridge tool.
- `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs` reads the
  installed build's `--help` and requires every flag of both mediated
  profiles, the `setup-token` command, and the sentence that `--bare` never
  reads OAuth or the keychain.

## What needs the owner's real token

None of the following was observed. Each is a claim about Claude Code's own
behaviour that the fake cannot make, and each is checked by the driver where a
check exists, so a wrong assumption fails closed instead of passing silently.

| To observe in the first supervised run | Why the fake cannot show it | What happens if the assumption is wrong |
| --- | --- | --- |
| The token from `claude setup-token` authenticates a print-mode session through `CLAUDE_CODE_OAUTH_TOKEN` | The fake accepts any value | The session ends with an authentication failure; nothing is written |
| The `system/init` tool list holds only the five bridge tools when `--tools ""` is passed without `--bare` | The fake reports what the bridge lists | `VES_CLAUDE_TOOL_SURFACE_UNEXPECTED`; the tool to disallow is then named in a requalification |
| `mcp_servers` lists only `verchestra` under `--strict-mcp-config` with a subscription login | Same | `VES_CLAUDE_TOOL_SURFACE_UNEXPECTED` |
| No hook event appears with `disableAllHooks` and no settings source | The fake emits a hook event only in its hook scenario | `VES_CLAUDE_HOOK_UNEXPECTED` |
| No `CLAUDE.md`, `AGENTS.md`, or auto-memory content reaches the model | The fake has no instruction loader | Not detected by the driver; the empty working directory and the two switches are the control |
| The Keychain is not asked for the owner's login, and no dialog appears | The fake reads no keychain | Not detected by the driver; the per-run config directory is the control |
| No startup request beyond the model requests carries repository content | The fake makes no request | Not detected by the driver |

One owner check needs no model call and can be run before the first task:
`claude auth status` with `CLAUDE_CONFIG_DIR` and `HOME` pointing at two new
empty directories must report that it is not logged in, even while the owner's
normal session is logged in. That confirms on the owner's machine that a
per-run config directory does not see the ambient session.

## Limits

- Qualification uses a deterministic fake executable plus a read-only probe of
  the installed build. Live behaviour is listed above and is not claimed.
- Managed policy is refused only at its documented file and MDM locations.
  Server-managed settings of a Team or Enterprise organization cannot be seen
  before a session starts.
- The deterministic suites refuse a managed-policy location that the fixture
  names. The child-process journeys use the documented machine-wide locations,
  so on a machine that carries such a policy they report
  `VES_CLAUDE_MANAGED_POLICY_PRESENT` instead of passing.
- macOS and Linux only. On Windows the profile and the bridge report not
  configured.
- This is process configuration, not an OS sandbox. Claude Code keeps network
  access to its provider.
