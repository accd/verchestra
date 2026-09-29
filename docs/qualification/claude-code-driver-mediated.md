# Claude Code Driver Requalification: Mediated MCP Profile

**Task:** T03 requalification for #405 (decision AD-0XX, to be numbered at merge)
**Status:** Candidate pending independent verification and human review
**Installed Claude Code observed:** 2.1.282 (read-only `--version` and `--help`; no model invoked)
**Supersedes:** nothing. `docs/qualification/claude-code-driver.md` remains the
evidence for the original T03 profile, which is unchanged for existing callers.

## Why a new profile

The T03 profile disables every built-in tool and loads no MCP server, so Claude
Code cannot change files. #405 makes Claude Code the implementer. Its writes must
pass through the executor's scope, protected-path, capability-grant, and
tool-effect authority checks, so the implementer gets no tool of its own. It
gets a single MCP server, `verchestra`, whose relay forwards calls to the
Verchestra controller over an authenticated Unix socket (decision AD-0XX in `.specs/STATE.md`).

## Qualified invocation profile (`mediated-mcp`)

Selected with `profile: { kind: "mediated-mcp" }` on `ClaudeCodeDriver`. The
executable must be absolute. Minimum build: `2.1.282` within major version 2.

- Arguments: `--print`, stream-json input and output, `--verbose`,
  `--include-partial-messages`, `--no-session-persistence`,
  `--disable-slash-commands`, `--bare`, `--strict-mcp-config`,
  `--mcp-config <per-run file>`, `--tools ""`, `--allowedTools` limited to
  `mcp__verchestra__{read_file,list_dir,search,write_file,delete_file}`,
  `--permission-mode dontAsk`, `--permission-prompts none`, `--no-chrome`,
  `--setting-sources ""`, `--model <model>`. No bypass flag is ever passed.
- Working directory: the run worktree supplied in the execution's `mediation`
  block.
- Isolation: a per-run `0700` directory with `home/` and `config/`; `HOME` and
  `CLAUDE_CONFIG_DIR` point there; `config/mcp.json` (`0600`) names only the
  `verchestra` server. The directory is removed after the child exits, including
  after cancellation.
- Environment: only the allowlisted `PATH`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`,
  and `TMPDIR` values the composition declares, the isolated identity
  directories, `DISABLE_AUTOUPDATER=1`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, and exactly `ANTHROPIC_API_KEY`
  from `resolveExecution`. The credential must be a sensitive value, so it is
  redacted from events. A missing credential is `VES_CLAUDE_CREDENTIAL_MISSING`
  before any process starts.
- Tool surface check: the `system/init` event must advertise only bridge tools
  and report the `verchestra` server as connected; otherwise the session fails
  closed with `VES_CLAUDE_TOOL_SURFACE_UNEXPECTED` or
  `VES_CLAUDE_BRIDGE_UNAVAILABLE`.

`--bare` is what excludes ambient login. It skips keychain and OAuth reads,
hooks, plugin sync, auto-memory, and `CLAUDE.md` discovery. Anthropic
authentication is then limited to `ANTHROPIC_API_KEY`.

## Evidence

Mandatory gates contact no provider and invoke no model. The production
`ClaudeCodeDriver` and the production bridge run against the labeled
deterministic fake `spikes/claude-code-driver/test/fake-claude-mediated.mjs`.
The fake reads `--mcp-config`, launches the configured relay, performs the MCP
`initialize`/`tools/list`/`tools/call` exchange over stdio, and emits
stream-json events.

`pnpm qualify:claude` runs `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs`:

- The handshake completes. `read_file` returns scoped content. `write_file`
  reaches the controller as an executor tool request whose `payloadRef` is the
  SHA-256 of the content. The bridge never writes the worktree itself.
- The invocation has built-ins disabled, only the bridge tools allowed, and no
  bypass flag. The prompt stays out of argv. The MCP config names one server and
  has mode `0600`.
- The child runs in the worktree. `HOME` and `CLAUDE_CONFIG_DIR` are per run and
  removed afterwards. The environment is exactly the declared keys. An ambient
  `ANTHROPIC_API_KEY` or `CLAUDE_CODE_SESSION` is not inherited.
- Reads outside the scope and reads of `.git` are denied at the bridge.
- A session that advertises a built-in tool, or whose bridge is not connected,
  fails closed.
- The credential is redacted from model output.
- A missing or unredacted credential, extra environment, a missing mediation
  block, and a relative bridge command are each refused before spawn.
- A relative executable and non-allowlisted profile environment are refused at
  construction.
- A build below the qualified minimum is unsupported.
- Cancellation terminates the session and still removes the isolation
  directory.
- Every flag the profile passes appears in the installed Claude Code's `--help`
  output. The check reports not configured when Claude Code is absent.

Also covered:

- `tests/contract/claude-code-driver-mediated.test.mjs` pins both exact argument
  lists (T03 unchanged, mediated as above). It also checks that the driver
  allowlist equals the bridge's tool list.
- `tests/integration/mcp-tool-bridge.test.mjs` and
  `tests/security/mcp-tool-bridge-security.test.mjs` cover the relay and
  controller. That includes the `0700`/`0600` channel, wrong-token and
  second-connection refusal, calls before authentication, traversal, symbolic
  links, protected paths, case aliases, oversized frames, and oversized content.

## Limits

- Qualification uses a deterministic fake executable plus a read-only probe of
  the installed build. The live `system/init` tool surface, live MCP launch, and
  live model behavior are evidence for the separately authorized #406 pilot.
  This report does not claim them.
- The fleet pin for the T03 profile (`2.1.168`) is unchanged. The mediated
  profile requires `2.1.282` or later within major 2 and is not qualified on
  older builds.
- macOS and Linux only. On Windows the profile and the bridge report not
  configured.
- This is process configuration, not an OS sandbox. Claude Code keeps network
  access to its provider API.
