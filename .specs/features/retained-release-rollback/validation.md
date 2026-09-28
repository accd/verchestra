# Retained Release Rollback Validation (#393)

Every requirement in `spec.md` maps to the assertion that proves it. No live
run is claimed; every row below is deterministic.

| Requirement | Evidence (file:line, assertion) |
| --- | --- |
| RR-01 record written only with provenance, latest last | `tests/integration/retained-release-rollback.test.mjs:61` (exact record contents, A then B); `:75` (no provenance, empty `verified/`, nothing retained); `:137` (re-verification moves an entry to the end) |
| RR-02 superseded release re-activates with zero source reads | `tests/e2e/vestra-launcher-activation.test.mjs:318` (`rolled.reads === 0`); `:319` (`{ operation: "rollback", releaseReused: true, network: false }`); `:330` (a second run of A still reads nothing and executes, exit 5); `tests/integration/retained-release-rollback.test.mjs:85` (latest not retained, superseded retained); `:93` (not visible under another root) |
| RR-03 every other case keeps the network path; remote downgrade still `VES_TUF_ROLLBACK` | `tests/e2e/vestra-launcher-activation.test.mjs:346` (no record: `VES_TUF_ROLLBACK`, reads > 0); `:385` (never-installed older release: `VES_TUF_ROLLBACK`, reads > 0); `:334` (latest release still reads the source); `:402` (different root reads its own metadata); `tests/e2e/tuf-update-client.test.mjs:157` (client refuses A after B with "version 1 is less than current version 2"); `tests/integration/retained-release-rollback.test.mjs:149` (ambiguous identity not retained); `:164` (uninstalled release not retained) |
| RR-04 fail closed, pointer unchanged, no network fallback | `tests/e2e/vestra-launcher-activation.test.mjs:361`–`:362` (tampered A: `VES_ACTIVATION_INTEGRITY`, zero reads, B stays active); `tests/integration/retained-release-rollback.test.mjs:117`, `:125` (`VES_ROLLBACK_TARGET_UNTRUSTED`); `tests/security/transactional-activation-security.test.mjs:241` (malformed record), `:256` (record copied under another root), `:267` (renamed identity), `:282` (duplicate digest), `:292` (junction), `:307` (other host: `VES_ACTIVATION_RELEASE_MIXED`), `:223`/`:232` (malformed provenance); `tests/security/tuf-update-security.test.mjs:212` (replaced anchor), `:221` (symlinked anchor) |
| RR-05 journaled rollback, crash-safe, foreign journal blocks | `tests/fault-injection/transactional-activation-faults.test.mjs:163` (crash at `after-journal-prepared`, `after-pointer`, `after-journal-committed`: journal `operation: "rollback"`, pointer at previous or target, retry converges, no journal left); `:193` (interrupted rollback blocks a different activation until it converges); `:212` (foreign activation journal blocks a rollback) |
| RR-06 path surfaced in receipt and target | `tests/integration/retained-release-rollback.test.mjs:98` (exact rollback receipt, health re-run, record order unchanged); `tests/e2e/vestra-launcher-activation.test.mjs:319`, `:335` |
| RR-07 purge removes records | `tests/integration/retained-release-rollback.test.mjs:173`; `:180` (non-purging uninstall keeps retained releases usable) |
| RR-08 workflow documentation and stricter pointer check | `tests/agent-readiness/live-activation-workflow.test.mjs:113` (pointer recorded after activate, update, rollback; leg fails unless update moved it and rollback restored it); `:134` (anti-rollback, retained path, and roll-forward alternative stated); `docs/qualification/acceptance-matrix.md` J02 and L7 (deterministic only, no live claim) |

## Discrimination sensor

With `apps/vestra-launcher/closure/node-activation-closure.ts` reverted to its
`origin/main` content and everything else from this change kept, the #393
launcher test (`vestra-launcher-activation.test.mjs:314`) fails with the
`VES_TUF_ROLLBACK` refusal it reproduces, as do the tampered-retained and
different-root tests. The two refusal tests (`:338`, `:366`) pass on both
revisions, which is the point: the refusal is unchanged.

## Workflow logic check

The workflow's shell body was extracted and run locally against a fake `npx`
under a temporary home: a correct lifecycle exits 0; an update that does not
move the pointer and a rollback refused by anti-rollback each exit 1 with the
matching summary line.
