---
schema: verchestra-feature-handoff/v1
feature: deep-doctor-live-probes
issue: 207
status: verification
branch: feat/deep-doctor-live-probes
baseRevision: 0d7ad9a2bad3b29c4defb4338d1106e4fe22c6e1
lastCompletedTask: T21
nextTask: T22 — pending human trigger of the T75 platform-matrix workflow (see tasks.md's T22 note); not blocking merge
lastGate: pnpm gate:full PASS (T1-T21, every gate this session could run)
updatedAt: 2026-08-22T00:00:00Z
---

# Scope

Issue #207: upgrade the seven presence-only deep-doctor checks to genuine
read-only observations. Requirements DDL-01 through DDL-14 in `spec.md`; 22
tasks in six phases in `tasks.md`. Parent #13 (T72); lands with or before #16
(T75), which is the current serial task.

T1 through T21 are complete and gated on branch. Phases 2, 3, 4, and 5 fully done; Phase 6 done except T22, which needs a human-triggered T75 CI run this session cannot execute. T15 remains deferred (AD-023). The feature is merge-ready as-is. `feat/deep-doctor-live-probes`.

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

- **T10** — `packages/platform-node/src/readonly.ts` gains
  `secretPresence(adapter, workspaceId, logicalName)`: calls
  `SecretAdapter.has` directly, since the broker exposes no read-only
  presence method of its own (only `bind` and `withSecret`). Also
  re-exports `type SecretAdapter`. `tests/security/secret-presence.test.mjs`
  (new, 5 cases): presence true/false, the return type is a boolean and never
  contains the secret's bytes, and two negative-behavior tests — `bind` is
  never called and `read` is never called. `tests/architecture/platform-node-readonly-subpath.test.mjs`
  extended: the export-surface extraction now also recognizes
  `export (async) function` declarations and `export type { ... }` (both
  needed once `readonly.ts` contained more than plain re-exports), and the
  approved-symbol list grew from 3 to 5 entries.

  **Found and fixed by its own discrimination sensor**: the first "never
  binds" test spied on one fixture-owned broker instance's `bind` method. A
  mutation making `secretPresence` construct and bind through its own
  internal broker instance was caught by the architecture guard (a new class
  name became reachable) but the security test's own spy missed it entirely
  — it only intercepts calls through the specific instance it wraps. Fixed by
  spying on `SecretBroker.prototype.bind` instead, which intercepts any
  instance; the same mutation now fails both. Discrimination proven via a
  content swap and restore (not `git checkout`, which would have reverted to
  T8's committed state and silently discarded T10's own additions since they
  were still uncommitted at the time).

  Gates: `pnpm gate:security` cannot complete on this machine — it stops at
  the same pre-existing, unrelated `test:qualification` failure recorded in
  T6 (two spike tests pinned to a locally-installed Claude Code/Codex CLI
  version). Ran `pnpm test:security` directly: 1049/1049, zero failed,
  skipped, or todo.

- **T11** — `tests/architecture/doctor-readonly-graph.test.mjs` gained a
  fifth test: a genuine static resolver walks `doctor-composition.ts`'s full
  transitive import closure (relative paths and `@verchestra/*`
  package-exports-mapped paths, resolved via each package's own
  `package.json`, never executed) and asserts no import edge anywhere in the
  closure names a forbidden package root
  (`@verchestra/drivers`/`connectors`/`data-probe`, or the bare
  `@verchestra/platform-node`/`@verchestra/policy` roots — only their
  `/readonly` subpaths are permitted). The real closure resolves to 67 files.
  The check operates on import specifier strings, not raw file text —
  deliberately, since a text scan for class names across 67 files raises,
  not lowers, the odds of the same prose false-positive T8 and T9 hit on
  their own single files. The four pre-existing tests are unchanged.

  Discrimination proven three ways in a disposable copy: (1) a forbidden
  import two hops from the entry file (`doctor-facts.ts` importing
  `@verchestra/drivers`) is caught by the new test and invisible to all four
  existing ones — the property this task exists to add, concretely
  demonstrated, not just claimed; (2) an entry-file import of the *allowed*
  `@verchestra/platform-node/readonly` subpath passes; (3) an entry-file
  import of the *forbidden* bare `@verchestra/platform-node` root fails both
  the new test and the existing allowlist test. Gates: `pnpm test:architecture`
  38/38, `pnpm test:security` 1049/1049 (gate:security itself blocked by the
  same pre-existing environment issue as T10), `pnpm gate:quick` PASS.

  **Phase 3 (read-only surfaces and the transitive guard) is complete —
  T8 through T11.**

- **T12** — `apps/vestra-cli/src/doctor-composition.ts`'s `doctor.sandbox`
  check is now live: `sandboxProbe(metadataRoot)` constructs a real
  `ProtectedPathBroker` (imported from `@verchestra/platform-node/readonly`)
  and calls `evaluateSandboxEscape` — a small, independently testable pure
  mapping function accepting a narrow `EscapeCheckBroker` interface, not the
  concrete class — which attempts `openExisting({ rootId: "sandbox",
  logicalPath: "escape/runtime.db" })`. Refusal with
  `VES_PATH_OUTSIDE_ROOT` maps to `pass`; a permitted open (no error) or any
  other error maps to `fail`, never a silent pass; broker construction
  failing (root absent) maps to `blocked`.

  **Two findings, both resolved and recorded in tasks.md's T12 note:**
  (1) `scripts/provision-doctor-fixtures.mjs` extended with a genuine escape
  fixture (approved by the user before implementing) — `LogicalPath.parse`
  already rejects `../`, so a symlink/junction escape is the only way the
  refusal is ever reachable on a real machine, and T5's provisioner
  previously created only a bare empty `sandbox/` directory. (2) A real
  regression caught by `gate:full`: wiring the readonly subpath in broke 12
  e2e tests via a PID-bearing `node:sqlite` experimental warning leaking
  into unrelated CLI commands' stderr, since `readonly.ts` eagerly re-exported
  `inspectRuntimeDatabase` from a file with a top-level `node:sqlite` import.
  Fixed by making that re-export a deferred async wrapper (dynamic import,
  loaded only on first call); extended T11's closure walker to recognize
  dynamic import edges so its guarantee doesn't quietly weaken.

  `tests/integration/doctor-sandbox-probe.test.mjs` (new, 5 cases): the pure
  mapping against fixture-double brokers (refuse/permit/unrelated-error),
  plus the real wiring end to end through `runDoctorDeep` against a real
  provisioned and a real unprovisioned control root. Discrimination proven
  on both the mapping logic (flipping the permit/refuse branches) and the
  closure walker (a forbidden import two hops deep). Gates: `pnpm gate:full`
  PASS, including `test:e2e` 165/165 restored after the fix.

  **T13 will very likely hit the same fixture-content problem T12 did**:
  T5's `runtime.db` is currently an empty placeholder file, not a valid
  SQLite database, so `inspectRuntimeDatabase`'s integrity check can never
  genuinely pass against it. Flagging now, before T13 starts, rather than
  re-discovering it mid-task.

- **T13** — `apps/vestra-cli/src/doctor-composition.ts`'s
  `doctor.sqlite-durable-state` check is now live: `sqliteDurableStateProbe`
  checks file existence first (absent -> `blocked`, unchanged from before),
  then delegates to `evaluateRuntimeDatabase(inspect)` — a pure mapping
  function accepting the inspect call as a parameter, mirroring T12's
  `evaluateSandboxEscape` design — which calls the real
  `inspectRuntimeDatabase` (from `@verchestra/platform-node/readonly`, T13's
  wiring). Any thrown error, corrupt integrity included, degrades to `fail`.

  **The fixture problem flagged after T12 hit exactly as predicted.**
  `runtime.db` was an empty placeholder; fixed by opening and closing a real
  `RuntimeStore` in `scripts/provision-doctor-fixtures.mjs` so the fixture
  carries the product's actual migrated schema (confirmed:
  `{integrity:"ok", runs:0, migrations:10}`), not hand-rolled SQL.

  **One more finding, this time about the spec's own edge case.**
  Empirically verified a real exclusive writer lock does **not** block a
  WAL-mode read-only open — correct SQLite behavior, but it means "a locked
  database reports fail" cannot be reproduced as a literal lock scenario at
  all. Tested honestly instead: `evaluateRuntimeDatabase` is proven to
  degrade *any* injected error (a lock-shaped one included) to `fail`, never
  a crash or silent pass, rather than silently narrowing the edge case's
  wording to only what happened to be reproducible.

  A third false-positive guard trip, same class as T8/T9/T12: a doc comment
  read `distinguish "corrupt" from "locked"`, tripping the `from "..."`
  regex the closure walker uses. Reworded.

  `tests/integration/doctor-sqlite-probe.test.mjs` (new, 6 cases): the pure
  mapping against injected success/corrupt/lock-shaped outcomes, plus the
  real wiring end to end through `runDoctorDeep` against real provisioned,
  corrupted, and unprovisioned control roots. Discrimination proven by
  flipping the catch branch's mapping — both the unit-level and end-to-end
  tests catch it. Gates: `pnpm gate:full` PASS, `test:e2e` unaffected (no
  repeat of T12's SQLite-warning regression, since `readonly.ts`'s deferred
  wrapper from T12 already contains this exact import).

  **T14 will need `@verchestra/policy` added to `apps/vestra-cli`'s
  dependencies** — deferred from T9 for exactly this task, since T9 itself
  had no consumer yet.

- **T22 — pending human trigger, not implemented (2026-08-22).**
  `platform-matrix.yml` is `workflow_dispatch`-only, runs the real
  multi-platform fleet on GitHub Actions, and lands reviewed evidence under
  `.specs/features/platform-qualification-matrix/fleet/`. Stopped and asked
  rather than attempting a local simulation that couldn't satisfy "each
  leg" (plural platforms) or produce genuine CI evidence. Decided: leave
  T22 as the next exact action; you dispatch the workflow yourself
  (`gh workflow run platform-matrix.yml --ref feat/deep-doctor-live-probes`
  or the Actions UI) against this branch's revision when ready, and a
  future session can review the resulting evidence and close T22. **T1
  through T21 are complete and merge-ready independent of T22** — every
  gate this session could run has passed.

- **T21** — `tests/integration/doctor-source-mode.test.mjs` (new, 3 cases)
  proves that in a genuinely unprovisioned checkout, all seven upgraded
  checks report `blocked`, never `fail` — including `secret-presence`,
  whose unchanged file-presence check was confirmed (not assumed) to still
  degrade correctly given T15's deferral. Also confirms the five untouched
  checks are still present and the catalog stays exactly twelve, and the
  sealed report from a bare checkout still carries no path. Discrimination
  proven with a mutation making `sandboxProbe` report `fail` instead of
  `blocked` when unprovisioned — caught by the exact intended test. Gate:
  `pnpm gate:full` PASS.

- **T20** — `tests/security/doctor-report-nonleak.test.mjs` (new, 3 cases)
  proves the sealed report leaks nothing from the now fully-live T12-T19
  probes — not merely that the rule engine enforces this in theory
  (already true since T72), but that it holds end to end against real
  fixtures: a real symlink escape, a real SQLite database, a real
  Ed25519-signed bundle, real availability records. Test 1 asserts the real
  payload's fields and values are exactly the closed allowlist
  (`DOCTOR_REPORT_FIELDS`, `DOCTOR_CHECK_IDS`×status, `DOCTOR_REMEDIATION_CODES`,
  `DOCTOR_CAPABILITY_IDS`). Test 2 asserts the serialized payload+artifact
  carry no path/SQLite-header/Cedar-policy-text/private-key pattern. Test 3
  proves at the unit level that a probe returning extra fields cannot leak
  them, since `observeToFact` reads only `.present`/`.healthy`.

  **Three discrimination rounds, not one**, because the first two mutations
  correctly did not fail: (1) a real T12-T19 probe mutated via a type-cast
  to return extra fields — no leak, confirming the structural guarantee
  against a real probe, not only synthetic ones; (2) the same probe mutated
  to genuinely throw a path-laden error — no leak, confirming
  `collectDoctorFacts`'s existing discard behavior holds for a real probe
  too; (3) a positive control — injecting a known-bad value directly into a
  real sealed payload and confirming the same assertion style catches it,
  proving rounds 1 and 2 passed because the leak didn't occur, not because
  the assertions can't fail. Both source mutations were applied and
  reverted in place; `git status` confirmed clean before and after.

  Gates: `pnpm gate:full` PASS; `test:security` 1052/1052 direct
  (`gate:security` blocked by the same pre-existing environment issue as
  T10).

- **T19** — `doctor.probe` reuses T17's `availabilityProbe` unmodified; wrote
  the wiring-isolation test *first* this time, applying T18's lesson
  immediately. Confirmed by mutation: wiring `doctor.probe` to read
  connector's fixture is caught directly, not by incidental overlap with a
  differently-purposed test. `tests/integration/doctor-probe-availability.test.mjs`
  (new, 4 cases). Gate: `pnpm gate:full` PASS.

  **Phase 5 (availability records) is complete — T16 through T19.**

- **T18** — `doctor.connector` reuses T17's `availabilityProbe` unmodified;
  one-line wiring change, no new probe logic, no provisioner change.

  **A test-isolation gap found before it mattered**: the first mutation
  sensor (wiring `doctor.connector` to read driver's fixture) was only
  caught by the "wrong subsystem declared" test, coincidentally, since that
  test's tampering happened to target connector's own fixture path — the
  "valid record reports pass" test didn't discriminate the mutation at all,
  since driver's real fixture is also independently valid for its own
  subsystem. Added a test that deletes only driver's fixture and confirms
  connector's outcome is unaffected, isolating the wiring itself. Re-ran:
  now caught directly.

  `tests/integration/doctor-connector-availability.test.mjs` (new, 4
  cases): pass, the isolation test, blocked-absent, fail-mismatch. Gate:
  `pnpm gate:full` PASS.

- **T17** — the `doctor.driver` check is live: `availabilityProbe(metadataRoot, subsystem)`
  reads `.verchestra/drivers/availability.json`, parses it via
  `parseSubsystemAvailability` (T16), and maps: absent -> `blocked`;
  unparseable -> `fail`; wrong subsystem declared (edge case 4) -> `fail`;
  valid + matching + `available: true` -> `pass`; valid + matching +
  `available: false` -> `blocked`. The last mapping is a genuine
  interpretive choice AC13's text didn't literally cover — resolved by
  extending `observeToFact`'s existing absent/present-but-wrong distinction
  (a correctly-declared "not installed" reads as not-yet-provisioned, not
  broken), documented inline and proven distinct from the other two failure
  modes by two separate discrimination mutations. This shared function is
  what T18/T19 reuse unmodified.

  `scripts/provision-doctor-fixtures.mjs` gained a generic loop writing
  `availability.json` for all three subsystems in one pass — T18/T19 need no
  further provisioner work. `tests/integration/doctor-availability-probes.test.mjs`
  (new, 5 cases) covers pass/blocked-absent/blocked-unavailable/fail-unparseable/fail-mismatch.
  A fourth false-positive guard trip (same class as T8/T9/T12/T13): the
  probe's own comment named the three forbidden packages literally.
  Reworded. Gate: `pnpm gate:full` PASS.

- **T16** — the availability-record contract. `schemas/subsystem-availability/1.schema.json`
  (new, minimal by construction: `{schemaVersion, subsystem, available}`, no
  field capable of expressing a network endpoint or credential);
  `packages/contracts/src/generated.ts` regenerated additively (6 lines, one
  new interface, confirmed nothing else changed). `packages/domain/src/workspace-layout/subsystem-availability.ts`
  is the hand-written structural reader `parseSubsystemAvailability(value)`
  domain probes call directly (domain takes no third-party import, so it
  cannot use the ajv-backed `SchemaRegistry`). `tests/unit/subsystem-availability.test.mjs`
  (8 cases) and `tests/contract/schema-registry.test.mjs` (extended) cover
  it. Discrimination proven on the reader's field-whitelist check.
  Gate: `pnpm gate:quick` PASS.

- **T15 — deferred, not implemented (2026-08-22).** `secretPresence` (T10)
  needs a real `SecretAdapter`; `QualifiedOsSecretAdapter` requires a real
  `OsSecretBackend` (Windows CNG / Apple Keychain / Linux Secret Service),
  and none of the three has any implementation anywhere in the repository —
  confirmed by searching for any construction of `QualifiedOsSecretAdapter`
  or a concrete backend outside `secret-broker.ts`'s own interface
  declaration. This is native per-platform credential-store integration,
  categorically bigger than every other gap this feature closed (T12/T13/T14
  each reused an already-established product convention; this would invent
  one, with no other consumer to validate the design against). Stopped and
  asked; decided to defer rather than build speculatively or substitute
  `MockSecretAdapter` (which would satisfy DDL-09's letter while defeating
  its purpose — it starts empty on every real machine, so the check could
  never report `pass` in the field). Full rationale in tasks.md's T15 entry
  and `.specs/STATE.md`'s AD-023. `doctor.secret-presence` keeps its current
  file-presence check, unchanged. `spec.md`'s success criteria updated to
  state six-of-seven, not seven-of-seven, with the reason recorded inline.

- **T14** — `apps/vestra-cli/src/doctor-composition.ts`'s
  `doctor.cedar-policy` check is now live: `cedarPolicyProbe(metadataRoot)`
  reads `.verchestra/policy/active.bundle` read-only, `JSON.parse`s it, and
  calls `verifyPolicyBundle` (from `@verchestra/policy/readonly`) with
  `cedarPolicyReadOnlyCrypto()` — a real Ed25519 verifier implementing
  `sha256`/`verify` for real, with `sign` throwing unconditionally.

  **Largest decision point in this feature — full detail in tasks.md's T14
  note, summarized:**
  1. `PolicyBundleCrypto` had zero production implementations anywhere;
     stopped and asked rather than inventing a security scheme. Decided:
     real Ed25519 via `node:crypto`, matching the encoding
     `artifact-sealer.ts` already uses (spki-der, base64url) — applying an
     existing convention, not a new one.
  2. `apps/vestra-cli/package.json` gained `@verchestra/policy` (deferred
     from T9); `pnpm install` updated `pnpm-lock.yaml` by exactly 3 lines
     (confirmed pure workspace-symlink addition).
  3. `scripts/provision-doctor-fixtures.mjs` mints a fresh Ed25519 keypair
     each run and builds a real signed bundle via `buildPolicyBundle` — a
     fixture-only key, not a trust root anything else relies on.
  4. Scope resolved from spec.md's literal AC7/AC8, not design.md's looser
     "observe a stable policy-view digest" prose — that phrasing implied a
     Bundle-to-View mapping that does not exist and would have meant
     inventing one; already satisfied by `verifyPolicyBundle`'s own digest
     check.
  5. **Its own discrimination sensor found a real coverage gap**: the first
     tamper test changed content without re-signing, caught by
     `verifyPolicyBundle`'s digest check before the signature step was ever
     reached — a mutated `verify() => true` survived all 5 original tests.
     Added a signature-only-corruption test; the mutation is now caught.
  6. A test I wrote assuming "signed by a different key is rejected" failed
     — not a bug, `verifyPolicyBundle` has no trust-root pinning at all, it
     only proves internal self-consistency. Removed the test rather than
     leave a misleading name.

  `tests/integration/doctor-cedar-policy-probe.test.mjs` (new, 6 cases):
  pass/tampered/signature-corrupted/truncated/blocked, plus digest-never-leaks.
  Gates: `pnpm gate:full` PASS; `test:security` 1049/1049 direct (blocked by
  the same pre-existing environment issue as T10); `test:integration` 611/611.

  Commit hashes are recorded as each subsequent task lands; T1 is the second
  commit on the branch, after the planning commit.

# Next Exact Action

No local next action remains. T22 (T75 fleet evidence) needs a
human-triggered CI run — see tasks.md's T22 note and this file's Decisions
section for the exact dispatch command. Once that run completes, a future
session can review its evidence and close T22; nothing about T1-T21 needs
revisiting first.

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
