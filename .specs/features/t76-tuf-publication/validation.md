# T76 TUF Publication Validation

This validation covers the publisher library boundary (TP-01..TP-04) and the
operator-base-URL publication script, workflow, and pinned-input contract
(TP-05..TP-09).

| Requirement | Evidence                                                                                                                                 | Result |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TP-01       | `tests/build/tuf-publication.test.mjs` signed root/delegation and target-map assertions                                                  | PASS   |
| TP-02       | `tests/build/tuf-publication.test.mjs` resolves online/mirror/offline/air-gapped and non-consistent snapshots through `TufUpdateClient`  | PASS   |
| TP-03       | `tests/security/tuf-publication-security.test.mjs` threshold, expiry, incomplete, duplicate, and byte-mismatch assertions                | PASS   |
| TP-04       | `tests/security/tuf-publication-security.test.mjs` post-publication target tamper rejection with activation denied                       | PASS   |
| TP-05       | `tests/build/t76-release-publication.test.mjs` base-URL rejection set with no output directory, per-target URL pairs, per-asset remote keys | PASS   |
| TP-06       | `tests/build/t76-release-publication.test.mjs` single release-inputs round-trip through the real `loadPinnedInputs`, `buildVestraLauncher`, and TUF-client staging of two published repositories | PASS   |
| TP-07       | `tests/build/t76-release-publication.test.mjs` rollback-index incompleteness, re-serialization, same-revision, and same-digest rejections | PASS   |
| TP-08       | `tests/build/t76-release-publication.test.mjs` no-cause key failures and CLI never-echoes-key proof; `tests/agent-readiness/t76-publish-workflow.test.mjs` single-secret single-step assertions | PASS   |
| TP-09       | `tests/agent-readiness/t76-publish-workflow.test.mjs` read-only, env-mediation, SHA-pin, ownership-boundary, and publishes-nothing assertions | PASS   |

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

| Requirement | Happy-path assertion                                                                                                       | Failure-path assertion                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TP-05       | upload-manifest test proves `metadataBaseUrl`/`targetBaseUrl` and every `remoteKey` mirror the emitted tree byte for byte  | base-URL test rejects http, userinfo, query, fragment, missing slash, `${`, and over-long values with no output created  |
| TP-06       | single-release-inputs test round-trips the emitted bytes through `loadPinnedInputs` and `buildVestraLauncher`; staging test resolves win32-x64 and linux-arm64 repositories with full component coverage | launcher-contract loader itself rejects any non-conforming source (`apps/vestra-launcher` suite, unchanged)              |
| TP-07       | shared publication succeeds only with a sealed prior index for every fleet key                                             | rollback tests reject a missing fleet key, a re-serialized index, the published revision, and an equal prior digest      |
| TP-08       | CLI success run emits a summary with no key material                                                                       | malformed-key set, cause-free failure proof, and CLI failure run never echo key bytes                                    |
| TP-09       | workflow emits three fail-closed artifacts and builds the launcher from the single release-inputs directory                | ownership test forbids `github.repository`, storage CLI strings, extra secrets; env-mediation test forbids run-block interpolation |

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
