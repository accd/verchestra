---
schema: verchestra-feature-handoff/v1
feature: live-doctor-probes
issue: 207
status: in_progress
branch: codex/issue-207-live-doctor
baseRevision: 7bcc236255742ad3edf2c16094abbabbcd4f50e4
lastCompletedTask: T2
nextTask: Obtain explicit approval before adding direct policy, connectors, and data-probe dependencies for T3.
lastGate: gate:quick and gate:security PASS
updatedAt: 2026-08-22T20:36:00Z
---

# Scope

Issue #207 upgrades the seven T72 presence-only doctor probes to live read-only
observations. It neither closes #207 nor advances T75 until provisioned-machine
evidence and independent verification exist.

# Current decision

The asynchronous probe-port vertical and the four existing-dependency live
observers are complete without a dependency change. `collectDoctorFacts`
preserves catalog order while awaiting each observation; `runDoctor` awaits the
whole collection before capturing after-sentinels and sealing. The public
regression campaign runner now awaits deterministic campaign checks so it
continues to exercise the real doctor-facts surface.

`runDoctorDeep` accepts explicit `DoctorLiveProbeOptions`. Runtime inspection
uses the defensive read-only API; secret presence invokes only
`SecretAdapter.has()`; the sandbox probe proves protected-path traversal
rejection before an open; and the driver uses its manifest-only availability
probe with an unreachable execution resolver. Omitted options remain blocked,
so source mode cannot report a fictional provisioned machine.

Real policy, connector, and probe observations require direct CLI dependencies
not currently declared; their implementation is blocked pending explicit human
approval. Source mode remains honestly `blocked` throughout.

# Next exact action

Do not add policy, connector, or data-probe dependencies without explicit human
approval. After approval, add their real read-only observers and then collect
provisioned-machine evidence with an independent verifier.
