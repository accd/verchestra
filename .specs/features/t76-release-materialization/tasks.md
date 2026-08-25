# T76 Release Materialization Tasks

- [x] Retain exact source bytes alongside portable component identities.
- [x] Generate four deterministic evidence documents before bundle closure.
- [x] Bind generated evidence identities into a verified complete bundle.
- [x] Add happy-path, ordering, path-redaction, generated-input, collision,
      and non-pass evaluation tests.
- [x] Bind the materialized bytes into a candidate and TUF publication, and
      resolve all four source modes.
- [x] Persist the signed TUF metadata and targets into an atomic filesystem
      publication, with traversal and destination-collision rejection.
- [ ] Obtain independent verification of candidate construction, four source
      views, filesystem publication, and rollback execution.
