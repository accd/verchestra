# Live Doctor Probes Design

## Flow

```mermaid
flowchart LR
  Before["Capture sentinels"] --> Facts["Await closed doctor probe set"]
  Facts --> After["Capture sentinels"]
  After --> Diff["Require identical sentinels"]
  Diff --> Report["Build closed report and seal"]
```

`DoctorSubsystemProbe` returns either a `DoctorObservation` or a promise of
one. `collectDoctorFacts` awaits probes in catalog order and converts a thrown
or rejected observation into the existing present-but-unhealthy fact. This
retains the T72 non-leak guarantee: error text is never copied into a fact.

## Live observation boundaries

| Check | Planned live boundary | Dependency condition |
| --- | --- | --- |
| sandbox | Protected-path broker rejects an out-of-root request | Existing platform-node dependency |
| sqlite-durable-state | Dedicated read-only runtime inspection API | Existing platform-node dependency |
| secret-presence | Presence-only secret-provider API | Existing platform-node dependency |
| driver | Driver availability probe with sanitized result | Existing drivers dependency |
| cedar-policy | Verify a policy bundle with pinned public identity | Requires direct policy dependency approval |
| connector | Connector availability surface without transport call | Requires direct connectors dependency approval |
| probe | Probe-worker availability surface without connection | Requires direct data-probe dependency approval |

The implementation must not substitute a path probe for a live observation.
If a dependency is not approved, that vertical remains blocked and #207 stays
open rather than reporting a fictional pass.

## Failure behavior

- Missing provisioned state: `blocked` using the existing remediation mapping.
- A live observer that throws, rejects, is malformed, or reports unhealthy:
  `fail` without error text.
- A sentinel difference after any awaited observer: fail closed before sealing.
- An observation that would invoke a driver, connector, provider, or network:
  architecture/security test failure; it must not ship.
