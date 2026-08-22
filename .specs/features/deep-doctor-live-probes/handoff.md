---
schema: verchestra-feature-handoff/v1
feature: deep-doctor-live-probes
issue: 207
status: in_progress
branch: feat/deep-doctor-live-probes
baseRevision: 0d7ad9a2bad3b29c4defb4338d1106e4fe22c6e1
lastCompletedTask: T9
nextTask: T10
lastGate: pnpm gate:quick PASS (56/56 policy-related tests: security/cedar-policy, unit/policy-view-digest, architecture/policy-readonly-subpath)
updatedAt: 2026-08-22T00:00:00Z
---

# Scope

Issue #207: upgrade the seven presence-only deep-doctor checks to genuine
read-only observations. Requirements DDL-01 through DDL-14 in `spec.md`; 22
tasks in six phases in `tasks.md`. Parent #13 (T72); lands with or before #16
(T75), which is the current serial task.

T1 through T9 are implemented and gated on branch (Phase 2 complete; Phase 3 in progress) `feat/deep-doctor-live-probes`.

# Completed Evidence

- **T1** — `packages/domain/src/workspace-layout/subsystem-layout.ts` exports
  `WORKSPACE_ROOT_DIRNAME` (`.verchestra`) and `SUBSYSTEM_OBSERVATION_PATHS`,
  a frozen record naming the seven subsystem paths, with zero imports; exported
  from `packages/domain/src/index.ts`. Assertions in
  `tests/unit/subsystem-layout.test.mjs`: `:15` root dirname equals
  `.verchestra`; `:19` the record deep-equals exactly the seven expected
  subsystem/path pairs; `:31` the catalog is closed at seven; `:35,:36,:40`
  the record is frozen and a write throws without changing the value; `:48-52`
  every value is relative, POSIX-separated, and free of empty, `.`, `..`, or
  drive-qualified segments. Gate: `pnpm gate:quick` PASS; `pnpm test:unit`
  2064/2064 with zero failed, skipped, or todo (5 added, 2059 baseline
  preserved).

- **T2** (`f3482a2` is T1; T2 is the commit that follows it) —
  `packages/workspace/src/init/safe-init.ts` now imports
  `WORKSPACE_ROOT_DIRNAME` from `@verchestra/domain` and re-exports it, so
  `packages/workspace/src/index.ts:40` and the three internal `join` sites are
  unchanged and no call site changed behavior. The drift guard
  `tests/architecture/doctor-workspace-root.test.mjs` was rewritten (see
  Decisions): `:32` pins the doctor's literal to the contract's literal, `:41`
  asserts safe-init declares no competing `const WORKSPACE_ROOT_DIRNAME = "`,
  `:47` asserts it imports the value from `@verchestra/domain`. Discrimination
  proven in a disposable copy: reverting the doctor to `.vestra` fails the
  guard, and reintroducing a literal in safe-init fails it; both restored and
  the copy discarded. Gates: `pnpm gate:quick` PASS, `pnpm test:architecture`
  26/26, `tests/integration/safe-init.test.mjs` 22/22 — all with zero failed,
  skipped, or todo.

- **T3** — `apps/vestra-cli/src/doctor-composition.ts` imports
  `SUBSYSTEM_OBSERVATION_PATHS` and `WORKSPACE_ROOT_DIRNAME` from
  `@verchestra/domain` in place of the local literal and the seven inline
  `join(...)` expressions; a new `subsystemPath(metadataRoot, subsystem)`
  helper looks up each path. `@verchestra/domain` added to `READ_ONLY_IMPORTS`
  in `tests/architecture/doctor-readonly-graph.test.mjs:29`, justified in its
  comment (domain takes no third-party or `node:` import, so nothing reachable
  through it can be a writer). The drift guard was rewritten a second time —
  removing the doctor's literal broke the same `constDeclaration` extraction
  T2 had already worked around on the safe-init side; both files are now
  proven to import the root rather than declare it
  (`tests/architecture/doctor-workspace-root.test.mjs:31-39`). Discrimination
  proven in a disposable copy: a reintroduced literal in the doctor, and an
  import of the root from a non-domain module, both fail the guard; restored
  and the copy discarded. Gates: `pnpm gate:quick` PASS, `pnpm test:architecture`
  26/26, zero failed, skipped, or todo.

- **T4** — `tests/architecture/doctor-workspace-root.test.mjs` gained a static
  ownership proof: every `fileProbe(...)` call site in
  `apps/vestra-cli/src/doctor-composition.ts` must route through
  `subsystemPath(metadataRoot, "<key>")` with a key the layout contract
  declares, checked by regex over source text (`ROUTED_CALL_SITE` /
  `ANY_FILE_PROBE_CALL_SITE`, comparing counts so a bypassing call cannot hide
  among routed ones). Discrimination proven in a disposable copy: a hand-rolled
  `join(...)` bypassing `subsystemPath`, and a reference to a subsystem key the
  contract does not declare, both fail the guard; restored and the copy
  discarded. Gates: `pnpm gate:quick` PASS, `pnpm test:architecture` 27/27,
  zero failed, skipped, or todo.

  **T4 was split from its original scope — see Decisions.** Only ownership
  (AC1) is proven here; provisioning (AC2) moves to T5.

- **T5** — `scripts/provision-doctor-fixtures.mjs` (new): a qualification-only
  provisioner, not wired into `vestra init` or any user command, that
  materializes the layout contract's seven paths under `<controlRoot>/.verchestra/`
  by generic iteration over `SUBSYSTEM_OBSERVATION_PATHS`
  (`Object.entries(...)`), never a hand-listed per-subsystem case. A path
  whose final segment carries a `.` is provisioned as an empty file
  (`policy/active.bundle`, `runtime.db`); every other path as a directory
  (`secrets`, `drivers`, `connectors`, `probe/fixtures`, `sandbox`). Exports
  `provisionDoctorFixtures(controlRoot)` for direct import; a CLI guard
  (`process.argv[1]` matched against `import.meta.url`) drives the standalone
  invocation. `tests/integration/provision-doctor-fixtures.test.mjs` (5 cases)
  covers the provisioned set, no-extra-files, file-vs-directory shape, and
  idempotency. `tests/architecture/doctor-workspace-root.test.mjs` gained
  T4's deferred provisioning assertion: the provisioner must import the
  contract and iterate it generically, proven by two mutations in a
  disposable copy — a hand-listed partial subsystem set (dropping `sandbox`),
  and the contract import dropped entirely — both killed. Gates: `pnpm gate:full`
  PASS; `test:architecture` 29/29, `test:integration` 590/590, zero failed,
  skipped, or todo.

- **T6** — `packages/application/src/doctor/doctor-facts.ts`:
  `DoctorSubsystemProbe` widened to `() => DoctorObservation | Promise<DoctorObservation>`;
  `collectDoctorFacts` is now `async`, iterating `DOCTOR_CHECK_IDS` with a
  sequential `for...of` and `await` (never `Promise.all`) so the sentinel
  bracket around it stays a well-defined serial interval. A new
  `withTimeout` helper bounds any async probe to `DOCTOR_PROBE_TIMEOUT_MS`
  (5000ms, exported), skipping timer creation entirely for a synchronous
  observation (a real simplification: a plain value cannot hang). A rejected
  or timed-out probe degrades to present-and-unhealthy with no error text,
  matching the existing thrown-error path exactly.

  **Ripple beyond T6's stated scope, all necessary and behavior-preserving —
  see the scope note on T6 in tasks.md for full detail:**
  - `apps/vestra-cli/src/doctor-composition.ts:67` gained the minimal `await`
    needed to keep the build compiling (T7 still owns the full
    sentinel-bracket behavioral proof).
  - `tests/unit/doctor-facts.test.mjs`'s 8 pre-existing tests now `await`;
    3 new tests added (rejection, timeout via `mock.timers` with a
    microtask-polling technique since this Node version has no
    `tickAsync`, and sequential-not-concurrent ordering) — 11 total.
  - `tests/public-regression/corpus.mjs`'s T73-frozen `doctor-facts-complete`
    campaign check and its `runCampaign` runner are now async; verified the
    corpus digest is unaffected (`canonicalizeCorpus` serializes only `def`
    metadata, never `check` bodies — "the corpus digest is stable and
    change-sensitive" passes unchanged).
  - `tests/public-regression/campaigns.test.mjs` and
    `tests/system/regression-summary.test.mjs` updated to `await` the now-async
    `runCampaign`/`summarize`.

  Gates: `pnpm gate:quick` PASS, `pnpm gate:full` PASS, `pnpm gate:release`
  run separately (not covered by `gate:full`) to exercise `test:release` —
  passes; its two failures are pre-existing spike tests pinning a specific
  locally-installed Claude Code/Codex CLI version, confirmed identical on a
  clean tree via `git stash`, unrelated to this task.

- **T7** — `tests/integration/doctor-sentinel-bracket.test.mjs` (new, 3 cases)
  proves the property T6's compile-fix `await` only made possible: (1) a
  sentinel mutated by an async probe mid-collection fails the diagnostic with
  `VES_DOCTOR_SENTINEL_MUTATION`; (2) an unmutated sentinel across an async
  probe still produces a `PASS`-verdict sealed report; (3) an execution-order
  log proves `captureSentinels` runs exactly at the two boundaries with the
  async probe's work strictly between them, nothing before or after.
  Discrimination proven directly against the real
  `apps/vestra-cli/src/doctor-composition.ts` (mutate in place, run, restore
  via `git checkout`, since the file's transitive import graph — application,
  contracts, evidence, domain, release-manifest — made a scratch-copy sensor
  unreliable): moving `collectDoctorFacts` outside the bracket (before the
  first capture) kills exactly the two tests that depend on bracket ordering
  and leaves the unrelated PASS-path test passing, confirming the sensor
  discriminates precisely, not just noisily. Gates: `pnpm gate:full` PASS;
  `test:integration` 593/593, zero failed, skipped, or todo.

  **Phase 2 (async probe port) is complete — T6 and T7.**

- **T8** — `packages/platform-node/src/readonly.ts` (new): a narrow subpath
  exporting only `inspectRuntimeDatabase` and `ProtectedPathBroker` (named
  re-exports, never a wildcard). `package.json` gains the `./readonly` exports
  entry; resolution confirmed from `apps/vestra-cli` (the real consumer, via
  its workspace symlink) at runtime. `tests/architecture/platform-node-readonly-subpath.test.mjs`
  (new, 4 cases) statically proves: no wildcard re-export, the export surface
  is exactly the two approved symbols, no writer-adapter class name is
  reachable through it, and the package manifest declares the subpath.
  Discrimination proven directly against the real file (no committed baseline
  to `git checkout` back to, since it's new — restored by rewriting the
  correct content): adding `RuntimeStore` to the re-export list, and switching
  to a wildcard re-export, both fail 2 of 4 tests. Two false-positive guard
  trips fixed along the way by rewording the file's own header comment, which
  originally spelled out a forbidden class name and the literal text for a
  wildcard export in prose — the same convention
  `doctor-readonly-graph.test.mjs` already documents for exactly this reason.
  Gates: `pnpm gate:quick` PASS; `test:architecture` 33/33, zero failed,
  skipped, or todo.

- **T9** — `packages/policy/src/cedar-policy.ts`: extracted a pure
  `computePolicyViewDigest(view)` (try `digest(normalizedView(view))`, fall
  back to `digest({ invalidPolicyView: true })` on throw — the exact fallback
  `#compile` already performed), exported under the required public name via
  `export { computePolicyViewDigest as policyViewDigest }` to avoid a naming
  collision with `#compile`'s own local variable of the same name. `#compile`
  now calls it once up front instead of its previous fallback-then-reassign
  dance; every other reference in the method body is unchanged.
  `tests/unit/policy-view-digest.test.mjs` (new, 6 cases) pins byte-identity
  against the real adapter across three paths — a normal authorize, a
  validation-only failure, and a fallback path where normalization itself
  throws — plus determinism and content-sensitivity. `packages/policy/src/readonly.ts`
  (new) exports `policyViewDigest` and `verifyPolicyBundle`, wired as
  `@verchestra/policy/readonly`; `tests/architecture/policy-readonly-subpath.test.mjs`
  (new, 4 cases) proves no wildcard re-export, an exact export surface, no
  writer/engine-constructing symbol reachable, and the manifest declares the
  subpath. Discrimination proven against the real files: adding
  `buildPolicyBundle`, and a wildcard re-export, each fail 2 of 4 tests.
  `apps/vestra-cli` does not yet depend on `@verchestra/policy` — adding that
  dependency is deferred to T14. Gates: `pnpm gate:quick` PASS; 56/56 across
  the three policy test files, zero failed, skipped, or todo.

  Commit hashes are recorded as each subsequent task lands; T1 is the second
  commit on the branch, after the planning commit.

# Next Exact Action

T10: add a presence-only wrapper over `SecretAdapter.has` to
`packages/platform-node/src/readonly.ts`, returning a boolean and never a
secret value; a test must assert `bind` is never called (spy on the broker).
Then `pnpm gate:security`.

# Blockers

None. The Node/FTS5 environment blocker recorded earlier is resolved
(2026-08-22): `fnm` installed via Homebrew, Node 24.14.0 installed and pinned
as the fnm default, `/opt/homebrew/bin/{node,npm,npx,corepack}` re-pointed at
fnm's 24.14.0 binaries (needed in-session because this conversation's shell
replays a cached environment snapshot from before the fix; `~/.zprofile` was
also corrected so future sessions resolve it natively — see Decisions).
`pnpm install --frozen-lockfile` reinstalled clean under the pinned version;
`pnpm test:integration` 585/585 and `pnpm gate:full` PASS, both previously
blocked by `no such module: fts5`.

Two findings shape the plan and are already resolved as decisions:

- Every one of the seven probed leaf paths is referenced nowhere in the
  repository except `apps/vestra-cli/src/doctor-composition.ts:127-136`.
  `safe-init.ts` writes six files, none of them; `artifact-placement.ts`
  reserves seven directories, none of them; the only real runtime store is
  `runtime.sqlite` under a scenario root
  (`apps/vestra-cli/src/self-test-full-scenario.ts:343`). The root-level
  `.vestra` → `.verchestra` fix landed; the same drift persists one level down.
  Resolved by AD-019 (layout contract + T75 fixtures) and enforced by T4.
- `inspectRuntimeDatabase` now exists and is exported
  (`packages/platform-node/src/runtime-store/runtime-store.ts:472`), so one of
  the blockers named in the issue body is already resolved.

# Decisions

- **AD-019** — provisioning: one inward layout contract plus T75 qualification
  fixtures. No new user-facing surface; `vestra init` is not extended.
- **AD-020** — read-only guard: narrow read-only package subpaths plus a
  transitive closure guard, replacing the single-file textual scan.
- Probe port becomes async with sequential awaits inside the sentinel bracket;
  pre-computation outside the bracket is rejected because the issue's final
  acceptance criterion forbids it.
- "Available" for driver/connector/probe means a record exists, parses, and
  declares an installed subsystem. Reachability is excluded — it is neither
  read-only nor unpaid.
- **T4 split into ownership (T4) and provisioning (T5) (2026-08-22).** The
  original T4 bundled "a probed path absent from the contract fails the gate"
  (AC1) with "a contract path nothing provisions fails the gate" (AC2). AC2
  cannot be true until something provisions the paths — that is T5, and the
  original plan even had T5 depend on T4, which would have made the two
  circular the moment AC2 was attempted first. T4 now proves ownership only;
  T5 carries AC2 alongside the fixture provisioner it introduces. T5's
  dependency is corrected from `T1, T4` to `T1`.
- **Node environment fix (2026-08-22, outside repo scope but requested by the
  user).** The machine had Node v23.11.0 installed where the repo pins
  24.14.0; the version mismatch, not any feature code, caused all 51
  memory-store integration failures (missing FTS5 in that Node's bundled
  SQLite). Root cause of why a naive fix didn't stick: `~/.zprofile` runs
  `eval "$(brew shellenv)"`, which re-prepends `/opt/homebrew/bin` after
  `~/.zshenv` — so a version-manager PATH set up in `.zshenv` alone gets
  silently shadowed on every login shell. Fixed durably by moving the `fnm`
  activation to the end of `.zprofile` (after `brew shellenv`). Fixed for
  *this* conversation by re-pointing `/opt/homebrew/bin/{node,npm,npx,corepack}`
  directly at fnm's installed 24.14.0 binaries, since this session's shell
  replays a cached snapshot from before the dotfile fix and would not pick it
  up until a new session. Both changes are outside `.specs/` and the repo
  tree; recorded here only because they unblock every `full`-gated task.
- **Drift guard rewritten twice, in T2 and T3, not once in T4 (2026-08-22).**
  `tests/architecture/doctor-workspace-root.test.mjs` originally proved two
  source literals agreed. T2 removed safe-init's literal; T3 removed the
  doctor's. Each removal broke the guard's `constDeclaration` extraction on
  that file, so both tasks carry a guard rewrite instead of one clean
  hand-off to T4. The guard now proves both files import the root from the
  contract and declare no competing literal. T4 still extends it from "the
  root agrees" to full path ownership and provisioning.
- Secret presence uses `SecretAdapter.has`, never
  `SecretBrokerBindingInspector.isBound`, which calls `broker.bind()` and mints
  a handle.

# Files Intentionally Left Unchanged

- The five checks already observing live signals: `installation`,
  `contract-schema`, `native-asset`, `git`, `clock`.
- `packages/workspace/src/placement/artifact-placement.ts` — its reserved
  layout covers project artifact classes, a different concern.
- Remediation behavior: doctor names a remediation code and never repairs.
