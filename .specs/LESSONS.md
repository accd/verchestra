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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
