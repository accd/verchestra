# Canonical JSON Census

Issue: #58

## Requirements

| ID | Requirement |
| --- | --- |
| CJC-01 | A deterministic scanner detects every product source containing a local canonicalizer, ambient `localeCompare`, or SHA-256 digest producer. |
| CJC-02 | Every detected source has exactly one closed classification in a tracked inventory; an unclassified, duplicate, or stale entry fails a declared gate. |
| CJC-03 | A presentation or fixture ordering exception is explicit, closed, and test-protected; trust and persistent paths cannot use that exception. |
| CJC-04 | The inventory distinguishes migrated V2 paths, retained versioned V1 paths, pending versioned migrations, and raw-byte digests that are not structured canonicalization. |
| CJC-05 | The compatibility matrix and portable handoff name the next ordered migration verticals: signed evidence, release bundle/activation, then portable registries, connectors, extension host, memory, and policy bundles. |

## Success criteria

- [ ] The scanner's candidate set and the tracked inventory set are exactly equal.
- [ ] Candidate signals, closed classifications, and stale inventory entries are asserted by a security test.
- [ ] The presentation/fixture allowlist is empty or explicitly enumerated, and a trust candidate cannot be placed in it.
- [ ] The compatibility matrix links to the mechanical inventory and contains no unclassified census group.
- [ ] `pnpm gate:quick` and `pnpm gate:security` pass without skips or todos.
