# Supply-Chain, Key, Encryption, and Activation Qualification

## Decision

Verchestra 1.0 qualifies `tuf-js` 5.0.1 with exact-pinned `@tufjs/canonical-json` 2.0.0 on the qualified Node 24.14.0 runtime. `tuf-js` 6.0.0 is currently ineligible because its engine contract requires Node `^24.15.0`; adopting it requires a new runtime qualification rather than silently moving the T01 baseline.

The TUF adapter resolves one complete release view and rejects rollback, freeze/expiry, threshold/signature failure, snapshot/targets mix-and-match, target corruption, wrong platform, mixed release IDs, missing required components, and partial publication. Online, mirror, offline, and air-gapped source adapters share the same trust-root and release-view validation contract.

## Qualified identity

| Component | Qualified value |
| --- | --- |
| Node | 24.14.0 |
| TUF client | `tuf-js` 5.0.1 |
| Canonical TUF JSON | `@tufjs/canonical-json` 2.0.0 |
| TUF fixture keys | Ed25519 |
| Content address | SHA-256 |
| Artifact signature | Ed25519 over canonical JSON |
| Recipient primitive | X25519 + HKDF-SHA-256 + AES-256-GCM |
| Activation | versioned release directory + atomic `active.json` switch |

The qualification fixture creates real signed TUF root, timestamp, snapshot, targets, and target bytes. It runs the production `Updater` implementation rather than a mocked TUF decision oracle.

## Release-view closure

A qualified view contains the same release ID across core, schemas, Cedar, SQLite, Drivers, extensions, migrations, licenses, SBOM, provenance, evaluation attestations, and launchers. Every component must exist in TUF target metadata, download successfully, pass TUF length/hash verification, and match the digest bound by the release manifest.

Every resolver failure returns `activationAllowed: false`. The resolver never owns or mutates the active pointer.

## Key-store boundary

The qualification key store exposes signing, verification, recipient public keys, and private operations while refusing private-key export. It is an in-memory conformance adapter, not an approved production key store.

No platform key store is advertised without a content-bound evidence digest and all required controls:

| Platform | Adapter evidence required |
| --- | --- |
| Windows | CNG KSP, non-exportability, user scope, access control |
| macOS | Keychain, non-exportability, user scope, access control |
| Linux | Secret Service, locked collection, user scope, access control |

Incomplete or missing evidence leaves the platform adapter unavailable. Machine-bound authentication and private key material never enter portable Recovery Bundles.

## Recipient encryption boundary

The spike proves multi-recipient envelope behavior, authenticated encryption, signed manifests, expiry, wrong-recipient rejection, and tamper detection using Node's native X25519, HKDF, AES-GCM, and Ed25519 implementations. This construction qualifies the required primitives and failure contract only; it does **not** establish a permanent Verchestra wire format. T55 must select and qualify a standardized interoperable encoding such as General JWE or HPKE before product implementation.

Recovery manifests require explicit inclusion, exclusion, snapshot digests, Workspace identity, and expiry. Credential values, connection strings, machine authentication, environment values, and raw rows are prohibited.

## Support Bundle boundary

Diagnostic collection is allowlist-only with an absolute prohibited-field layer. Source, prompts, context, credentials, environment values, rows, raw Probe output, transcripts, raw state databases, and unrestricted logs remain excluded even if configuration mistakenly adds them to an allowlist. Inspection precedes export. Export requires both a state-bound Approval digest and Data Egress allow; no path performs an automatic upload.

## Transactional activation

Candidates stage under a unique directory, verify every component and health gate, publish into a versioned release directory, and switch a small active pointer only at the final boundary. Wrong platform, mixed release, missing component, digest failure, staging failure, health failure, publication failure, pointer failure, and invalid rollback target preserve the last-known-good pointer. Rollback can select only an existing verified release manifest.

## Production boundary

This is a qualification spike. T55 must choose the standardized recipient wire format and implement recovery policy rebinding. T65–T67 must implement the complete Hermetic Distribution Bundle, repository transports, trusted-root rotation/delegations, installer platform primitives, crash reconciliation, and uninstall policy. The TUF adapter's internal error normalization is exact-version-sensitive and must remain quarantined behind the distribution port.

## Primary sources

- TUF specification: <https://github.com/theupdateframework/specification/blob/master/tuf-spec.md>
- tuf-js: <https://github.com/theupdateframework/tuf-js>
- Node crypto: <https://nodejs.org/docs/latest-v24.x/api/crypto.html>
- RFC 7516 General JWE: <https://www.rfc-editor.org/rfc/rfc7516.html>
- RFC 9180 HPKE: <https://www.rfc-editor.org/rfc/rfc9180.html>
- Windows CNG key storage: <https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-and-retrieval>
- Apple Keychain key storage: <https://developer.apple.com/documentation/security/storing-keys-in-the-keychain>
- Secret Service API: <https://specifications.freedesktop.org/secret-service/latest/>
