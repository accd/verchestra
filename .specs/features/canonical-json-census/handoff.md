---
schema: verchestra-feature-handoff/v1
feature: canonical-json-census
issue: 58
status: complete
branch: codex/issue-58-canonical-json-inventory-refresh
baseRevision: d250c7c994be1c9aa9194118c757b67079d23ad3
lastCompletedTask: T2
nextTask: Start T4j release identity and T4k remaining census closure through canonical-json-t4-completion.
lastGate: pnpm gate:security PASS; pnpm gate:quick PASS
updatedAt: 2026-08-23T00:00:00Z
---

# Scope

This feature restores the source-derived inventory required to finish #58. It
does not change an identity's bytes or make a qualification claim.

# Delivered

The merged scanner currently detects 86 source files. The historical validation
report records 85 at its earlier candidate revision; the merged main census is
the current source of truth and must be revalidated before the next migration.
Every candidate is classified
exactly once as migrated V2, retained versioned V1, pending versioned
migration, raw-byte digest, or the closed presentation/fixture exception. The
security test fails for an unclassified, duplicate, stale, signal-mismatched,
unreasoned, or exception-invalid entry. It conservatively detects structured
`JSON.stringify` serialization, requires closed reasons for every excluded
non-product serializer, and rejects a trust or persistent path in the
presentation/fixture exception.

# Next migration order

The signed-evidence vertical is merged in PR #305/#307. Begin release identity
before release; release bundle and activation follow it. Portable
registries, connectors, extension host, drivers, memory, and policy bundles
then proceed in independent reviewable verticals.

# Evidence

- `tests/security/canonical-json-census.test.mjs` proves the candidate and
  inventory sets match exactly, rejects stale/duplicate/missing entries,
  detects named and structured serializers, requires an entry reason, protects
  the closed non-product scope exclusions, and keeps the presentation/fixture
  exception closed to its reviewed paths.
- `docs/canonical-json-compatibility.md` records the authoritative inventory
  link and the ordered pending verticals.
- `pnpm gate:security` passed for T1 after the serialization-signal correction;
  `pnpm gate:quick` passed for T2 after that correction.

# Blockers

The conservative serialization signal and reviewed scope exclusions passed
independent validation and the feature was merged in PR #304. A migration may
expose a versioning decision or an external owner action, which must remain a
blocker rather than be assumed.
