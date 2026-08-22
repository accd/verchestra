# Live Doctor Probes Specification

## Goal

Upgrade the seven #207 doctor checks from fixture presence to real, bounded,
read-only observations without changing the T72 report schema, exposing
values, paths, secrets, or raw errors, or widening the diagnostic to a writer
or provider surface.

## Requirements

| ID | Requirement |
| --- | --- |
| LDP-01 | `DoctorSubsystemProbe` and `collectDoctorFacts` shall support synchronous and asynchronous observations while preserving the closed twelve-check catalog and stable fail/blocked mapping. |
| LDP-02 | `runDoctor` shall await all observations inside the sentinel-invariance window before building or sealing the report. |
| LDP-03 | `sandbox`, `sqlite-durable-state`, `secret-presence`, and `driver` shall be based on real read-only observations and never fixture presence. |
| LDP-04 | `cedar-policy`, `connector`, and `probe` shall be based on real read-only observations and never fixture presence. |
| LDP-05 | Absent source-mode subsystems shall remain `blocked`; malformed, unavailable, or unhealthy present subsystems shall be `fail`, with only registered remediation codes exposed. |
| LDP-06 | The architecture guard shall prove that no mutable, paid, or networked adapter becomes reachable from the doctor composition path. |
| LDP-07 | Unit, integration, security, and fault evidence shall cover awaited probes, sentinel bracketing, source-mode blocking, healthy observations, malformed observations, and rejected mutation of the live wiring. |

## Constraints

- No dependency or version addition occurs without explicit human approval.
- No secret value, environment value, path, raw database content, provider
  payload, or runtime profile enters a report, log, test fixture, or tracked
  artifact.
- This issue does not qualify T75. Provisioned-machine behavior is exercised
  by the T75 matrix only after its independent evidence candidate exists.

## Acceptance status

All requirements are in progress. Completing an individual vertical does not
close #207 until every affected check has real-observation evidence.
