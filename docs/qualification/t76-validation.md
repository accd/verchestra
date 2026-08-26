---
schema: verchestra-qualification-report/v1
task: T76
revision: a49f3dd5aa3e639db87f8715077446ec075600e9
gates: pnpm gate:quick, pnpm gate:full, pnpm gate:build, pnpm gate:security, pnpm gate:release
gateResults: pass, pass, pass, pass, pass
gateRevision: a49f3dd5aa3e639db87f8715077446ec075600e9
criteriaEvidence: 4 of 4 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 8 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/369
---

# T76 Verified Release Candidate and Publication Validation

## Scope and revision binding

This report validates the merged T76 release-publication surface at exact
revision `a49f3dd5aa3e639db87f8715077446ec075600e9`, which is reachable from
`origin/main` (`git merge-base --is-ancestor` confirmed). The candidate that
was signed, published, and activated was built at that revision and no other;
`gateRevision` names the same commit because the five gate profiles ran there.

T76 is the first task in the chain whose evidence is not exhausted by
deterministic tests. The publication reached a live endpoint, the release was
activated on two real hosts, and the package was published to the public npm
registry. Those steps are recorded below as live evidence with their run
identifiers and digests, separately from the deterministic gates, because they
are reproducible only by repeating the operator procedure, not by re-running a
suite.

**Authorship is stated plainly rather than claimed as independent.** The
publication script, the sealed-launcher closure, the workflow, and the fixes
listed under "Defects found by live verification" were authored by an agent
session operating as the repository owner's automation. The live operator
steps — provisioning storage custody, dispatching the publication workflow,
uploading the emitted tree, and `npm publish` under the owner's 2FA — were
performed with the owner's authorization on 2026-08-26. Human review and merge
authority were exercised by the owner (`accd`) on every pull request this
report cites. This report does not claim an independent verifier distinct from
the implementation author, because there was none; `reviewedIn` records where
the review actually happened, and the `Protect main` ruleset governs what
merged. Read the accountability from those, not from this file.

## Deterministic gates

Candidate build run **32927839487** built the five-target fleet at exactly
`a49f3dd5aa3e639db87f8715077446ec075600e9`. Each of the five target legs ran
all five gate profiles before sealing its target, so every profile below is
evidenced on every supported platform at the bound revision.

| Profile | Legs | Result |
| --- | --- | --- |
| `gate:quick` | 5 | pass |
| `gate:full` | 5 | pass |
| `gate:build` | 5 | pass |
| `gate:security` | 5 | pass |
| `gate:release` | 5 | pass |

25 profile executions, zero failures, zero skipped, zero todo. Targets:
`win32-x64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`.

Publication run **32929312169** consumed that sealed candidate and emitted the
signed publication: base URL
`https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/`, `metadata_version` 1,
expiry `2027-08-26T00:00:00.000Z`, with the rollback proof drawn from the prior
sealed candidate `af8bcf044cf8` (run 32916088873). The workflow's own
verification build consumed the single emitted `release-inputs/` directory,
which is what proves the emitted bytes are the launcher's real input rather
than a shape that merely resembles one.

## Acceptance criteria

The four criteria are quoted from `.specs/features/t76-tuf-publication/spec.md`.

| Criterion | Evidence |
| --- | --- |
| 1. A sealed five-target closure, a valid prior rollback index, and a valid base URL produce one signed TUF repository per target, exactly one `release-inputs/` directory, and one upload manifest naming every asset's digest and remote key | `tests/build/t76-release-publication.test.mjs` (18 tests) asserts the per-target signed repositories, the single shared `release-inputs/`, and that every `metadataBaseUrl`/`targetBaseUrl` pair and every asset `remoteKey` mirrors the emitted `publication/<targetKey>/{metadata,targets}/` tree byte for byte. Live: run 32929312169 emitted exactly that tree for all five targets, and its 990 manifest assets were uploaded against their declared remote keys. |
| 2. Any invalid base URL, closure, rollback, digest, or key input stops the run with the matching `VES_T76_PUBLISH_*` code before a publication byte is written, leaving no output directory behind | Same suite: the base-URL rejection set (non-HTTPS scheme, userinfo, query, fragment, missing trailing slash, `${` marker, over-long value) each asserts `VES_T76_PUBLISH_BASE_URL_INVALID` **and** that no output directory exists afterwards; rollback rejections assert `VES_T76_PUBLISH_ROLLBACK_INCOMPLETE` and `VES_T76_PUBLISH_CANDIDATE_INVALID`; malformed key shapes fail with no cause chain. Sensor mutations 5 and 6 confirm these assertions are load-bearing. |
| 3. The emitted `release-inputs/` directory is accepted unchanged by the launcher's `loadPinnedInputs` and by `build:vestra-launcher`, for every supported target key at once | Same suite round-trips the emitted bytes through the launcher's real `loadPinnedInputs` and `buildVestraLauncher` — the production loader, not a fixture — with a schemaVersion-2 source map naming all five target keys. `tests/security/vestra-launcher-package-security.test.mjs` (14 tests) holds the loader's fail-closed boundary; sensor mutation 8 confirms the exact-keys check is what rejects a non-conforming source. Live: the publication workflow's verification build consumed the single emitted directory. |
| 4. From a staged release layout with no repository sources and no dependency store, the real `NodeActivationHealthGate` returns activation health evidence for both canonical launchers, and the same sealed binaries execute ordinary CLI argument vectors reporting the compiled-in sealed semantic version | `tests/build/sealed-launcher-closure.test.mjs` (7 tests) drives the real `NodeActivationHealthGate` against a staged layout with no `src/` and no `node_modules/`, asserts the honest observation contents, and holds a red case proving the development shims fail the same gate. `tests/build/reproducible-target-build.test.mjs` (3 tests) binds the launcher digest to the deterministic closure bundle and refuses a dirty build tree. Live: both bins printed `Verchestra 0.0.0-qualification` after real activation on win32-x64 and linux-x64, and `--help` rendered the activated CLI's real command surface. |

## Spec-anchored adequacy matrix

| Requirement | Happy-path assertion | Failure-path assertion |
| --- | --- | --- |
| TP-01 | `tests/build/tuf-publication.test.mjs` (6) signed root, top-level targets, terminating component delegation, snapshot, timestamp, manifest and component targets | unsafe target paths refused before any publication directory exists |
| TP-02 | Same suite resolves the published bundle through `TufUpdateClient`, including a realistic bundle with nested and runtime component paths; consistent-snapshot and non-consistent-snapshot layouts agree | partial publication surfaces `VES_TUF_PARTIAL_PUBLISH` (sensor mutation 1) |
| TP-03 | `tests/security/tuf-publication-security.test.mjs` (3) threshold and expiry acceptance | missing/unattainable signers, invalid expiry, incomplete and duplicate bytes, byte-digest mismatch all fail closed before publication |
| TP-04 | — | Same suite mutates published target bytes and asserts TUF verification fails and no activation-allowed staged release is produced |
| TP-05 | Upload-manifest test proves each `metadataBaseUrl`/`targetBaseUrl` pair and every `remoteKey` mirrors the emitted tree | base-URL rejection set with no output directory created |
| TP-06 | Single `release-inputs/` round-trips through the real `loadPinnedInputs` and `buildVestraLauncher`; TUF-client staging of the win32-x64 and linux-arm64 published repositories with full component coverage | `apps/vestra-launcher` loader rejects any non-conforming source (`tests/security/vestra-launcher-package-security.test.mjs`) |
| TP-07 | Publication succeeds only with a sealed prior index covering every fleet key | rollback index missing a fleet key, re-serialized, sealing the published revision, or repeating the current release digest each rejected |
| TP-08 | CLI success run emits a summary containing no key material | malformed-key set, cause-free failure proof, and CLI failure run never echo key bytes; `tests/agent-readiness/t76-publish-workflow.test.mjs` (12) asserts exactly one secret name in exactly one step, `env:`-mediated |
| TP-09 | Workflow emits three fail-closed artifacts and builds the launcher from the single `release-inputs/` | ownership test forbids `github.repository`, storage CLI strings, and extra secrets; env-mediation test forbids run-block interpolation |
| TP-10 | `tests/build/sealed-launcher-closure.test.mjs` real health gate over the staged layout, honest observations, delegated `--version`/`--help`, byte-identical rebuilds, built-ins-only imports; `tests/build/reproducible-target-build.test.mjs` bundled-launcher digest and sealed closure sources | dev-shim red case; `VES_T76_BUILD_TREE_DIRTY` on a drifted build tree; win32 sealed-runtime naming (sensor mutations 2, 3, 4, 7) |

Reverse mapping: every assertion in the T76 suites is claimed by a requirement
above. No test is skipped, marked todo, or vacuous.

## Recorded limitation: how the four source modes are actually evidenced

TP-02 requires the TUF client to resolve the same bundle in online, mirror,
offline, and air-gapped source modes. What is proven **at this revision** is
narrower than a four-mode cross-adapter equivalence, and is stated exactly:

- **Offline, over the real emitted tree.** `tests/build/t76-release-publication.test.mjs`
  stages the actual publication output through
  `NodeFilesystemDistributionSource{ mode: "offline" }` for `win32-x64` and
  `linux-arm64`, asserting the staged `releaseDigest` and the full component
  logical-path set equal the sealed bundle's.
- **Online, live, over the same published tree.** The activation runs recorded
  below resolved that tree through `HttpsDistributionSource{ mode: "online" }`
  from the R2 endpoint, resolving the pinned release identity
  `release:verchestra:0.0.0-qualification:a49f3dd5aa3e` on Windows and on
  Linux.

Two honest qualifications, recorded rather than omitted:

1. The four-mode loops in `tests/build/tuf-publication.test.mjs` and
   `tests/build/materialized-tuf-publication.test.mjs` use the
   `MapDistributionSource` test double, whose `mode` is a **cosmetic
   constructor label**: the same in-memory maps answer every read regardless of
   the label, so those loops prove mode propagation, not adapter equivalence.
2. The four view descriptors built by `viewsFor()` in
   `scripts/t76-publish-release.mjs` are digest-bound into the release
   candidate, but they are **not observable in the emitted
   `publication-manifest.json`**, whose schema carries no `views` array.

A separate pull request landing in parallel ("PR A") emits the `views` array
into the manifest and adds a real cross-adapter equivalence test — HTTPS-online
against filesystem-offline over the same emitted tree. That is post-revision
hardening; it is deliberately **not** counted as evidence for
`a49f3dd5aa3e639db87f8715077446ec075600e9`.

## Discrimination sensors

Eight mutations were applied to the merged sources in a clean worktree at this
revision. Each was introduced, run against the smallest pinned suite, restored
with `git checkout --`, verified byte-identical with `git diff --quiet`, and
the suite re-run to green. Every one was killed.

| # | Defect introduced | Pinned suite | Killing assertion |
| --- | --- | --- | --- |
| 1 | Delegation paths reverted from the bundle-derived list to the four hardcoded globs `components/*`, `runtime/*`, `native/*`, `bin/*` | `tests/build/tuf-publication.test.mjs` | 4 of 6 tests fail, each `code: 'VES_TUF_PARTIAL_PUBLISH'`, including "a realistic bundle with nested and runtime component paths stages end to end" |
| 2 | `launcher:vestra` sealed from the development shim `apps/vestra-cli/bin/vestra.mjs` verbatim instead of the deterministic closure bundle | `tests/build/reproducible-target-build.test.mjs` | "the real target builder binds exact revision, host assets, and all supply-chain evidence" — `AssertionError [ERR_ASSERTION]` on launcher `contentDigest`: actual `sha256:22aeb384…`, expected `sha256:196a2df3…` (the bundled closure digest) |
| 3 | Win32 conditional removed, so the sealed runtime is always `runtime/node` | `tests/build/reproducible-target-build.test.mjs` | Same test — `actual: 'runtime/node'`, `expected: 'runtime/node.exe'`. Discriminating for real: the suite ran on a `win32` host, which is the platform whose process creation requires the extension |
| 4 | One check name (`driver`) omitted from the sealed launcher's activation health report | `tests/build/sealed-launcher-closure.test.mjs` | "both sealed launchers pass the real activation health gate from the staged layout" — `code: 'VES_LAUNCHER_HEALTH_REPORT_INVALID'`; "the health report carries only honest observations of the staged closure" also fails |
| 5 | Per-target rollback completeness weakened to "at least one prior proof" | `tests/build/t76-release-publication.test.mjs` | "refuses a rollback index that does not seal a prior release for every supported target" — expected `VES_T76_PUBLISH_ROLLBACK_INCOMPLETE`, actual `VES_T76_PUBLISH_CANDIDATE_INVALID` |
| 6 | Base-URL validator accepts `http:` alongside `https:` | `tests/build/t76-release-publication.test.mjs` | "refuses every invalid base URL before any output directory is created" — `Missing expected rejection: http://releases.example.invalid/verchestra/ must be refused`, expected `VES_T76_PUBLISH_BASE_URL_INVALID` |
| 7 | `--untracked-files=no` removed, restoring overbroad full-porcelain tree-dirty refusal | `tests/build/reproducible-target-build.test.mjs` | "the same exact inputs produce byte-identical target output" — `code: 'VES_T76_BUILD_TREE_DIRTY'` raised by a legitimate untracked byproduct |
| 8 | `hasExactKeys` weakened from exact-key equality to a subset check in the launcher's pinned-input loader | `tests/security/vestra-launcher-package-security.test.mjs` | "release configuration with missing, unknown, or malformed fields is refused" — `Missing expected rejection`, expected `VES_VESTRA_INPUTS_INVALID` (an extra key in the release source is silently accepted) |

**8 killed, 0 survived.** Mutations 2, 3 and 7 touch the same file and were
applied one at a time, each with its own restore-and-green cycle.

## Non-shallow checks

- The launcher round-trip runs the **production** `loadPinnedInputs` and
  `buildVestraLauncher`, not a reimplementation, so a loader that drifts from
  the emitted bytes fails rather than being mirrored by the test.
- The activation health evidence comes from the **real**
  `NodeActivationHealthGate` spawning the sealed binaries from a staged layout
  stripped of `src/` and `node_modules/`, and the suite holds a red case
  proving the previous dev-shim launchers fail that same gate. That red case
  exists because a live install failed exactly that way; the earlier synthetic
  launcher fixtures never executed the real bins.
- The reproducible-build suite operates on a sealed single-commit replica of
  the working tree (`tests/helpers/sealed-repository-fixture.mjs`), because the
  builder refuses a dirty tree — never by committing into a developer checkout.
- Fixtures use ephemeral in-process signing keys and `mkdtemp(tmpdir())` roots
  only. No repository secret, CI secret, credential, or machine-local path
  appears in any tracked file.

## Live evidence (operator-authorized, 2026-08-26)

Every item below is from an executed command, not a projection.

**Publication.** Endpoint: Cloudflare R2 bucket behind the managed public base
`https://pub-0fa3e4c3f26540e793952fa2c187d536.r2.dev/`. Candidate
`a49f3dd5aa3e639db87f8715077446ec075600e9` (run 32927839487), published by run
32929312169 with the rollback index from `af8bcf044cf8` (run 32916088873).

**Integrity.** All 990 manifest assets were sha256-verified locally before
upload. Each uploaded object's stored bytes were then proven by comparing the
store's returned content hash against the local hash: 101 changed or new
objects uploaded, 889 hash-named objects unchanged from the previous upload and
reused — which is precisely the consistent-snapshot property, not an untested
assumption.

**Endpoint conformance**, probed against the TUF client's own requirements:
metadata answers `200` with an exact `Content-Length` and **no**
`Content-Encoding` even when the client offers gzip; a ranged target request
answers `206` with an exact `Content-Range`; no redirects on any path.

**Live activation, win32-x64 (native Windows), from wiped managed state.**
Cold run 93 s end to end — TUF resolution, download, staging, both sealed
launchers through the real activation health gate, promotion, and verified
handoff. Warm run 5 s. Both `vestra` and `verchestra` print
`Verchestra 0.0.0-qualification`; `--help` renders the activated CLI's real
command surface.

**Live activation, linux-x64 (Docker `node:24`, `linux/amd64`).** Global
install of the packed tarball, cold run 2 m 27 s, warm run 5 s, both bins, same
help surface.

**Reproducibility.** The operator's Windows build is byte-identical to the CI
verification artifact at the same revision (`diff -r`, zero differences),
packed as `verchestra-0.0.0-qualification.tgz`, shasum
`c6a482d25b59ebae93c4094974b7de5b85ca467a`.

**Registry publication.** `verchestra@0.0.0-qualification` is published on the
public npm registry with dist-tag `latest`, same shasum
`c6a482d25b59ebae93c4094974b7de5b85ca467a`, published by the owner under 2FA on
2026-08-26.

**Clean-machine registry smoke.**
`docker run --rm --platform linux/amd64 node:24 npx -y verchestra --version`
completed with exit code 0 in 1 m 46 s, printing
`Verchestra 0.0.0-qualification (source build, no verified release artifact)`.
The parenthetical is the known cosmetic item recorded in the feature
validation: a sealed package's manifest `releaseDigest` is protocol-null, so
`--version` renders the source-build suffix. The rendering decision is
deliberately unchanged at this revision.

## Defects found by live verification and fixed

Live execution found four defects that no deterministic gate had caught,
because no gate had previously executed the real sealed artifacts:

- **Sealed dev-shim launchers and the missing `--activation-health` protocol**
  (#364). Earlier candidates staged a full release and then failed
  `VES_ACTIVATION_HEALTH_FAILED`, because the sealed `bin/*.mjs` imported
  `../src/main.ts`, which does not resolve in a staged layout. Fixed by
  bundling the tracked closure entries and implementing the health protocol.
- **Extensionless win32 runtime** (#365). Windows resolves image names through
  `PATHEXT`, so an extensionless `runtime/node` is `ENOENT` there.
- **Overbroad tree-dirty refusal** (#366). Full porcelain status refused
  legitimate untracked byproducts; only tracked drift may block a build.
- **Delegation segment-count mismatch** (#359, earlier). `tuf-js` matches
  delegation patterns segment by segment, so wildcard globs could never match
  the nested component paths a real candidate carries.

Supporting merged pull requests for this task: #359, #360, #361, #362, #364,
#365, #366, #367, together with the earlier candidate machinery.

## What is not claimed

- No independent verifier distinct from the implementation author. See the
  authorship statement above.
- A four-mode **cross-adapter** equivalence test is not evidence at this
  revision; see "Recorded limitation".
- Publication does not make Verchestra production-ready or 1.0. The version is
  `0.0.0-qualification`, and T77 — independent acceptance and the 1.0 decision
  — remains the next product task.

## Verdict

**PASS.** 4 of 4 acceptance criteria proven at
`a49f3dd5aa3e639db87f8715077446ec075600e9`: five gate profiles green on all
five targets in candidate run 32927839487; a signed five-target publication in
run 32929312169; 990 assets verified byte for byte at the endpoint; live
activation through the real health gate on two platforms; a byte-identical
reproducible package published to the public registry and re-verified from a
clean machine; 8 discrimination mutations killed with zero survivors; zero
skipped and zero todo.
