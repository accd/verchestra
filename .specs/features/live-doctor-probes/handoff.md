---
schema: verchestra-feature-handoff/v1
feature: live-doctor-probes
issue: 207
status: in_progress
branch: codex/issue-207-live-doctor
baseRevision: 7bcc236255742ad3edf2c16094abbabbcd4f50e4
lastCompletedTask: T0
nextTask: Implement and test the async DoctorSubsystemProbe port while retaining source-mode blocked results.
lastGate: pnpm agent:check PASS on the base revision
updatedAt: 2026-08-22T19:30:00Z
---

# Scope

Issue #207 upgrades the seven T72 presence-only doctor probes to live read-only
observations. It neither closes #207 nor advances T75 until provisioned-machine
evidence and independent verification exist.

# Current decision

The asynchronous probe-port vertical can proceed without a dependency change.
Real policy, connector, and probe observations require direct CLI dependencies
not currently declared; their implementation is blocked pending explicit human
approval. Source mode remains honestly `blocked` throughout.

# Next exact action

Make `collectDoctorFacts` asynchronous, await it inside `runDoctor` before the
after-sentinel capture, and add discriminating tests for rejection and delayed
observation behavior.
