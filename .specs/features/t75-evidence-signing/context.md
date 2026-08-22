# T75 Qualification Evidence Signing — Context

Issue #294 turns the T75 evidence index from an explicitly unsigned record
into an externally verifiable DSSE/in-toto attestation. The index generator is
already the canonical reconciler for the qualification matrix; signing must not
reimplement or silently alter its verdict.

The trusted release identity has two deliberately separate parts. A committed
public `PublicKeyRef` is reviewable and available to external verifiers. The
matching PKCS#8 Ed25519 private key is supplied only as a protected GitHub
Actions secret. Neither a test key nor an absent configuration may become
release trust.

The repository cannot provision the protected secret. Its absence is a blocked
condition, not an unsigned success or a synthetic signature.
