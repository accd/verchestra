---
schema: verchestra-feature-handoff/v1
feature: canonical-json
issue: 58
status: in_progress
branch: codex/issue-58-canonical-json-inventory
baseRevision: 9fe940449360af0bab287c19a3e951a7b4b101f4
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm agent:check
updatedAt: 2026-07-29T20:35:00Z
---

# Scope

Inventory and migration specification for locale-independent canonical JSON.
No production serializer is changed in this slice.

# Completed Evidence

Static search found 178 occurrences of canonicalization or ambient collation.
The first trust-relevant groups and compatibility rules are recorded in spec.md.

# Next Exact Action

Select one compatibility-safe transient or explicitly versioned vertical slice
from `docs/canonical-json-compatibility.md`, then add cross-locale, V1/V2
backward-verification, and ambient-locale discrimination coverage before
changing production bytes.

# Blockers

None.

# Decisions

- No mass replacement before persisted-byte compatibility is explicit.
- V2 is RFC 8785 JCS behind an inward contract/domain primitive; V1 persisted
  and signed bytes remain authoritative until their owning schema migrates.
