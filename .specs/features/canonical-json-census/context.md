# Canonical JSON Census Context

## Decision

Issue #58 resumes with a mechanical census before any further portable-identity
migration. The census is source-derived and fails closed when a candidate is
not classified; it is not a claim that every pending migration is complete.

## Boundaries

- Scan TypeScript and module-JavaScript product sources under `packages/`,
  `apps/`, and `scripts/`.
- Detect local canonicalizers, every structured `JSON.stringify` serialization,
  ambient `localeCompare` uses, and SHA-256 digest producers. The serialization
  signal is conservative: a reviewed raw-byte classification may prove that a
  detected serialization is not a portable identity.
- Treat raw-byte digests as distinct from structured canonicalization. They do
  not receive a canonical-JSON migration merely because they use SHA-256.
- Keep an explicit, test-protected allowlist only for presentation or fixture
  ordering. No trust or persistent identity can enter that allowlist.
- Keep protocol, fixture, child-process, and diagnostic serializers outside the
  product candidate set only through a closed, reasoned, test-protected scope
  exclusion list.

## Deferred ideas

The census only classifies and orders migrations. It does not alter byte
contracts, schemas, release formats, or existing V1 verification.
