# T76 Release Materialization Specification

Issue: #17

## Requirements

- **RM-01** — Source bytes are collected from one isolated root and the exact
  observed bytes are retained for later TUF publication.
- **RM-02** — License, SBOM, provenance, and evaluation documents are generated
  from the collected component identities before the strict bundle closure is
  built and verified.
- **RM-03** — The result contains no machine root or source path, and source
  descriptor ordering does not alter the release digest or evidence bytes.
- **RM-04** — Generated evidence cannot be supplied as an input component and
  findings such as failed profiles, skips, todos, and surviving mutants remain
  visible in the materialized evaluation document.

## Boundary

This slice does not create a ReleaseCandidate, sign evidence, publish TUF
views, activate a release, execute rollback, or close #17.
