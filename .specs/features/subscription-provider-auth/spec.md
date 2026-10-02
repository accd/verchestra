# Subscription Provider Authentication Specification (ADP-A)

Requirement ADP-A of `.specs/features/architecture-deepening/spec.md`, tasks TA1
(evidence) and TA2 (implementation).

## Problem Statement

The governed task path authenticates both providers with API keys only:

- The `mediated-mcp` Claude Code profile passes `--bare`, and `--bare` accepts
  only `ANTHROPIC_API_KEY` or an `apiKeyHelper`. A subscription login is never
  read.
- The task composition reads the logical credentials `anthropic-api-key` and
  `openai-api-key` and injects `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
- Deep doctor observes `anthropic-api-key`.

An owner who uses Claude Code and Codex through subscriptions cannot run a
task. The isolation `--bare` gives the mediated profile must not be weakened to
fix that.

## Owner Decisions (binding)

- Subscription is the default for a Workspace. API keys stay supported.
- The mode is a machine-local Workspace setting. The untrusted Task Request
  never selects it.
- The Claude Code credential is the long-lived token from `claude setup-token`,
  bound as `claude-code-oauth-token`.
- Codex signs in once into a dedicated identity directory under the Workspace's
  machine-local state root, never `~/.codex`, and its credential never goes
  through the OS credential store (it exceeds the 1416-byte value limit).
- With a subscription nothing is billed per token: token and duration ceilings
  stay enforced, and cost is reported as not billed.

## Evidence (TA1)

Gathered on 2026-10-02 from the installed `claude` 2.1.282 and `codex` 0.157.1
with read-only probes (`--version`, `--help`, subcommand `--help`,
`codex login status` in a disposable `CODEX_HOME`, and a read-only inspection
of the text embedded in the installed Claude Code executable), and from the
official documentation. No prompt was sent to a model, no login or token
command was run, and no owner configuration, login, or keychain entry was read.

Sources: **H** is `claude --help` (2.1.282). **D-auth**, **D-env**, **D-cli**,
**D-headless**, **D-memory**, **D-perm**, **D-hooks**, **D-managed**, and
**D-tools** are the pages `authentication`, `env-vars`, `cli-reference`,
`headless`, `memory`, `permissions`, `hooks`, `managed-settings`, and
`tools-reference` under `https://code.claude.com/docs/en/`. **X** is the
installed executable's embedded text. **C-help** is `codex login --help`
(0.157.1), **C-probe** is the disposable-`CODEX_HOME` probe, **C-doc** is
`https://developers.openai.com/codex/auth` (it redirects to
`https://learn.chatgpt.com/docs/auth`), and **C-src** is
`codex-rs/cli/src/login.rs` in `github.com/openai/codex`.

### E1 — How a subscription credential reaches Claude Code non-interactively

- `claude setup-token`: "Set up a long-lived authentication token (requires
  Claude subscription)" (H). It "opens the same browser authorization flow as
  `/login`, and the token prints to the terminal ... It does not save the token
  anywhere"; it is a "one-year OAuth token" (D-auth, "Generate a long-lived
  token").
- The variable is `CLAUDE_CODE_OAUTH_TOKEN`: "OAuth access token for claude.ai
  authentication. Alternative to `/login` for SDK and automated environments.
  Takes precedence over keychain-stored credentials" (D-env). It "can only make
  model requests, so it can't establish Remote Control sessions or fetch
  claude.ai connectors" (D-auth).
- "Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`" (D-auth), and `--bare`
  says "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via
  --settings (OAuth and keychain are never read)" (H). The subscription profile
  therefore cannot pass `--bare`.
- Precedence (D-auth, "Authentication precedence"): cloud provider variables,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`,
  `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic profiles, then the `/login`
  subscription. The token outranks a stored login and is outranked by an API
  key, so the profile must supply the token and nothing above it.

### E2 — Each `--bare` effect and its equivalent without `--bare`

`--bare` (H): "skip hooks (those defined in settings and by installed plugins
...), LSP, plugin sync, attribution, auto-memory, background prefetches,
keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1.
Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper".

| `--bare` effect | Control in the subscription profile | Equivalent? |
| --- | --- | --- |
| Hooks from settings | `--setting-sources ""` loads no user, project, or local settings (H; D-perm: without project settings "Claude Code reads neither the project's settings files nor its `.mcp.json`"). `--settings '{"disableAllHooks":true,...}'` "takes precedence over project and local settings" (D-hooks). The per-run `CLAUDE_CONFIG_DIR` and `HOME` hold no user settings. | Yes, except managed policy (gap G1). |
| Hooks from plugins | No plugin is installed or enabled: the per-run config directory is empty, no settings source is loaded, and no `--plugin-dir` is passed. | Yes. |
| LSP | No switch exists. LSP servers come from plugins (none), and the LSP tool is a built-in tool that `--tools ""` removes; a session that still advertises it fails closed on the tool-surface check. | No single control; covered by the two above. |
| Plugin sync | `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1` (D-env: nonessential-traffic does not cover it), `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (stops background runs of plugin command sources), and no enabled plugin. | Yes. |
| Attribution | None. It concerns commit and pull-request text; Claude Code has no tool to commit here, and Verchestra authors the task commit. | Not needed for the threat model. |
| Auto-memory | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (D-env), `autoMemoryEnabled: false` through `--settings` (D-memory), and a per-run config directory that is removed, so nothing persists. | Yes. |
| Background prefetches | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (auto-updates, telemetry, error reporting, release notes, availability checks, feature-flag fetching), `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (the background title request), `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, `--no-chrome`. | Partly: no switch is named for every startup request (gap G3). |
| Keychain reads | No switch exists. The macOS Keychain entry is keyed by the config directory: Claude Code "keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry" (D-auth, "Credential management"). X confirms it for 2.1.282: the entry's name carries a suffix derived from a SHA-256 of the config directory whenever `CLAUDE_CONFIG_DIR` is set. A per-run random directory therefore names an entry that never existed. | No: a lookup can still happen, but it cannot find the ambient session (gap G2). |
| CLAUDE.md auto-discovery | `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`: "prevent loading any CLAUDE.md memory files into context, including user, project, and auto memory files" (D-env); X shows both loaders (managed and user; project, local, and rules) return nothing when it is set. `--setting-sources ""` independently skips project and local files and rules (D-memory). The child's working directory is an empty per-run directory, so nothing the repository carries is there to discover. | Yes. `AGENTS.md` is not named by the switch in D-env; the empty working directory covers it. |
| `CLAUDE_CODE_SIMPLE=1` | Not set, on purpose: it is what turns bare mode on. | Not applicable. |
| Auth strictly API key | The only credential is `CLAUDE_CODE_OAUTH_TOKEN`; the environment is allowlisted, so no `ANTHROPIC_*` or `CLAUDE_CODE_USE_*` value is inherited; no settings source can supply `apiKeyHelper` except managed policy (G1). | Yes, except G1. |
| Skills, commands, subagents (D-headless) | `--disable-slash-commands`, `--tools ""` (no Agent or Skill tool), tool-surface check. | Yes. |
| MCP auto-discovery (D-headless) | `--strict-mcp-config --mcp-config <per-run file>`; the session must list exactly the `verchestra` server. | Yes. |

### E3 — Can an ambient subscription session be picked up silently?

Not through the profile. Three independent facts close it:

1. The driver refuses to spawn without the token (`VES_CLAUDE_CREDENTIAL_MISSING`).
2. With the token present it outranks any stored login (E1), and "Claude Code
   uses the token you set for the whole session" (D-env); an expired token is
   replaced by a new one, not by a fallback.
3. The stored login is looked up under the per-run config directory: the
   Keychain entry is keyed by it (E2), and the file fallback
   `.credentials.json` lives under it too (D-auth). Both are empty for a
   directory created seconds earlier. `HOME` is per-run as well, so
   `~/.config/anthropic` profiles are not reachable either.

The Keychain keying was confirmed from documentation and from the installed
executable's text, not by a live lookup: reading the owner's Keychain was out
of bounds for TA1. The live confirmation is an owner step (see
`docs/qualification/claude-code-driver-subscription.md`).

### E4 — Codex

- A ChatGPT-plan login is cached "in a plaintext file at `~/.codex/auth.json`
  or in your OS-specific credential store"; `cli_auth_credentials_store`
  selects `file` ("`auth.json` under `CODEX_HOME`"), `keyring`, `auto`, or
  `ephemeral` (C-doc). C-probe: 0.157.1 rejects any other value and names
  exactly those four.
- `codex login status` (C-probe, C-src) writes one line to standard error:
  `Not logged in` with exit code 1; `Logged in using ChatGPT` with exit code 0;
  `Logged in using an API key - <masked>` with exit code 0; a configuration or
  storage error with exit code 1. A `CODEX_HOME` that does not exist is a
  configuration error.
- `forced_login_method` accepts `chatgpt` or `api` (C-probe). With
  `forced_login_method = "chatgpt"` a synthetic API-key `auth.json` reports
  `Not logged in` with exit code 1, where without it the same file reports
  `Logged in using an API key` (C-probe). An API-key login therefore cannot
  stand in for a subscription in a directory pinned that way.
- `--with-access-token` ("Read the access token from stdin", C-help) is not a
  subscription path for a personal plan: access tokens are created by members
  of ChatGPT Enterprise workspaces whose admins grant the permission, "for
  trusted, non-interactive Codex local workflows" (C-doc).
- `CODEX_HOME` is the only place the probe read or wrote: with it set to a
  disposable directory and `HOME` set to another, `codex login status` created
  files only under `CODEX_HOME` and left `HOME` empty. `~/.codex` is the
  default only when `CODEX_HOME` is unset (C-doc, C-help).

### Gaps

- **G1 — managed policy.** Managed settings (a file under the system policy
  directory, an MDM profile, or server-managed settings for a Team or
  Enterprise organization) outrank `--settings` (D-managed), and
  "`disableAllHooks` set in user, project, or local settings can't disable
  those managed hooks" (D-hooks). A managed `CLAUDE.md` "cannot be excluded by
  individual settings" (D-memory), although X shows
  `CLAUDE_CODE_DISABLE_CLAUDE_MDS` skips it in 2.1.282. Whether `--bare` itself
  ignores managed hooks is not stated in H. The profile cannot switch managed
  policy off, so it refuses to start when a documented machine-wide location
  exists and fails the session on any hook event (SPA-06, SPA-05).
  Server-managed settings cannot be detected before the session starts.
- **G2 — Keychain lookup.** No switch disables the lookup. The lookup cannot
  find the ambient entry (E3).
- **G3 — startup requests.** No documented switch covers every request Claude
  Code makes at startup with the token. They go to the same provider with the
  same credential and carry no repository content.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| A live run with the owner's token or Codex login | TA1 forbids it; it is the owner's step and the #406 pilot's evidence. |
| Running `claude setup-token` or `codex login` | Interactive, and they belong to the owner. |
| Detecting server-managed settings | Not observable before a session starts (G1). |
| A new `vestra` command to print setup steps | The command manifest is pinned (GTC-27). |
| Windows | The mediated bridge is refused there by design. |
| Changing the Task Request contract | The mode is machine-local by decision. |

## Requirements (EARS)

### Claude Code subscription profile

- **SPA-01** — WHEN the `mediated-mcp-subscription` profile starts Claude Code
  THEN the driver SHALL pass exactly the mediated invocation without `--bare`,
  with `--include-hook-events` and
  `--settings '{"disableAllHooks":true,"autoMemoryEnabled":false}'` added, and
  SHALL never pass a bypass flag, `--add-dir`, or a plugin flag.
- **SPA-02** — The profile SHALL pass only the allowlisted environment, the
  per-run `HOME` and `CLAUDE_CONFIG_DIR`, the seven documented switches of
  `design.md`, and exactly `CLAUDE_CODE_OAUTH_TOKEN` from `resolveExecution`,
  which SHALL also be a sensitive value. A missing token SHALL fail with
  `VES_CLAUDE_CREDENTIAL_MISSING` and any other supplied variable with
  `VES_CLAUDE_ENVIRONMENT_DENIED`, before any process starts.
- **SPA-03** — The child SHALL run in an empty per-run directory inside the
  `0700` isolation directory, not in the worktree, and the whole directory
  SHALL be removed after the child exits, including after cancellation.
- **SPA-04** — WHEN the session's `system/init` event advertises a tool that is
  not a bridge tool, reports the bridge as not connected, or lists any MCP
  server other than `verchestra` THEN the session SHALL fail closed.
- **SPA-05** — WHEN the stream carries any hook lifecycle event THEN the
  session SHALL fail closed with `VES_CLAUDE_HOOK_UNEXPECTED`.
- **SPA-06** — WHERE a documented machine-wide Claude Code policy location
  exists (a file, a directory that is not empty, or a location that cannot be
  inspected) THEN the profile SHALL refuse with
  `VES_CLAUDE_MANAGED_POLICY_PRESENT` before any process starts.
- **SPA-07** — The `mediated-mcp` profile's arguments, environment, working
  directory, and minimum build, and the T03 profile, SHALL be unchanged, and
  the `mediated-mcp` profile SHALL refuse the subscription token.
- **SPA-08** — The requalification SHALL run the production driver and bridge
  against the labeled fake `claude`, which SHALL itself refuse an invocation
  whose arguments or credential variable differ from the profile's, and SHALL
  be recorded in a new report
  `docs/qualification/claude-code-driver-subscription.md` that separates what
  the fake proved from what needs the owner's token.

### Codex subscription identity

- **SPA-09** — The Codex identity directory SHALL be `codex-identity` under the
  Workspace's machine-local state root, a real directory with mode `0700`, and
  `vestra` SHALL write its pinned `config.toml` (file credential store,
  ChatGPT login only) before every use.
- **SPA-10** — WHEN the verifier authenticates by subscription THEN `task
  start` and `task resume` SHALL run `codex login status` with `CODEX_HOME` set
  to the identity directory and an isolated `HOME`, before the first workflow
  transition or effect, and SHALL accept only exit code 0 with
  `Logged in using ChatGPT`. Any other answer SHALL be
  `VES_TASK_NOT_CONFIGURED` naming `codex-login`, with the exact one-time
  command written to standard error.
- **SPA-11** — WHEN the verifier runs by subscription THEN its `CODEX_HOME`
  SHALL be the identity directory, its `HOME` SHALL be per-session and removed
  afterwards, no `OPENAI_API_KEY` SHALL be supplied or read, and the identity
  directory SHALL survive the session. `vestra` SHALL never read the stored
  Codex credential.

### Mode selection

- **SPA-12** — The mode SHALL come only from `task-providers.json` under the
  Workspace's machine-local state root. Without the file both providers SHALL
  use `subscription`. A malformed file or an unknown provider or mode SHALL be
  `VES_TASK_NOT_CONFIGURED` naming `provider-auth`, at `task plan` before any
  state is written and again at `task start` and `resume`. `task plan` SHALL
  report the mode.
- **SPA-13** — WHEN `task start` or `resume` runs THEN exactly the credentials
  the selected modes need SHALL be proven before the first transition:
  `claude-code-oauth-token` or `anthropic-api-key` for the implementer, and the
  Codex login or `openai-api-key` for the verifier. A missing one SHALL be
  `VES_TASK_NOT_CONFIGURED` naming it.
- **SPA-14** — The implementer SHALL be composed with the profile and the
  credential variable of its mode, and the verifier with the identity
  directory or the API key of its mode.
- **SPA-15** — Deep doctor's secret-presence check SHALL observe the
  credential the implementer's mode names.
- **SPA-16** — `vestra secret set|status|delete --name claude-code-oauth-token`
  SHALL work with the existing commands.

### Budgets

- **SPA-17** — WHEN usage is recorded for a model that is not billed per token
  THEN the meter SHALL add its tokens and usage event, SHALL add no cost, and
  SHALL not require a price. Usage for every other model SHALL keep the
  existing behaviour, including `VES_BUDGET_MODEL_UNKNOWN`.
- **SPA-18** — `task status` and the Run Capsule SHALL report the cost of
  unbilled usage as not billed (subscription), never as a dollar figure, and
  SHALL keep token, duration, and usage-event counts.

### Journeys, hostile behaviour, and documentation

- **SPA-19** — Child-process journeys SHALL cover both modes with the labeled
  fake `claude` and `codex`: success, a missing token, a missing Codex login,
  an API-key Codex login offered as a subscription, and a malformed mode file.
- **SPA-20** — The subscription token SHALL never appear in argv, logs,
  evidence, command output, or errors, and an ambient session or credential
  variable SHALL never reach a provider child.
- **SPA-21** — `docs/quick-start.md`, `README.md`, and the live pilot
  pre-registration SHALL describe the subscription path and the API-key
  alternative.

## Success Criteria

- Every requirement maps to file-and-assertion evidence in `validation.md`.
- `pnpm gate:quick`, `pnpm test:architecture`, `pnpm gate:build`,
  `pnpm gate:security`, `pnpm qualify:claude`, `pnpm qualify:codex`, and
  `pnpm agent:check` pass with zero skips, and no existing assertion is
  weakened.
- The gaps G1–G3 are stated to the owner as decisions, not hidden.
