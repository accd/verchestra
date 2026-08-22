---
schema: verchestra-feature-handoff/v1
feature: live-doctor-probes
issue: 207
status: in_progress
branch: codex/issue-207-live-doctor
baseRevision: 7bcc236255742ad3edf2c16094abbabbcd4f50e4
lastCompletedTask: T1
nextTask: Design existing-dependency live observers for sandbox, runtime SQLite, secret presence, and driver.
lastGate: focused unit, security, public-regression, format, lint, and typecheck PASS
updatedAt: 2026-08-22T19:42:00Z
---

# Scope

Issue #207 upgrades the seven T72 presence-only doctor probes to live read-only
observations. It neither closes #207 nor advances T75 until provisioned-machine
evidence and independent verification exist.

# Current decision

The asynchronous probe-port vertical is complete without a dependency change.
`collectDoctorFacts` preserves catalog order while awaiting each observation;
`runDoctor` awaits the whole collection before capturing after-sentinels and
sealing. The public regression campaign runner now awaits deterministic
campaign checks so it continues to exercise the real doctor-facts surface.

Real policy, connector, and probe observations require direct CLI dependencies
not currently declared; their implementation is blocked pending explicit human
approval. Source mode remains honestly `blocked` throughout.

# Next exact action

Add the live existing-dependency observers without reading a secret value,
opening a writable runtime store, invoking a driver, or allowing async work to
outlive the sentinel window. Do not add policy, connector, or data-probe
dependencies without explicit human approval.
