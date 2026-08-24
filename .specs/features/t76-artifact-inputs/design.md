# Design

`buildHermeticDistributionBundleFromFiles` accepts the normal bundle identity
fields plus an isolated `rootDirectory` and source descriptors. It resolves the
root once, validates every source as a forward-slash relative path, rejects
final symlinks, checks the resolved file remains under the root, reads the
bytes, and derives `sha256` and `sizeBytes`.

The function then delegates the complete component closure to
`buildHermeticDistributionBundle`. The returned object therefore has the same
schema, canonical V2 release digest, platform checks, license closure, and
attestation closure as any other hermetic bundle. No source path or build-root
value is copied into the bundle.

The collector is intentionally asynchronous because filesystem reads are
asynchronous. It has no activation, network, signing, or runtime-resolution
authority.
