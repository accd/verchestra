---
schema: verchestra-feature-handoff/v1
feature: subscription-provider-auth
issue: null
status: in_progress
branch: feat/subscription-provider-auth
baseRevision: af7d047e6d45970ee75c8991bed8ba969982cbb4
lastCompletedTask: T1
nextTask: "T2: the mediated-mcp-subscription Claude Code profile, its tests, and its qualification report."
lastGate: null
updatedAt: 2026-10-02T12:00:00Z
---

# Scope

Requirement ADP-A of `.specs/features/architecture-deepening/spec.md` (tasks
TA1 and TA2): let the governed task path authenticate Claude Code and Codex
through subscriptions without weakening the mediated profile's isolation.
Requirements SPA-01..21 in `spec.md`.

# Completed Evidence

T1: `spec.md` (the TA1 evidence with its sources, the gaps G1–G3, and
SPA-01..21), `design.md`, `threat-model.md`, `tasks.md`, and the decision
`AD-044` in `.specs/STATE.md`.

# Next Exact Action

T2. See `tasks.md`.

# Blockers

None.

# Decisions

See `AD-044` in `.specs/STATE.md`. The open owner
decisions are the gaps G1–G3 in `spec.md`.

# Files Intentionally Left Unchanged

`.specs/features/architecture-deepening/spec.md`, `tasks.md`, and `handoff.md`
(the coordinator owns them). `docs/qualification/claude-code-driver-mediated.md`
and `claude-code-driver-2.1.282.md` (immutable evidence for their revisions).
`schemas/task-request/1.schema.json` (the mode is machine-local by decision).
