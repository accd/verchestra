# Canonical JSON portability inventory

Issue: #58

## Requirement

Every structured value that contributes to a portable digest, signature,
idempotency key, plan identity, or persistent verification must name a single,
locale-independent canonical JSON contract. Existing bytes remain authoritative
until a versioned migration proves backward verification.

## Inventory boundary

The first pass found local canonicalizers in application authority, coordination,
egress, execution, handoff, sync; agent-runtime context/discovery/models/skills;
policy; distribution; data-probe and its seven database adapters; workspace; and
platform adapters. The qualified existing primitive is
`packages/evidence/src/integrity/canonical.ts`.

## Migration rules

1. Classify each candidate as `trust`, `persistent`, or `presentation`.
2. Trust and persistent paths must state their current byte contract and every
   persisted schema/version before replacement.
3. A changed byte contract requires a new schema/version plus backward
   verification; it never silently rehashes prior records.
4. Array order is semantic unless a domain-specific normalization explicitly
   declares it a set.
5. Ambient `localeCompare` is prohibited for trust ordering; presentation-only
   sorting is outside this migration.

## Compatibility matrix

`docs/canonical-json-compatibility.md` is the canonical T2 matrix. It records
the contract placement, every trust/persistent serializer group, existing byte
consumer, V1 preservation rule, and required V2 migration boundary. No
production serializer changes in T2.
