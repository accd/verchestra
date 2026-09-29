# OS Secret Backend Threat Model

**Scope:** the macOS credential backend, the `vestra secret` commands, and deep
doctor's presence check (#379, AD-034). **Asset:** a provider API key that a
governed task injects into a provider child process.

## Trust boundaries

1. The `vestra` process and the `/usr/bin/security` child it spawns, joined by
   argv, environment, stdin, stdout, and stderr.
2. The user's keychain files, owned and unlocked by the user's session.
3. The `vestra` process's command output: human, JSON, and error envelopes.

## Threats and mitigations

| Threat | Mitigation | Evidence |
| --- | --- | --- |
| The value is visible to other users through the process table (argv) | It is written only via stdin to `security -i`, hex-encoded. argv carries the service, account, and keychain path only. | Security test: argv assertions |
| The value leaks through the environment | The child environment is an allowlist (`PATH`, `HOME`, `USER`, `LOGNAME`), so no ambient `*_API_KEY` is inherited | Security test: environment assertion |
| The value leaks through an error, a log, or output | Errors never carry the child's stdout or stderr. Output reports presence and store metadata only. | Security test: error and output assertions; e2e stdout and stderr checks |
| The tool splits an oversize line, echoes the hex tail to stderr, and writes a truncated value to the login keychain | The value budget is derived from the 4095-byte line limit and checked twice before spawning | Unit and security tests: oversize value never spawned |
| An unusable `--keychain` path redirects a write into the login keychain | The file must be a regular, user-owned, non-symlink keychain (`kych`), re-proven before every operation | Unit and e2e keychain-file tests |
| Ambient state redirects the credential source (a planted keychain feeds an attacker's key to #405) | No environment variable selects the keychain. `--keychain` is explicit per invocation and reported as `keychain: explicit`. | AD-034; CLI output tests |
| One Workspace reads another's credential | The service is `verchestra/<workspaceId>`, and the Workspace ID is a validated StableId | Security and doctor binding tests |
| A gate test touches the owner's real keychain or raises a dialog | Gate suites use fake or spy runners. A preloaded spawn guard throws on `security`, and an architecture test enforces both. Real-keychain evidence is a standalone suite on disposable keychain files only. | `tests/architecture/no-keychain-spawn-in-tests.test.mjs` |
| Deep doctor reads the value | The doctor gets a `{ has }` closure only. Presence is attribute-only (no `-g`/`-w`). | Security and doctor tests; the doctor-composition architecture guard |
| A hidden keychain dialog hangs the CLI or asks for a password unexpectedly | Every spawn is bounded. A timeout is `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`. Rotation never changes an access list (`-U` with `-T` raises an approval dialog). | Unit timeout and access-list tests; real-runner timeout in `pnpm qualify:keychain` (pending) |
| A rotation fails halfway | Reported as `VES_SECRET_ROTATION_INCOMPLETE`, with the credential now absent. Never half-written. | Unit and security rotation tests |
| An injected name or path breaks out of the `security -i` command line | The logical name matches the strict binding pattern. The namespace is `verchestra/` plus a StableId. The path matches a no-whitespace, no-quote canonical pattern. | Unit locator and path tests; security name tests |

## Accepted residual risks

- **Same-user readers.** An item trusted for `/usr/bin/security` (the tool's
  own default) is readable without a prompt by any process running as the same
  user that invokes that tool. The OS gives a CLI-owned item no finer
  isolation. `access-control` is therefore not claimed.
- **In-memory lifetime.** The value exists briefly in `vestra` memory and in
  the `security` child's memory. Buffers are zeroed after use, but a same-user
  debugger or a core dump could observe it. It is never held in a Node string.
- **Non-atomic rotation.** A failure between delete and add leaves no
  credential. It is reported distinctly, and the fix is to run the command again.
- **Locked login keychain.** A read may raise the OS unlock dialog. The
  bounded timeout turns an unanswered dialog into a clear error.
- **Linux and Windows.** No backend exists there. They report `not configured`,
  never a pass.
