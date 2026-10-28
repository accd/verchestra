# canonicalize 5.1.0

## Problem

Dependabot's #655 proposed `canonicalize` 3.0.0 → 5.1.0, two majors, for
`packages/evidence`, where it is the library behind the V1 evidence
canonicalizer (`canonicalizeJson`). Every V1 digest and signature is computed
over its output, so a change in its bytes would stop stored evidence from
verifying. The owner approved the move on 2026-10-28.

Upstream, 4.0.0 throws on lone surrogates, and 5.0.0 changes the output for
sparse arrays, functions, boxed primitives and a `toJSON` that returns
`undefined`; output for other JSON values is unchanged (5.1.0 release notes).

## Requirements

- **CAN-01**: `canonicalize` SHALL be pinned to `5.1.0` in
  `packages/evidence`, moved through pnpm, and the lockfile SHALL move only
  that package.
- **CAN-02**: `canonicalizeJson` SHALL refuse every input shape whose output
  4.0.0 or 5.0.0 changed with its own `IntegrityError` code, before the
  library runs.
- **CAN-03**: For every value V1 accepts, V1 SHALL write the same bytes as
  V2 (`canonicalizeJsonV2`, the repository's own RFC 8785 serializer), so a
  release that changes valid output fails a test before a stored digest stops
  verifying.
- **CAN-04**: The committed evidence, contract and security suites that
  verify stored digests SHALL pass unchanged.

## Scope

A dependency move with two tests. No canonicalization rule, digest, or stored
artifact changes.
