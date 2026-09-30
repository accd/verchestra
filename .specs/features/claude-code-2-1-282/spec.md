# Claude Code 2.1.282 fleet pin and PR #433 scan hygiene

## Problem

PR #433 adds the Claude Code `mediated-mcp` profile, which requires build
`2.1.282` or later. CI still installs the T03 pin `2.1.168`, so the read-only
mediated `--help` probe fails on the fleet. The same PR also carries two open
CodeQL alerts (a polynomial-time path regex and a credential digest in a test
fake) and SonarCloud findings that fail its quality gate.

## Requirements

- **CC-01**: Every fleet workflow SHALL install and verify exactly
  `@anthropic-ai/claude-code@2.1.282`, and the workflow shape tests and the
  platform matrix SHALL name that pin.
- **CC-02**: The T03 live probe SHALL require exactly `2.1.282` under
  `VES_REQUIRE_PINNED_PROVIDERS=1` while the T03 floor stays `2.1.168`; every
  T03 flag SHALL be read from the installed `--help`.
- **CC-03**: The mediated flag probe SHALL check every mediated flag on a build
  at or above `2.1.282`, SHALL prove that the mediated profile refuses an older
  build with `VES_CLAUDE_VERSION_UNSUPPORTED`, and SHALL fail on the fleet when
  the pin is below the mediated minimum.
- **CC-04**: The requalification SHALL be recorded in the immutable report
  `docs/qualification/claude-code-driver-2.1.282.md`; earlier reports are not
  edited.
- **CC-05**: The bridge's logical-path check SHALL run in linear time with the
  same accepted set and refusal codes as the pattern it replaces.
- **CC-06**: The task-request normalizer SHALL accept exactly the gate arguments
  the schema pattern accepts, without a lookahead-heavy regex.
- **CC-07**: The mediated test fake SHALL not hash, digest, or record the
  credential, SHALL not write into an ambient temp directory, and SHALL handle
  every promise; the proof that the child sees only the brokered credential
  SHALL remain.
- **CC-08**: The worktree tool fixture SHALL run git from a fixed system
  location, not from a PATH lookup.

## Scope

Test, CI, and validation-hygiene changes only, plus minor behavior-preserving
refactors. No policy, workflow, artifact, Approval, or durable-state behavior
changes. No model or paid endpoint is contacted.
