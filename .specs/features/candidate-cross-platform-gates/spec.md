# Candidate cross-platform gates (#405, #235)

T76 candidate build run 36756695837 at main `27eced5` passed on Linux x64 and
arm64 and failed in "Run all five closed gates" on Windows x64, macOS arm64,
and macOS x64. PR CI runs Ubuntu only, so these escaped review. Each failure is
fixed at its root cause; no assertion is weakened and no gate is bypassed.

## Requirements

- **XP-01 (macOS x64, product).** Terminating a process group counts the group
  as gone when Darwin answers the group signal with EPERM only because every
  remaining member is a zombie awaiting its reaper. EPERM is treated as gone
  only when the process table shows no live member of the group; a live member
  still ends in the typed incomplete-termination failure, and without a process
  table the error stands.
- **XP-02 (macOS arm64, test witness).** The deterministic fake implementer
  records its tool results before any event that ends the session (a tool
  outside the bridge, an exhausted budget), so the prompt-injection security
  case always observes the refused out-of-scope write. The security assertion
  is unchanged: the write is attempted, refused with
  `VES_EXECUTOR_SCOPE_DENIED`, and never lands.
- **XP-03 (Windows, mediation).** The mediated bridge uses a Unix socket and is
  refused on Windows by design. Every mediated and bridge case in `tests/**` and
  `spikes/**` asserts that refusal on win32 instead of failing, skipping, or
  returning early: bridge `VES_BRIDGE_PLATFORM_UNSUPPORTED` with no socket
  directory, Claude Code profile `VES_CLAUDE_MEDIATION_UNSUPPORTED`, the adapter
  refusing before any session, checkpoint, usage, or tool call, and the e2e
  journey failing closed at the bridge with its worktree removed.
- **XP-04 (Windows, probe host).** The candidate build refuses sealed counters
  with any skip. Every out-of-process probe host case on win32 asserts that the
  admitted path is refused for the platform
  (`VES_PROBE_HOST_PLATFORM_UNSUPPORTED`) instead of skipping.
- **XP-05 (Windows, fixtures).** The runtime store fixture closes every store it
  opened before removing its root (Windows refuses to unlink an open SQLite
  database and its `-wal`/`-shm` files). The worktree tool fixture pins
  `core.autocrlf=false` so the worktree holds the committed bytes. The file-mode
  case asserts stat bits on POSIX and Git's mode summary everywhere, because
  win32 keeps no executable bit.
- **XP-06 (proof).** A T76 candidate build dispatched on this branch passes on
  all five target legs.

## Out of scope

- Making the mediated bridge work on Windows (a named-pipe transport) or the
  probe host run there.
- The `if (!DARWIN) return` cases in `tests/security/task-cli-security.test.mjs`
  and `tests/e2e/task-cli-e2e.test.mjs`; they do not fail on any leg and the
  off-macOS refusal is asserted by `tests/e2e/task-cli-e2e.test.mjs` and
  `tests/contract/task-command-platform.test.mjs`.
