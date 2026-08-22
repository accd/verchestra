---
schema: verchestra-feature-handoff/v1
feature: canonical-json-census
issue: 58
status: verification
branch: codex/issue-58-canonical-json-inventory-refresh
baseRevision: d250c7c994be1c9aa9194118c757b67079d23ad3
lastCompletedTask: T2
nextTask: Rerun independent spec-anchored validation after the conservative serialization-signal correction, then open the review PR only on PASS.
lastGate: pnpm gate:security PASS; pnpm gate:quick PASS
updatedAt: 2026-08-23T00:30:00Z
---

# Scope

This feature restores the source-derived inventory required to finish #58. It
does not change an identity's bytes or make a qualification claim.

# Delivered

The scanner currently detects 84 source files. Every candidate is classified
exactly once as migrated V2, retained versioned V1, pending versioned
migration, raw-byte digest, or the closed presentation/fixture exception. The
security test fails for an unclassified, duplicate, stale, signal-mismatched,
unreasoned, or exception-invalid entry. It conservatively detects structured
`JSON.stringify` serialization, requires closed reasons for every excluded
non-product serializer, and rejects a trust or persistent path in the
presentation/fixture exception.

# Next migration order

After the census is independently reviewed, begin the signed-evidence vertical
before release identity work. Release bundle and activation follow it. Portable
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

None for the census itself. The prior independent validation found additional
structured serializers outside the name-based detector; the conservative signal
and reviewed scope exclusions are now implemented and gated. Fresh independent
validation is required before opening a review PR. A migration may expose a
versioning decision or an external owner action, which must remain a blocker
rather than be assumed.
