# T76 Supply-Chain Evidence Inputs

Issue: #17

## Requirements

- **SE-01** — Generate exactly one license-closure, SBOM, provenance, and
  evaluation document from a pinned release identity and collected component
  metadata.
- **SE-02** — Canonical V2 bytes, SHA-256 digest, and byte size are derived
  from the generated content; the verifier rejects mutation or non-canonical
  bytes.
- **SE-03** — Component and evaluation input order is irrelevant, while
  duplicate identities, invalid counters, and generated-evidence recursion
  fail closed.
- **SE-04** — Evaluation evidence preserves `fail`, `blocked`, skipped, todo,
  and surviving-mutant findings; it never upgrades them to pass.

## Boundary

This slice does not sign evidence, create a TUF root, publish views, activate
or roll back a release, or close #17/#16/#18. It produces portable evidence
inputs for the later release workflow.
