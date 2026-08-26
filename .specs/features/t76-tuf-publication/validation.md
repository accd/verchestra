# T76 TUF Publication Validation

This validation covers the publisher library boundary (TP-01..TP-04) and the
operator-base-URL publication script, workflow, and pinned-input contract
(TP-05..TP-09).

| Requirement | Evidence                                                                                                                                                                                                                                                                                                                                                             | Result |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TP-01       | `tests/build/tuf-publication.test.mjs` signed root/delegation and target-map assertions                                                                                                                                                                                                                                                                              | PASS   |
| TP-02       | `tests/build/tuf-publication.test.mjs` resolves online/mirror/offline/air-gapped and non-consistent snapshots through `TufUpdateClient`                                                                                                                                                                                                                              | PASS   |
| TP-03       | `tests/security/tuf-publication-security.test.mjs` threshold, expiry, incomplete, duplicate, and byte-mismatch assertions                                                                                                                                                                                                                                            | PASS   |
| TP-04       | `tests/security/tuf-publication-security.test.mjs` post-publication target tamper rejection with activation denied                                                                                                                                                                                                                                                   | PASS   |
| TP-05       | `tests/build/t76-release-publication.test.mjs` base-URL rejection set with no output directory, per-target URL pairs, per-asset remote keys                                                                                                                                                                                                                          | PASS   |
| TP-06       | `tests/build/t76-release-publication.test.mjs` single release-inputs round-trip through the real `loadPinnedInputs`, `buildVestraLauncher`, and TUF-client staging of two published repositories                                                                                                                                                                     | PASS   |
| TP-07       | `tests/build/t76-release-publication.test.mjs` rollback-index incompleteness, re-serialization, same-revision, and same-digest rejections                                                                                                                                                                                                                            | PASS   |
| TP-08       | `tests/build/t76-release-publication.test.mjs` no-cause key failures and CLI never-echoes-key proof; `tests/agent-readiness/t76-publish-workflow.test.mjs` single-secret single-step assertions                                                                                                                                                                      | PASS   |
| TP-09       | `tests/agent-readiness/t76-publish-workflow.test.mjs` read-only, env-mediation, SHA-pin, ownership-boundary, and publishes-nothing assertions                                                                                                                                                                                                                        | PASS   |
| TP-10       | `tests/build/sealed-launcher-closure.test.mjs` real `NodeActivationHealthGate` over the staged layout, honest observation contents, delegated `--version`/`--help`, dev-shim red case, byte-identical rebuilds, built-ins-only imports; `tests/build/reproducible-target-build.test.mjs` bundled-launcher digest, sealed closure sources, `VES_T76_BUILD_TREE_DIRTY` | PASS   |

Focused results on this branch:

- `tests/build/t76-release-publication.test.mjs` — 18 passed, 0
  failed/skipped/todo.
- `tests/agent-readiness/t76-publish-workflow.test.mjs` — 12 passed, 0
  failed/skipped/todo.
- `tests/build/tuf-publication.test.mjs` (6) and
  `tests/build/vestra-launcher-package.test.mjs` (11) — 17 passed together,
  0 failed/skipped/todo.
- `tests/security/canonical-json-census.test.mjs` — 10 passed, 0
  failed/skipped/todo, with `scripts/t76-publish-release.mjs` classified
  `migrated-v2` after `census:refresh`.
- `tests/build/sealed-launcher-closure.test.mjs` — 7 passed, 0
  failed/skipped/todo. Both sealed launchers pass the real activation health
  gate from a staged layout with no `src/` and no `node_modules/`; the
  development shims fail the same gate with ERR_MODULE_NOT_FOUND, which is
  the exact live failure mode the previous synthetic fixtures never observed.
- `tests/build/reproducible-target-build.test.mjs` — 3 passed, 0
  failed/skipped/todo, now against a sealed single-commit replica of the
  working tree (tests/helpers/sealed-repository-fixture.mjs) because the
  builder refuses a dirty tree; the launcher component digest is proved equal
  to the deterministic bundle and not equal to the development shim.
- `apps/vestra-cli/src/sealed-launcher.ts` classified `raw-byte-digest` in
  `docs/canonical-json-census.json` after `census:refresh` and review: its
  SHA-256 covers fixed migration statement strings, and its JSON.stringify
  prints the health protocol document whose canonical identity the gate
  computes with the qualified V2 contract.

Known adjacent defect, recorded not fixed here: the candidate builder seals
the hermetic runtime at logical path `runtime/node` for every platform, but a
Windows host cannot spawn an extensionless executable (the platform's process
search appends an executable extension), so a win32 candidate's health gate
would fail with `VES_LAUNCHER_PROCESS_FAILED` before reaching any launcher.
`tests/helpers/activation-health-fixture.mjs` and
`tests/build/sealed-launcher-closure.test.mjs` therefore stage
`runtime/node.exe` on win32. Renaming the sealed runtime component is a
separate change because publication path derivation and fixtures pin the
current logical path.

Full gates on this branch:

- `gate:quick` PASS — 2,166 unit and 195 readiness tests; zero
  failures/skips/todos. `agent:check` PASS.
- `gate:build` PASS — 2,166 unit, 541 contract, 657 integration, 188 e2e,
  49 architecture, 84 build, and 251 qualification tests; zero
  failures/skips/todos.
- `gate:security` PASS — 2,166 unit, 541 contract, 188 e2e, 49 architecture,
  251 qualification, 1,177 security, and 299 fault tests; zero
  failures/skips/todos.

Test adequacy review for the new slice:

| Requirement | Happy-path assertion                                                                                                                                                                                     | Failure-path assertion                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TP-05       | upload-manifest test proves `metadataBaseUrl`/`targetBaseUrl` and every `remoteKey` mirror the emitted tree byte for byte                                                                                | base-URL test rejects http, userinfo, query, fragment, missing slash, `${`, and over-long values with no output created            |
| TP-06       | single-release-inputs test round-trips the emitted bytes through `loadPinnedInputs` and `buildVestraLauncher`; staging test resolves win32-x64 and linux-arm64 repositories with full component coverage | launcher-contract loader itself rejects any non-conforming source (`apps/vestra-launcher` suite, unchanged)                        |
| TP-07       | shared publication succeeds only with a sealed prior index for every fleet key                                                                                                                           | rollback tests reject a missing fleet key, a re-serialized index, the published revision, and an equal prior digest                |
| TP-08       | CLI success run emits a summary with no key material                                                                                                                                                     | malformed-key set, cause-free failure proof, and CLI failure run never echo key bytes                                              |
| TP-09       | workflow emits three fail-closed artifacts and builds the launcher from the single release-inputs directory                                                                                              | ownership test forbids `github.repository`, storage CLI strings, extra secrets; env-mediation test forbids run-block interpolation |

Reverse mapping: every assertion in the two new suites is claimed by TP-05
through TP-09; there are no unclaimed tests, skipped tests, TODOs, or vacuous
assertions. Fixtures use ephemeral in-process signing keys and
`mkdtemp(tmpdir())` roots only; no repository or CI secret, real revision,
username, or machine-local path appears in any tracked file.

This slice still performs no publication: no storage credential exists in the
repository, the workflow uploads nothing to any endpoint, and `npm publish`
remains a human step. Independent review, the operator's live-endpoint
verification, rollback execution evidence, and the remaining T76 requirements
are still required; this change does not close #17 or advance T77.

## Live publication evidence (operator-authorized, 2026-08-26)

The owner authorized the operator run and provisioned the storage custody
(API token in a local environment variable, never in the repository or CI).
Every claim below is from executed commands, not projection:

- Endpoint: Cloudflare R2 bucket `verchestra-releases` (WEUR) behind the
  managed public base `https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/`.
- Candidate: `a49f3dd5aa3e639db87f8715077446ec075600e9`, run 32927839487,
  all five target legs green, five gate profiles each. Publication: run
  32929312169 with `--rollback-index` from the prior sealed candidate
  af8bcf044cf8/32916088873; the workflow's own verification build consumed
  the emitted single `release-inputs/`.
- Integrity: all 990 manifest assets sha256-verified locally before upload;
  every uploaded object's stored bytes proven by comparing the store's
  returned content hash against the local hash (101 changed or new objects
  uploaded; 889 hash-named objects unchanged from the previous upload and
  reused, which is exactly the consistent-snapshot property).
- Endpoint conformance, probed with the TUF client's own requirements:
  metadata answers 200 with exact `Content-Length` and no `Content-Encoding`
  even when the client offers gzip; a ranged target request answers 206 with
  an exact `Content-Range`; no redirects.
- Live activation on win32-x64 from a wiped managed state: cold run 93s
  (full TUF resolution, download, staging, both sealed launchers through the
  real activation health gate, promotion, verified handoff), warm run 5s,
  `Verchestra 0.0.0-qualification` from both `vestra` and `verchestra` bins,
  and `--help` renders the activated CLI's real command surface.
- Reproducibility: the operator-built package is byte-identical to the CI
  verification artifact at the same revision (diff -r, zero differences),
  packed as `verchestra-0.0.0-qualification.tgz`.

Still open before #17 can close: the Linux-host live verification and the
manual `npm publish` (both operator steps), independent T76 review, and the
T76 validation report with the chain advance. Known cosmetic item: sealed
`--version` renders the "(source build, no verified release artifact)"
suffix because the sealed manifest's releaseDigest is protocol-null; the
rendering decision is deliberately unchanged in this slice.
