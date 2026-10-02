# Subscription Provider Authentication Threat Model (ADP-A)

This updates `.specs/features/governed-task-cli/threat-model.md`. Its actors,
trust levels, and every control for the `mediated-mcp` profile are unchanged.
Only what the subscription path adds or changes is listed here.

## Assets added

- The Claude Code subscription token (`claude-code-oauth-token`). It is valid
  for about a year and can make model requests against the owner's plan.
- The Codex ChatGPT-plan credential in the identity directory's `auth.json`. It
  holds access and refresh tokens.
- The owner's ambient sessions: the Claude Code login in the macOS Keychain or
  `~/.claude`, and the Codex login in `~/.codex` or the OS credential store.

## Threats and controls

| Threat | Control | Evidence |
| --- | --- | --- |
| The ambient Claude Code session is used instead of the brokered token | No spawn without the token; the token outranks a stored login; per-run `CLAUDE_CONFIG_DIR` keys the Keychain entry and the credential file to a directory that never held a login; per-run `HOME`; allowlisted environment | SPA-02, SPA-03, SPA-20 |
| An ambient `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `CLAUDE_CODE_OAUTH_TOKEN` in the invoking shell reaches the child | The environment is built from an allowlist; the credential comes from `resolveExecution` alone | SPA-02, SPA-20 |
| The repository's `CLAUDE.md`, `AGENTS.md`, `.claude/` settings, hooks, skills, agents, or `.mcp.json` are loaded with project authority | The child's working directory is an empty per-run directory; `--setting-sources ""`; `CLAUDE_CODE_DISABLE_CLAUDE_MDS`; `--strict-mcp-config`; `--disable-slash-commands`; `--tools ""` | SPA-01, SPA-02, SPA-03 |
| A hook runs a command outside the bridge | `--settings` with `disableAllHooks`; no settings source; no plugin; any reported hook event ends the session; a managed policy location refuses the launch | SPA-01, SPA-05, SPA-06 |
| A claude.ai connector or another MCP server adds tools | `--strict-mcp-config`; the token cannot fetch connectors; the session must list exactly the bridge server and only bridge tools | SPA-04 |
| The token leaks into argv, events, evidence, or errors | The token travels only in the child's environment; it must be a sensitive value and is redacted from content; checkpoints carry counts only; the public error names the credential, never its value | SPA-02, SPA-20 |
| The verifier uses the owner's `~/.codex` login or the OS credential store | `CODEX_HOME` is the identity directory; `HOME` is per-session; `config.toml` pins the file store | SPA-09, SPA-11 |
| An API-key login in the identity directory is billed while the Workspace says subscription | `forced_login_method = "chatgpt"`; `vestra` accepts only `Logged in using ChatGPT` | SPA-09, SPA-10 |
| Configuration left in the identity directory steers a later verifier session | `vestra` rewrites `config.toml` before every use; the verifier stays read-only with zero tools | SPA-09 |
| The untrusted Task Request switches the credential mode | The mode is read only from the machine-local state root; the request contract has no such field | SPA-12 |
| Unbilled usage is reported as a dollar figure, or usage escapes its ceilings | Unbilled usage adds no cost and is reported as not billed; token and duration ceilings still apply | SPA-17, SPA-18 |
| A request for an unpriced model runs for free in API-key mode | The priced path and `VES_BUDGET_MODEL_UNKNOWN` are unchanged for every model that is billed | SPA-17 |

## Residual risks (stated, for the owner to accept or reject)

- **G1 — managed policy.** A machine administrator, or the administrator of a
  Team or Enterprise organization, can deliver hooks, instructions, MCP
  servers, or a credential helper that the profile cannot switch off. File and
  MDM locations refuse the launch, and a hook that runs ends the session, but
  server-managed settings cannot be seen before the session starts and a
  server-delivered instruction file is covered only by
  `CLAUDE_CODE_DISABLE_CLAUDE_MDS`. That actor is outside the governed-task
  threat model, which already excludes other processes of the same user.
- **G2 — Keychain lookup.** Claude Code may still ask the Keychain for an entry
  named after the per-run config directory. The entry does not exist, so the
  lookup returns nothing and raises no dialog.
- **G3 — startup requests.** Claude Code may make provider requests at startup
  that no documented switch covers. They carry the token and no repository
  content.
- **The token is long-lived.** Any process of the same user that can run the
  credential store's tool can read it (AD-034), exactly like an API key, and a
  leaked token works until it is revoked. It can only make model requests.
- **The Codex credential is a plaintext file** in a `0700` directory. Any
  process of the same user can read it. `vestra` cannot redact tokens it never
  reads, so it relies on Codex not printing them; the verifier's output is
  still bounded and parsed only for the verdict block.
- **The identity directory persists.** Codex may write logs or caches there
  between sessions. Threads are ephemeral and `config.toml` is rewritten, but
  the directory is not as clean as the per-session one of API-key mode.
- **Subscription limits are not metered.** A plan's rate or usage limit can
  stop a run mid-task; the run then fails closed and can be resumed or planned
  again. The token and duration ceilings bound each run.
- **Not observed live.** The fake proves what `vestra` passes and refuses. What
  Claude Code 2.1.282 actually loads and advertises under this invocation is
  the owner's first supervised run (see the qualification report).
