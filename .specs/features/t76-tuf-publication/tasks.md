# T76 TUF Publication Tasks

- [x] T1 — Define signer, publication, metadata, delegation, and target
      contracts.
- [x] T2 — Generate signed root, targets, delegated components, snapshot, and
      timestamp metadata with consistent-snapshot targets.
- [x] T3 — Prove four-mode resolution and fail-closed byte/threshold
      boundaries.
- [x] T4 — Derive delegation paths from bundle component logical paths so
      nested component paths resolve through the TUF client.
- [x] T5 — Version the launcher's pinned inputs to a schemaVersion-2 per-target
      source map validated per entry.
- [x] T6 — Rework the publication script and workflow from GitHub Releases to
      an operator-supplied base URL: fail-closed base URL validation, one
      shared `release-inputs/` directory for all five targets, per-asset
      remote keys mirroring the emitted tree, and rollback proof drawn from a
      sealed prior reconciled index.
- [ ] T7 — Operator provisions the release signing secret and the storage
      endpoint, dispatches the publication workflow at an exact reviewed SHA,
      uploads the emitted tree by hand, and verifies the live endpoint with
      the verification launcher package.
- [ ] T8 — Obtain independent T76 verification; this feature does not close
      #17 by itself.
