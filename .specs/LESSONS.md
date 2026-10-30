# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

### L-001 - When two independent checks (format pre-check and digest verification) can both reject the same bad input with the same wrapped error code, assert on the specific rejection cause/message, not just the error code, so removing either check is independently detected.
- signal: `surviving_mutant` · recurrence: 2 feature(s) · scope: `packages/workspace/src/init` · harmful: 0
- features: canonical-json, dsse-attestation
- evidence: packages/workspace/src/init/safe-init.ts:125-129 (packages/workspace/src/init) (+1 more)
- last seen: 2026-08-12T18:41:09Z

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-014 - Prove a task command's refusal by running the command itself, never by calling the shared helper and matching its call site in the source
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/vestra-cli/task` · harmful: 0
- features: beta-release-2026-10
- evidence: verification round 1 F5, apps/vestra-cli/src/task/task-run.ts:296 (C4) (apps/vestra-cli/task)
- last seen: 2026-10-24T17:02:52Z

### L-015 - When a check names a script's exit status, run the script as a child process and assert the exit code, not only the exported function's error
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `scripts` · harmful: 0
- features: beta-release-2026-10
- evidence: verification round 1 C33/C34, tests/build/t76-timestamp-refresh.test.mjs (scripts)
- last seen: 2026-10-24T17:02:53Z

### L-016 - Assert each enumerated documentation member with text no other member contains, or the member passes vacuously
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `docs` · harmful: 0
- features: beta-release-2026-10
- evidence: verification round 1 C47, tests/agent-readiness/beta-tester-docs.test.mjs:188 (docs)
- last seen: 2026-10-24T17:02:53Z

### L-017 - Create every test link through tests/helpers/windows-links.mjs so a Windows host without symlink rights fails with the Developer Mode message, never a bare EPERM
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `tests/helpers` · harmful: 0
- features: beta-release-2026-10
- evidence: verification rounds 1-2 criterion 50, tests/integration/git-context-source.test.mjs:29, tests/security/worktree-tool-security.test.mjs:44 (tests/helpers)
- last seen: 2026-10-24T17:02:53Z

### L-018 - Assert an MCP bridge refusal also at the worktree read view or over the named pipe, since the Unix-socket relay tests return early on Windows
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `packages/agent-runtime/bridge` · harmful: 0
- features: beta-release-2026-10
- evidence: verification round 1 C25, tests/security/mcp-tool-bridge-security.test.mjs:144 (packages/agent-runtime/bridge)
- last seen: 2026-10-24T17:02:53Z

### L-019 - A command added to the release manifest must also be added to every pinned command list (cli-surface, the cli-launchers --help snapshot, SEALED_COMMANDS), and test:e2e plus test:build must run, because gate:quick covers neither.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `apps/vestra-cli` · harmful: 0
- features: probe-host-composition
- evidence: tests/e2e/cli-launchers-e2e.test.mjs:45; tests/build/sealed-launcher-closure.test.mjs:79 (apps/vestra-cli)
- last seen: 2026-10-28T21:02:34Z

### L-020 - A check about the release builder names the structure it asserts: SEALED_CHILD_ENTRIES maps a component id to its tracked entry file, while the host descriptor holds its bin/ logical path and kind.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `scripts/t76-build-candidate` · harmful: 0
- features: sqlite-probe-worker
- evidence: verification round 1 C9, tests/build/reproducible-target-build.test.mjs:216 (scripts/t76-build-candidate)
- last seen: 2026-10-30T01:39:29Z

### L-021 - A check about a line's place in exact CLI output gives an explicit order (after which line, or last), never a position between neighbours.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `apps/vestra-cli` · harmful: 0
- features: sqlite-probe-worker
- evidence: verification round 1 C17, tests/e2e/cli-launchers-e2e.test.mjs:60 (apps/vestra-cli)
- last seen: 2026-10-30T01:39:29Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
