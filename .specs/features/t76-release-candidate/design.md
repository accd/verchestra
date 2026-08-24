# T76 Release Candidate Design

`packages/distribution/src/release-candidate.ts` is the canonical runtime
boundary. It consumes the already-qualified `HermeticDistributionBundle` and
normalizes a candidate body before hashing its RFC 8785-compatible canonical
JSON representation with `canonicalizeJsonV2`.

The candidate carries four source-view descriptors, four evidence descriptors,
and one rollback proof. View descriptors contain only source identity and
content digests; they never contain URLs or runtime resolver instructions.
Evidence descriptors are checked against the bundle's own component closure,
so a candidate cannot claim an SBOM, license, provenance, or evaluation file
that differs from the sealed bundle. Verification rebuilds the normalized body
and compares the candidate digest, rather than trusting stored fields.

The module is exported from `@verchestra/distribution`. No package boundary or
dependency changes are introduced.
