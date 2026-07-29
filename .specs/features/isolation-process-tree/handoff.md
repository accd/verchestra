---
schema: verchestra-feature-handoff/v1
feature: isolation-process-tree
issue: 88
status: in_progress
branch: codex/issue-88-posix-process-tree
baseRevision: ff29bd9cfe549e4099cd05b0fd47d2e9c152f454
lastCompletedTask: T1
nextTask: T2
lastGate: node --test spikes/isolation/test/*.test.mjs
updatedAt: 2026-07-29T13:42:00Z
---

# Handoff: isolation process-tree termination

## State

The POSIX spike now enumerates descendants before signalling the parent. The
product gate adapter is also covered by a real timeout test with a descendant;
it owns a detached POSIX process group and terminates that group as one unit.

## Next action

Submit the branch for Linux CI and independent review; run `pnpm gate:quick`
in a clean dependency-complete environment.

## Verification

`node --test spikes/isolation/test/*.test.mjs` passed 50 tests in 2.5 seconds;
`node --test tests/integration/gate-commit-adapters.test.mjs` passed 7 tests in
16.7 seconds, including a timed-out descendant; and `pnpm agent:check` passed.
`pnpm gate:quick` could not start format checking because the isolated
worktree lacks `prettier`; its dependency installation had already been blocked
by the supply-chain policy for 19 recently published locked packages. No policy
was relaxed.
