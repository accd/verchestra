---
schema: verchestra-feature-handoff/v1
feature: canonical-json
issue: 58
status: in_progress
branch: codex/issue-58-canonical-json-inventory
baseRevision: 9fe940449360af0bab287c19a3e951a7b4b101f4
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm agent:check
updatedAt: 2026-07-29T10:50:00Z
---

# Scope

Inventory and migration specification for locale-independent canonical JSON.
No production serializer is changed in this slice.

# Completed Evidence

Static search found 178 occurrences of canonicalization or ambient collation.
The first trust-relevant groups and compatibility rules are recorded in spec.md.

# Next Exact Action

Classify each trust/persistent candidate by digest or signature consumer and
write the compatibility matrix before selecting a migration slice.

# Blockers

None.

# Decisions

- No mass replacement before persisted-byte compatibility is explicit.
