---
schema: verchestra-feature-handoff/v1
feature: canonical-json-census
issue: 58
status: verification
branch: codex/issue-58-canonical-json-inventory-refresh
baseRevision: d250c7c994be1c9aa9194118c757b67079d23ad3
lastCompletedTask: T2
nextTask: Run independent spec-anchored validation of the census before opening its review PR.
lastGate: pnpm gate:quick PASS; prior T1 pnpm gate:security PASS
updatedAt: 2026-08-22T23:25:00Z
---

# Scope

This feature restores the source-derived inventory required to finish #58. It
does not change an identity's bytes or make a qualification claim.

# Delivered

The scanner currently detects 76 source files. Every candidate is classified
exactly once as migrated V2, retained versioned V1, pending versioned
migration, raw-byte digest, or the closed presentation/fixture exception. The
security test fails for an unclassified, duplicate, stale, or signal-mismatched
entry and rejects a local canonicalizer in the exception class.

# Next migration order

After the census is independently reviewed, begin the signed-evidence vertical
before release identity work. Release bundle and activation follow it. Portable
registries, connectors, extension host, drivers, memory, and policy bundles
then proceed in independent reviewable verticals.

# Evidence

- `tests/security/canonical-json-census.test.mjs` proves the candidate and
  inventory sets match exactly, rejects stale/duplicate/missing entries, and
  keeps the presentation/fixture exception closed.
- `docs/canonical-json-compatibility.md` records the authoritative inventory
  link and the ordered pending verticals.
- `pnpm gate:security` passed for T1; `pnpm gate:quick` passed for T2.

# Blockers

None for the census itself. A migration may expose a versioning decision or an
external owner action, which must remain a blocker rather than be assumed.
