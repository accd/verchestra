---
schema: verchestra-feature-handoff/v1
feature: t76-release-materialization
issue: 17
status: in_progress
branch: codex/issue-17-t76-materialize-evidence
baseRevision: 79024f300b6471ee08fa8dfecf48cde4cee205c8
lastCompletedTask: T5
nextTask: "Obtain independent verification of the candidate, four source views, filesystem publication, and rollback execution."
lastGate: "Focused materializer/TUF/filesystem-publication/rollback suite, typecheck, agent:check, complexity, ESLint, Prettier, gate:quick, and gate:release PASS; zero failures/skips/todos"
updatedAt: 2026-08-25T00:00:00Z
---

# Scope completed

The isolated root is read once, source bytes remain available as portable
component bytes, supply-chain evidence is generated from those observations,
and a complete verified hermetic bundle is produced without leaking local
paths. Non-pass evaluation findings remain explicit.

# Remaining work

The candidate and TUF publication paths now consume the materialized bytes;
the filesystem publisher persists signed metadata and targets atomically, and
the integration test exercises all four source modes plus activation/rollback.
Independent T76 verification, public-service publication, and release-key
custody remain open.
