# T76 Release Candidate Closure Contract

Issue: #17

## Objective

Make a release candidate a deterministic, independently verifiable closure
over one hermetic bundle, every supported distribution view, the required
supply-chain evidence, and a verified rollback target.

## Requirements

- **RC-01** — The candidate binds an exact 40-character source revision and
  the semantic version of the verified hermetic bundle.
- **RC-02** — Exactly one descriptor exists for each `online`, `mirror`,
  `offline`, and `air-gapped` view, and every descriptor points to the same
  release digest.
- **RC-03** — License, SBOM, provenance, and evaluation evidence are present
  exactly once and their digest/size matches the corresponding bundle
  component.
- **RC-04** — A rollback target is different from the candidate and carries a
  verified proof digest.
- **RC-05** — Candidate bytes are content-addressed with canonical JSON; a
  verifier rejects any semantic or digest mutation with a specific error.

## Boundary

This contract is the first T76 slice. It does not publish a public release,
access a signing secret, or advance T77. TUF metadata generation, real build
inputs, SBOM/license collection, and independently authored qualification
evidence remain subsequent T76 tasks.
