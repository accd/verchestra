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
| TP-11       | `tests/build/sealed-launcher-closure.test.mjs` `doctor --deep` and `self-test --profile {smoke,full}` executed from the staged layout, sealed-vs-checkout check-catalog equality, per-layout resolver assertions; `tests/build/reproducible-target-build.test.mjs` crash-child component identity and digest, sealed fake-driver component; `tests/architecture/doctor-readonly-graph.test.mjs` reviewed allowlist widening | PASS   |

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
- `tests/build/sealed-launcher-closure.test.mjs` — 11 passed, 0
  failed/skipped/todo. Both sealed launchers pass the real activation health
  gate from a staged layout with no `src/` and no `node_modules/`; the
  development shims fail the same gate with ERR_MODULE_NOT_FOUND, which is
  the exact live failure mode the previous synthetic fixtures never observed;
  and `doctor --deep` (BLOCKED, exit 4, catalog equal to the checkout's),
  `self-test --profile smoke` (PASS, 6 checks), and `self-test --profile full`
  (PASS, 10 checks, about 26s) now execute from that layout through the
  release's own runtime.
- `tests/build/reproducible-target-build.test.mjs` — 3 passed, 0
  failed/skipped/todo, now against a sealed single-commit replica of the
  working tree (tests/helpers/sealed-repository-fixture.mjs) because the
  builder refuses a dirty tree; the launcher component digest is proved equal
  to the deterministic bundle and not equal to the development shim, and the
  crash-child component's kind, logical path, portability, non-executability,
  and digest are proved against the same bundler.
- `tests/architecture/doctor-readonly-graph.test.mjs` — 7 passed, 0
  failed/skipped/todo, with `./release-layout.ts` added to the reviewed
  read-only allowlist and a new assertion proving that module imports only
  `node:fs`, `node:url`, and `./release-manifest.ts` and calls no writing or
  spawning function.
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
  50 architecture, 97 build, and 251 qualification tests; zero
  failures/skips/todos.
- `gate:security` PASS — 2,166 unit, 541 contract, 188 e2e, 50 architecture,
  251 qualification, 1,177 security, and 299 fault tests; zero
  failures/skips/todos.

(The architecture and build counters rose by the TP-11 additions: one reviewed
allowlist guard in `tests/architecture/doctor-readonly-graph.test.mjs`, and the
staged-layout command tests in `tests/build/sealed-launcher-closure.test.mjs`,
which now runs 11 tests. `docs/canonical-json-census.json` needs no refresh:
the new `apps/vestra-cli/src/release-layout.ts` carries no canonicalization
signal, and `tests/security/canonical-json-census.test.mjs` passes unchanged.)

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

## TP-11: installed-bundle command resolution

Three run-time file references in the delegated CLI were written for the
repository layout only, so they landed nowhere in a sealed release. Nothing
caught them because no test had ever RUN a command from the staged layout -
`tests/build/sealed-launcher-closure.test.mjs` only asserted that `--help`
MENTIONS `doctor` and `self-test`.

| Defect                                                                                        | Sealed symptom                                                                                | Fix                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `doctor-composition.ts` loaded the schema registry from `../../../schemas/`                   | Two levels ABOVE the release root, so the registry was always null; verdict FAIL, exit 1      | `loadDoctorSchemaRegistry` tries the ordered candidates from `release-layout.ts`; sealed is `<releaseRoot>/components/schemas/`                             |
| `self-test-composition.ts` pointed `execFile` at `./self-test-full-crash-child.ts`            | esbuild emits no such file; the full profile died before its first durable boundary           | The builder bundles it as a second sealed `bin/` artifact (`self-test:full-crash-child`, `core-code`, portable) and `resolveDurableCrashChild` picks a layout |
| `self-test-{full,driver}-scenario.ts` spawned `./self-test-driver-fake.mjs`                   | Absent beside `bin/`, so every driver probe was unavailable and the full profile refused      | `resolveSelfTestDriverFake` names the already-sealed component `components/apps/vestra-cli/src/self-test-driver-fake.mjs`                                    |

The third was found only by executing the full profile; the first two were
reported. Resolution is ordered by the layout the process is actually in
(`isSealedRelease()`, the single guarded-constant test in
`release-manifest.ts`) and falls back to the other candidate, so a repository
checkout keeps its exact previous resolution and a sealed bundle cannot be
captured by an unrelated directory above its root.

Discrimination, each fix reverted in isolation with the rest of the change in
place:

| Reverted fix   | Observed failure                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| schema registry | `doctor from the staged layout reports the machine, not the packaging` — exit **1** (FAIL verdict), expected 4                 |
| crash child     | `self-test --profile full runs its sealed crash child from the staged layout` — exit **5**, non-PASS verdict, expected 0       |
| fake driver     | same test, exit **5**; direct child run names it: "found no available driver to attribute the implementation to"              |

The `self-test --profile smoke` test is a regression guard rather than a
discriminator: smoke spawns neither sibling, so it passes with or without the
fixes. It locks the sealed self-test path (PASS, 6 checks) against future
layout drift.

Recorded limitation, deliberately not worked around: `doctor` cannot reach PASS
in any layout. `doctor.native-asset` keys off
`resolveReleaseIdentity().releaseDigest`, which is protocol-`null` in BOTH
branches because the digest covers a manifest containing the launcher's own
content digest. BLOCKED with exit 4 is the honest ceiling; the test asserts
`doctor.native-asset:blocked` explicitly so the limitation cannot go stale
silently. See `spec.md` "Recorded limitation (TP-11)".

Test-adequacy note: the invoking project for the command tests is created under
the repository's own scratch directory, not `os.tmpdir()`. The staged release
root is in `os.tmpdir()`, and the Self-Test overlap rule reads a shared
temp-root ancestor between the guarded cwd and the disposable root as an
overlap and BLOCKS the run (issue #370, a pre-existing latent defect being
fixed separately). `tests/e2e/self-test-cli-e2e.test.mjs` avoids the same trap
the same way.

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
