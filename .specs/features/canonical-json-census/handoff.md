---
schema: verchestra-feature-handoff/v1
feature: canonical-json-census
issue: 58
status: in_progress
branch: codex/issue-58-canonical-json-inventory-refresh
baseRevision: d250c7c994be1c9aa9194118c757b67079d23ad3
lastCompletedTask: T0
nextTask: Implement the mechanical census before changing another portable identity.
lastGate: not run
updatedAt: 2026-08-22T22:45:00Z
---

# Scope

This feature restores the source-derived inventory required to finish #58. It
does not change an identity's bytes or make a qualification claim.

# Next migration order

After the census is independently reviewed, begin the signed-evidence vertical
before release identity work. Release bundle and activation follow it. Portable
registries, connectors, extension host, memory, and policy bundles then proceed
in independent reviewable verticals.

# Blockers

None for the census itself. A migration may expose a versioning decision or an
external owner action, which must remain a blocker rather than be assumed.
