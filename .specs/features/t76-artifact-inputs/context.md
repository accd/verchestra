# Context

T76 already has a canonical `HermeticDistributionBundle` builder and verifier,
but no production boundary converted bytes from an isolated build into the
component records consumed by that contract. The collector fills that seam.

The source directory is an implementation input only. The bundle remains the
portable authority: logical paths, byte digests, sizes, licenses, and
attestations are retained; machine paths and file contents are not.
