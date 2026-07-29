---
schema: verchestra-feature-handoff/v1
feature: canonical-json
issue: 58
status: in_progress
branch: codex/issue-58-inventory-correction
baseRevision: f228e4ac331e843e340ff770141e768091b7bc7c
lastCompletedTask: T2
nextTask: T3
lastGate: pnpm agent:check
updatedAt: 2026-07-29T21:45:10Z
---

# Scope

Inventory and migration specification for locale-independent canonical JSON.
No production serializer is changed in this slice.

# Completed Evidence

Static search found 178 occurrences of canonicalization or ambient collation.
T2 records the contract, compatibility rules, and trust/persistence inventory
in `docs/canonical-json-compatibility.md`; the inventory now explicitly
includes the Workspace identity vertical, effect idempotency keys, gate
worktree change digests, and runtime policy-view verification.

# Next Exact Action

Obtain an explicit owner decision for the T3 canonical JSON implementation:
approve moving or adding `canonicalize@3.0.0` to `packages/domain` with a
lockfile update, or approve a separately reviewed internal RFC 8785 encoder.
Then migrate the selected Workspace identity vertical with cross-locale, V1/V2
backward-verification, and ambient-locale discrimination coverage before
changing other production bytes.

# Blockers

None.

# Decisions

- No mass replacement before persisted-byte compatibility is explicit.
- V2 is RFC 8785 JCS behind an inward contract/domain primitive; V1 persisted
  and signed bytes remain authoritative until their owning schema migrates.
- T3 is the Workspace identity vertical; existing inventory, plan, and journal
  records remain V1-verifiable until their versioned migration is complete.
