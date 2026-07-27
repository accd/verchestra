# Key Lifecycle Design

## Port and Adapters

```text
KeyProviderPort (packages/evidence/src/integrity/key-provider.ts)
  ├── loadOrCreate(keyId, purposes) → SignerHandle
  ├── rotate(keyId, overlap) → { current, previous }
  ├── revoke(keyId) → void
  └── Adapters:
        EncryptedFileKeyProvider  (this feature)
        KmsKeyProvider            (future)
        KeychainKeyProvider       (future)
        SigstoreKeylessProvider   (future)
```

`SignerHandle` wraps the existing `NodeEd25519Signer` so `ArtifactSealer`
(`packages/evidence/src/integrity/artifact-sealer.ts:103`) keeps its current
shape; the handle additionally exposes the `PublicKeyRef` and validity
window for trust-root publication.

## Encrypted-File Adapter

- Location: OS local state root (the same machine-local split documented in
  `docs/architecture.md` "Repository placement"), never under committable
  `.verchestra/` subtrees.
- Format: versioned JSON envelope `{ version, keyId, kdf: { name: "scrypt",
  salt, N, r, p }, cipher: { name: "AES-256-GCM", iv, tag }, ciphertext,
  publicKeyRef }` — all from `node:crypto`, no new dependency.
- Passphrase: interactive prompt or environment injection at the composition
  root; never stored, logged, or written to evidence.
- Permissions: owner-only file mode (`0o600`); Windows ACL best-effort with
  a documented limitation.
- Tamper/corruption: GCM tag failure or envelope parse failure →
  `VES_KEYSTORE_INTEGRITY` (new public error code), fail closed (KEY-07).

## Rotation and Revocation

- The trust root gains a key registry: `keyId → PublicKeyRef[]` ordered by
  `validFrom`. Rotation appends the new ref and sets `validUntil = now +
  overlap` on the old ref. Verification accepts any non-expired,
  non-revoked ref whose `purposes` cover the artifact purpose.
- Revocation marks the ref revoked; verification of *new* artifacts fails,
  while previously verified historical evidence keeps its recorded verdict
  (fail closed for new work, no retroactive rewriting of history).
- New error codes follow the existing discipline: `VES_KEY_REVOKED`,
  `VES_KEY_EXPIRED`, `VES_KEYSTORE_INTEGRITY`, `VES_KEY_PURPOSE_DENIED`
  (extends the existing `VES_SIGNING_PURPOSE_DENIED` behavior in
  `signer.ts:52-56`).

## Composition Wiring (KEY-05)

Today no product code constructs a signer — only tests do
(`tests/helpers/execution-package-fixture.mjs:161` and siblings). The
composition root in `apps/vestra-cli` will resolve a `KeyProviderPort`
implementation from workspace configuration (default: encrypted file) and
inject it into sealing and verification workflows.

## Portability Proof (KEY-06 / R13)

End-to-end test plus a documented manual demo script:

1. Environment A: create keystore, seal an Execution Package, export the
   trust root (public material only) and the package.
2. Environment B (separate state root; CI uses a second temp directory;
   the manual demo uses a second machine): import trust root, verify the
   package signature, resume with a different qualified driver, and verify
   the resulting Run Capsule.
3. Acceptance evidence: passing e2e test in `tests/e2e/` and a recorded
   demo transcript suitable for docs/site content.

## Test Strategy

- Unit: envelope round-trip, wrong passphrase, truncated file, tampered
  ciphertext, expired overlap, revoked key, purpose mismatch.
- Security (`tests/security/`): key material never appears in logs,
  evidence, support bundles, or error messages.
- Fault injection (`tests/fault-injection/`): keystore unreadable mid-seal,
  disk-full on persist.
- E2E: the portability proof above.
