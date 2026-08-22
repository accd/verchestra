# Context — signed-evidence canonical JSON

Issue #58 requires signed and persisted evidence to move from the qualified V1
canonical JSON facade without silently changing historical bytes. The current
Execution Package has eleven ambient-locale ordering sites before it enters the
DSSE envelope. Its envelope, payload digest, artifact ID, and persisted package
file are all therefore part of the compatibility boundary.

The repository already provides the V2 RFC 8785 encoder in `@verchestra/domain`.
This slice adds that existing inward workspace dependency to `@verchestra/evidence`;
it adds no third-party dependency. It migrates Execution Package only. Run
Capsule, Recovery Bundle, Support Bundle, and release artifacts remain V1 until
their own compatible migration work is complete.

## Constraints

- Schema version 1 continues to use the V1 encoder and its existing locale-order
  semantics for backward verification.
- New Execution Packages use `schemaVersion: 2`, V2 code-unit set ordering, and
  the version-2 Execution Package in-toto predicate.
- The DSSE projection, disk serialization, payload digest, and artifact ID select
  their encoder from the recorded schema version; no verifier guesses a version.
- V1 and V2 artifacts are distinct identities and never compare as interchangeable.
- The migration does not change keys, trust roots, signing algorithms, or release
  status.
