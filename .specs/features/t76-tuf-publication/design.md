# T76 TUF Publication Design

`buildTufReleasePublication` is a pure distribution boundary. It verifies the
candidate and bundle first, reads component bytes supplied by the isolated
build, and emits a `TufReleasePublication` containing only bytes and portable
metadata maps. TUF signed payloads use `@tufjs/canonical-json`, the external
standard required by `tuf-js`; Verchestra component and candidate identities
remain the existing V2 contracts.

The top-level `targets` role binds the release manifest and delegates all
component paths to a terminating `components` role. Every role uses the same
injected Ed25519 signer set and threshold. Consistent-snapshot target paths are
derived from raw SHA-256 bytes, while the client remains responsible for trust
bootstrap, threshold checking, rollback rejection, and staging safety.
