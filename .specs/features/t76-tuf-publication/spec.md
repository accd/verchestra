# T76 TUF Publication Specification

Issue: #17

## Requirements

- **TP-01** — A verified candidate and exact component bytes produce one
  signed TUF root, top-level targets role, terminating component delegation,
  snapshot, timestamp, manifest target, and every component target.
- **TP-02** — TUF metadata binds target length, SHA-256 bytes, release identity,
  component identity, and the candidate's exact release digest; the existing
  TUF client resolves the same bundle in online, mirror, offline, and air-gapped
  source modes.
- **TP-03** — Signers are injected callbacks with a declared threshold; missing
  or unattainable signers, invalid expiry, incomplete/duplicate bytes, and
  byte-digest mismatches fail closed before publication.
- **TP-04** — Mutated published target bytes fail TUF verification and cannot
  produce an activation-allowed staged release.

## Boundary

This slice does not provision keys, publish to a public host, activate a
release, execute rollback, or close #17. Real trusted key custody, release
views, rollback evidence, and independent T76 qualification remain required.
