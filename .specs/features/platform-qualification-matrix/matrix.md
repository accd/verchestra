# T75 Qualification Matrix Specification

Issue #16's completion checklist requires publishing "the complete matrix and
signed evidence index". This document is the matrix half: for every dimension
issue #16 names, it records where the supported case set is **canonically
defined**, what is **actually exercised today**, and what is a **genuine gap**.
It is the prerequisite for the evidence index (section 8) and for the
independent `t75-validation.md` (task B3), because neither can enumerate what
was qualified until the case set is enumerated here.

Measured on `3f97047`. Nothing in this document is invented: every case set
cites the file that defines it, and every "not covered" claim cites what was
looked for.

**Status: specification only.** It changes no product behavior, resolves no
gap, and advances no qualification state. Sections 7 and 9 raise the decisions
and defects that must be settled before T75 can honestly close.

## 1. Scope

Issue #16 names ten matrices: platform, topology, Driver, native asset,
sandbox, database, injection, crash, recovery, installer, and Self-Test. The
**platform × security-gate** leg is complete and green (`5c86436`, run
31315589420) — see `handoff.md`. This document covers the rest.

Acceptance criteria under test:

| # | Criterion | Status against this document |
| - | --------- | ---------------------------- |
| 1 | Zero required platform or topology case is skipped | **Not yet true** — section 2 and section 6 |
| 2 | Zero unauthorized effect escapes policy or egress enforcement | Covered; section 5 |
| 3 | Reports bind platform, architecture, runtime, fixture, candidate, and evidence digests | **Not yet true** — no evidence index exists; section 8 |
| 4 | Every supported platform passes the release-candidate security gate | **True** at `5c86436` |

## 2. The cross-cutting finding: no single gate profile runs every stage

This governs every dimension below, so it comes first.
`scripts/gate-stages.mjs` defines five closed profiles. Mapping stage to
profile:

| Stage | quick | full | build | security | release |
| ----- | :---: | :--: | :---: | :------: | :-----: |
| `test:unit` | ● | ● | ● | ● | ● |
| `test:agent-readiness` | ● | | | | |
| `test:contract` | | ● | ● | ● | |
| `test:integration` | | ● | ● | | |
| `test:e2e` | | ● | ● | ● | |
| `test:architecture` | | | ● | ● | ● |
| `test:qualification` | | | ● | ● | ● |
| `test:security` | | | | ● | ● |
| `test:fault` | | ● | | ● | ● |
| `test:mutation` | | ● | | | |
| `test:release` | | | | | ● |

**`test:integration` is absent from `gate:security`** — the only profile ever
dispatched fleet-wide. `gate:release` additionally drops `test:contract`,
`test:integration`, and `test:e2e`.

Consequences, both load-bearing:

1. **The real-filesystem topology cases have never run on the fleet.**
   `tests/integration/workspace-scanner.test.mjs` (12 tests: monorepo, nested,
   ignored, placeholder, submodule, linked worktree, sparse checkout) is the
   sole real-git topology coverage and lives in `test:integration`. So T75
   acceptance criterion 1 — "zero required **topology** case is skipped" — is
   not currently satisfied on any platform but the single-platform CI runner.
   The F3 defect (`git-worktree-adapter` rejecting macOS `/var` and Windows
   8.3 path aliases) was caught only because `test:e2e` happened to reach the
   same adapter. That was luck, not coverage.

2. **Four dispatches are required for full stage coverage**, not one. The
   union `quick ∪ full ∪ security ∪ release` covers all sixteen stages;
   no smaller set does. To date only `quick` (plumbing proof, run
   31195616672) and `security` (runs 31315589420 / 31315939879) have been
   dispatched fleet-wide.

**Required action (no owner decision needed):** dispatch the fleet at the
qualification revision with `gate=full` and `gate=release` in addition to the
existing `security` evidence, and record all four run ids in the evidence
index. This is the cheapest gap on the list — it needs no code change.

### M-1 was executed, and it immediately found a platform defect (F5)

The first `gate=full` fleet dispatch (run 31320307931, bound `3264700`) went
**red on Windows x64 and macOS arm64 while both Linux legs passed**. Seven
tests fell over — every real process runner and real Git adapter case in
`tests/integration/gate-commit-adapters.test.mjs` — with
`VES_GATE_ADAPTER_PATH_ESCAPE`, "Worktree root resolves through a symbolic
path".

The cause is **the same defect F3 fixed one adapter over**:
`packages/platform-node/src/gate-commit-adapters.ts` `targetFromRef`
realpath'd the worktrees root and then rejected the result whenever it
differed from the input, which is every macOS `/var` → `/private/var` and
Windows `RUNNER~1` → `runneradmin` alias. Fixed by canonicalizing instead of
rejecting, with no escape guard changed (PR #231).

Two things follow, and both matter more than the fix itself:

1. **The prediction in this section was correct and the cost was real.** A
   stage that no fleet profile ran had been broken on two of five platforms
   for as long as it has existed, and single-platform CI could never see it.
2. **F3 was fixed as one adapter's bug when it was a repository-wide
   pattern.** Grepping the pattern now finds exactly three
   `relative(...) !== ""` comparisons left, and the two that remain
   (`gate-commit-adapters.ts:53`, `git-worktree-adapter.ts:270`) are the
   target-level checks F3 deliberately kept, which cannot fire on a benign
   alias once the parent chain is canonical. A `gate=release` dispatch of the
   same revision (run 31320314440) passed on all four reporting legs, which
   is consistent: `gate:release` also omits `test:integration`.

## 3. Topology matrix

**Canonical definition — fragmented, no single `topology` type.** Grep for
`topology|workspaceKind|monorepo` over `packages/workspace/` returns nothing.
The vocabulary lives in three unions:

| Set | Canonical location | Cases |
| --- | ------------------ | ----- |
| Git relation | `packages/application/src/artifacts/artifact-planning.ts:10` | `control`, `nested`, `submodule`, `worktree`, `placeholder` (5) |
| Workspace placement mode | `artifact-planning.ts:3` | `colocated`, `centralized`, `mixed`, `external-control` (4) |
| Project marker kind | `packages/workspace/src/scanner/scanner-primitives.ts:76-84` | node, python, go, rust, maven, gradle, dotnet, terraform (8) |

`packages/workspace/src/placement/artifact-placement.ts:55-56,69-71` keeps a
hand-maintained `new Set([...])` runtime copy of the same vocabulary with no
compile-time link to the type — a drift risk worth noting, not fixed here.

**Coverage.** `tests/unit/artifact-placement.test.mjs:47-79` covers all 4
placement modes × all 5 git relations as pure functions (runs everywhere).
`tests/integration/workspace-scanner.test.mjs` covers the 8 real-git
topologies — **but see section 2: it never runs on the fleet.**

**Gap:** the real-filesystem topology cases need a `gate=full` (or `build`)
fleet dispatch. No code change.

## 4. Driver matrix

**Canonical definition.** No `DriverId` union exists. The only closed 4-way
set is `packages/agent-runtime/src/context/backend-serializers.ts:4`
(`["pi", "claude-code", "codex", "opencode"]`), which is a *context
serialization target* set, not a driver registry.
`packages/application/src/bootstrap/machine-bootstrap.ts:51` treats
`driverId` as an open `string`.

| Driver | Qualified version | Pin location | Real probe? |
| ------ | ----------------- | ------------ | ----------- |
| Claude Code | `2.1.168` | `packages/drivers/src/claude-code-driver.ts:86`; CI install `platform-matrix.yml:190` | **Yes** — `spikes/claude-code-driver/test/claude-driver.test.mjs:16`, `--version` only |
| Codex | `0.115.0` | `codex-driver.ts:90`; same CI line | **Yes** — `spikes/codex-driver/test/codex-driver.test.mjs:13` |
| OpenCode | minimum `1.17.18`, installed `1.18.9` | `opencode-driver.ts:227`; root devDependency | **Yes** — `spikes/opencode-driver/test/opencode-driver.test.mjs:59` |
| Pi | `0.82.1` | `packages/drivers/src/pi-driver.ts:12` | **No** — `PI_VERSION` is a hardcoded constant returned verbatim by `probe()` (`pi-driver.ts:131-133`); nothing real is probed anywhere |

Every other driver test in the repository is fake-backed (`fake-claude.mjs`,
`fake-codex-app-server.mjs`, `fake-opencode.mjs`, `DeterministicMockDriver`,
`apps/vestra-cli/src/self-test-driver-fake.mjs`). That is correct design —
`spikes/AGENTS.md` forbids provider requirements in mandatory gates — but it
means the Driver matrix's real axis is exactly three `--version` probes.

**Version drift to record:** OpenCode's production default minimum
(`1.17.18`) is not the installed qualified version (`1.18.9`).

**Cross-driver matrix: does not exist.**
`tests/unit/verification-driver-isolation.test.mjs:142` is named
"cross-driver scenario" but uses two `DeterministicMockDriver` instances and
passes *string labels* (`"claude-code"`, `"codex"`) that are not bound to any
driver instance — the file's own comment at lines 152-155 says so. Live
wiring is task A4 (#35), which this matrix consumes.

**Gap:** (a) Pi has no real probe — decision D2, section 7. (b) The
cross-driver case lands with A4.

## 5. Sandbox / isolation matrix

**Canonical definitions** (ten distinct cases; the best-defined dimension):

| Case | Definition |
| ---- | ---------- |
| Isolation grade | `spikes/isolation/src/isolation-policy.mjs:17-23` — `process-contained`, `native-restricted`, `container-isolated`. **Spike-only; no product counterpart** — nothing in `packages/` mentions `process-contained` |
| Native control sets (per platform) | `isolation-policy.mjs:25-29` — win32: job-object, restricted-token, filesystem-acl, network-deny; linux: namespaces, seccomp, cgroup-v2, network-namespace; darwin: signed-app-sandbox, filesystem-profile, network-deny, process-group |
| Process-tree termination | Product `packages/platform-node/src/gate-commit-adapters.ts:96-121` (POSIX process **group** via `detached`, win32 `taskkill /T /F`); spike `worker-supervisor.mjs:25-46` (walks the tree, descendants-first) |
| Path protection | `packages/platform-node/src/protected-path.ts:76-251` — handle-based, TOCTOU-checked by dev/inode re-verification; case-folded comparison on win32 only (`:53-55`) |
| Disposable/guarded roots | `packages/self-test/src/disposable-roots.ts` |
| Egress boundary | `packages/application/src/egress/trust-egress.ts:93,231` — Cedar-backed default-deny |
| Capability grants | `packages/application/src/authority/authority.ts:367,388,437` |
| Bounded queue backpressure | `packages/drivers/src/index.ts` `BoundedQueue` |
| Probe worker sandbox | `packages/data-probe/` + `tests/contract/probe-worker-supervisor.test.mjs` |
| `doctor.sandbox` check | `packages/application/src/doctor/doctor.ts:45,67` — **presence-only today**; the live upgrade is #207 / task C5 |

**Coverage is genuine and platform-real**: `tests/security/protected-path.test.mjs`
(13 cases incl. symlink/junction escape, handle forgery, TOCTOU replacement),
`tests/integration/gate-commit-adapters.test.mjs:98,118` (real timed-out
process tree and descendant), `spikes/isolation/test/*` (50 cases, inside
`test:qualification` so it runs on the fleet).

**Recorded limitation:** `docs/qualification/isolation.md:14` qualifies the
isolation fixture on **Windows NT 10.0.26200.0 AMD64 only**, and no platform
can advertise `native-restricted` from its OS name alone
(`isolation-policy.mjs:35` requires a 64-hex helper digest plus every required
control). So the isolation *grade* dimension is qualified at
`process-contained` everywhere; `native-restricted` is unqualified on every
platform. The t75 report must state this rather than implying full sandbox
qualification.

**Note:** `.specs/features/isolation-process-tree/` (#88) is `in_progress`
with `nextTask: T2`, yet the code it specifies is already on main
(`worker-supervisor.mjs:38-45`). Its handoff is stale — reconcile it as part
of A3 or route it to the stale-handoff cleanup in
`.specs/features/milestone-2-completion/analysis.md`.

## 6. Database matrix — the largest honesty gap

**Canonical definition:** `packages/data-probe/src/index.ts:64` —
`["postgresql", "mysql", "mariadb", "sqlserver", "sybase", "oracle", "sqlite", "mongodb"]`
(8 engines; SAP ASE is keyed `sybase`).

**Verified fact: no real database engine runs anywhere in this repository
except SQLite.**

- `packages/data-probe/package.json` has **zero dependencies**. There is no
  `pg`, `mysql2`, `tedious`/`mssql`, `oracledb`, `mongodb`, jConnect,
  FreeTDS, or ODBC client in `package.json` or `pnpm-lock.yaml`.
- Every non-SQLite adapter talks only to an injected `ConnectionPort`, and
  the only implementation shipped is a `*FixtureConnection`.
- There is **no** docker-compose, service container, testcontainer, or
  devcontainer anywhere: `git ls-files | grep -iE "docker|compose|testcontainer"`
  returns nothing, and `.github/workflows/` contains no `services:`,
  `container:`, or `image:` key.

| Engine | Reality | Evidence |
| ------ | ------- | -------- |
| SQLite | **Real** | `sqlite-adapter.ts:261` `SqliteReadConnection` over `node:sqlite`; `tests/helpers/sqlite-probe-fixture.mjs:72-99` creates a real DB file with real `CREATE TABLE`/`INSERT` and byte/SHA-256 comparison |
| PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB | Fixture only | `*FixtureConnection` returning canned identity strings |
| **SAP ASE / Sybase** | Fixture only | `sap-ase-adapter.ts:341-342` — `product ?? "sap-ase"`, `version ?? "16.1 SP00 PL02"`. **That literal is the entire extent of ASE 16.1 "qualification"**: a default value in a fake connection, never a value read from a server |

Issue #16 states "SAP ASE / Sybase is a principal database qualification
target." Against that sentence, the current state cannot be reported as
qualified without qualification of the word. This needs an owner decision —
**D1, section 7** — exactly as F1's vector-index platform scope did.

Also note `docs/qualification/` contains `sqlite.md` and no report for any
other engine, which is consistent with the finding above.

## 7. Decisions required from the owner

These are scope calls, not implementation details. They follow the F1
precedent: an honest narrowing of claimed scope is acceptable; a silent
overclaim is not.

**D1 — Database qualification scope (blocks the T75 report).**
- *(a) Qualify what can genuinely run.* Add CI service containers for the
  engines with freely available images (PostgreSQL, MySQL, MariaDB, SQL
  Server, MongoDB) and qualify those against real servers. Oracle and SAP ASE
  have licensing constraints that make hosted CI images impractical; they
  would stay fixture-only with that stated explicitly.
- *(b) Formally scope the database dimension to read-only probe **contract**
  conformance* against recorded fixtures, state in the report and on the site
  that no live engine except SQLite is qualified, and correct any
  documentation implying otherwise (`database-capability-matrix.md` lists SAP
  ASE first and bold).
- *(c) Hybrid:* (b) now for T75, with (a) tracked as a post-1.0 issue.
- **Recommendation: (c).** It keeps T75 truthful without inventing an Oracle
  or ASE CI story, and it does not block the release chain on licensing
  negotiations. But the claim "SAP ASE is a principal qualification target"
  must then be softened wherever it appears, or it becomes an overclaim the
  report has to contradict.

**D2 — Pi driver qualification.** `PiDriver.probe()` returns a hardcoded
`PI_VERSION` and probes nothing. Either wire a real probe against the
installed `@earendil-works/pi-agent-core@0.82.1`, or record Pi as
contract-qualified only, with the hardcoded constant replaced by an honest
`not configured` when nothing real is present. **Recommendation: the latter**
— it matches the repository rule that a missing provider is `not configured`,
never a pass, and a constant that always reports success is exactly the
pattern that rule exists to forbid.

## 8. The signed evidence index

**It does not exist.** Repo-wide search for `evidence index`, `evidenceIndex`,
`qualification index` returns six hits, all aspirational prose in this
feature's own handoff, the workflow header, and the milestone-2 programme —
no file, no generator, no schema, no test.

**The per-leg evidence is also not collected.** `platform-matrix.yml:132-167`
writes `platform-validation.json` per leg and computes its SHA-256 at line
164 — but that digest is only `console.log`ged (line 166), never persisted.
The file is uploaded as an artifact with `retention-days: 14`, and
`grep download-artifact .github/workflows` returns **zero hits**: no workflow
ever collects it. So today the platform evidence expires, unindexed, two
weeks after each run — and acceptance criterion 3 ("reports bind … evidence
digests") has nothing to bind.

**What the index must be.** `docs/qualification/REPORT-CONTRACT.md` has no
digest field, no evidence-index field, and no run-reference field: its only
machine-verified bindings are a Git SHA (via `git cat-file` +
`git merge-base --is-ancestor`) and a PR URL. `t71-validation.md` cites
evidence purely as test-file names and quoted test titles; CI runs appear in
prose, never as run ids. So the index is a **new artifact type**, and it is
the mechanism by which criterion 3 becomes true.

Required content, derived from criterion 3 and this document:

- One entry per (dimension, case, platform, gate profile) actually exercised,
  naming the matrix run id and the leg.
- Per leg: platform, arch, runtime version, candidate revision, the
  `platform-validation.json` digest — which must first be **persisted**, not
  logged.
- Explicit `not qualified` / `not configured` entries for every case section 6
  and section 7 identify, so the index records the absence rather than
  omitting it. An index that silently lists only what passed is the failure
  mode this whole document exists to prevent.
- A signature over the canonical index bytes.

**Sequencing constraint (important).** AD-014 replaces `SealedArtifact` with a
DSSE envelope across all eight sealer-routed artifact kinds **before T76
starts**, and rejects the V1 format. An evidence index built against today's
`SealedArtifact` shape would be rewritten by that migration weeks later.
Therefore: **either** build the index after the DSSE migration lands, **or**
build it as an unsigned collected index first and sign it in the same change
that migrates the envelope. The AD-014 scope list does not currently include
an evidence index; adding it there is part of whichever order is chosen.

The reusable precedent for the generator is
`scripts/generate-proof-artifact.mjs`: it seals a real artifact with a
committed TEST-ONLY key, verifies its own output, writes canonical JSON plus
rendered Markdown, and is guarded by a drift test that regenerates on every
gate run and fails if the committed bytes disagree.

## 9. Defects found, not yet fixed

| # | Defect | Evidence | Owner |
| - | ------ | -------- | ----- |
| M-1 | The fleet has never exercised `test:integration`, so real-git topology cases are unqualified on every platform | Section 2 | **Dispatched** (runs 31320307931 `full`, 31320314440 `release`) — found F5 |
| F5 | `gate-commit-adapters.ts` rejected canonicalizing path aliases, breaking every real process-runner and Git-adapter case on Windows and macOS — the same defect as F3, one adapter over | Section 2; run 31320307931 | **Fixed**, PR #231 |
| M-2 | Per-leg evidence digest is computed and discarded; nothing collects the artifacts | `platform-matrix.yml:164-166`; no `download-artifact` anywhere | **Fixed**, PR #230 — legs persist `identityDigest` + outcome, an `index` job classifies every expected leg |
| M-3 | No installer test ever activates a release built for the **host** it runs on: every fixture declares the `win32-x64` target (one `linux` case at `tests/integration/transactional-activation.test.mjs:183`, one `freebsd` negative at `tests/security/transactional-activation-security.test.mjs:108`). See the correction below — this is narrower than it first appeared. | `tests/fault-injection/transactional-activation-faults.test.mjs:22,159`; `tests/security/transactional-activation-security.test.mjs:27` | A3 — add a host-target case |
| M-4 | `PiDriver.probe()` reports a hardcoded version and can never fail | `packages/drivers/src/pi-driver.ts:12,131-133` | D2 |
| M-5 | No live database engine except SQLite is qualified, while SAP ASE is documented as a principal target | Section 6 | D1 |
| M-6 | `artifact-placement.ts:55-56,69-71` duplicates the placement/relation unions as runtime `Set`s with no compile-time link | Section 3 | Low priority; record only |
| M-7 | `isolation-process-tree` (#88) handoff says `nextTask: T2` but the code is already on main | `.specs/features/isolation-process-tree/handoff.md` | Stale-handoff cleanup |

M-1 and M-2 are done; F5 is the defect M-1 surfaced and is fixed. M-3 needs no
decision. M-4 and M-5 wait on D2 and D1.

### Correction to M-3 (recorded rather than silently amended)

The first draft of this document claimed the installer tests' hardcoded
`platform: "win32"` made "the platform axis inert — a macOS leg tests win32
activation logic on darwin". **That was imprecise, and the correction matters
for anyone writing the T75 report from this document.**

`TransactionalActivationManager`'s `platform`/`arch`
(`packages/distribution/src/transactional-activation.ts:51,243`) are a
**declared release-target selector**, not a host switch. They are used only to
cross-check that the manager's declared target, the staged receipt, and the
bundle's own target all agree, failing `VES_ACTIVATION_RELEASE_MIXED`
otherwise (`:423-427`). The manager reads `process.platform` nowhere.
Activating a `win32-x64` bundle on a darwin runner therefore tests the
mixed-release guard, which is a real requirement — not nonsense.

The genuine gap is narrower and still worth closing: the manager performs real
host-dependent filesystem work — six `mkdir(..., { mode: 0o700 })` sites
(`:269,273,460,470,475,631`), where the POSIX permission mode is largely
ignored on Windows — and no test ever activates a release whose declared
target **matches the host it runs on**, which is the actual product scenario.
So the host axis is exercised (those directory operations run on every leg
that runs the test), but the host-matching-target case is not covered at all.

The imprecision came from reading the constant without reading the field's
use. Recorded here rather than quietly edited, because a defect list that
revises itself invisibly is not evidence.

## 10. What T75 still needs, in order

1. **D1 and D2** decided and recorded (owner).
2. ~~**M-1** — fleet dispatch at `gate=full` and `gate=release`~~ — **done**;
   it surfaced F5, fixed in PR #231. Re-dispatch after F5 merges so the run
   ids recorded in the report are green ones.
3. ~~**M-2** — persist the per-leg digest; add a collection job~~ — **done**,
   PR #230. The index now classifies every expected leg as qualified, failed,
   missing, or digest-mismatch.
4. **M-3** — add an activation case whose declared release target matches the
   host it runs on, so the fleet covers the real product scenario; see the
   correction in section 9 for why this is narrower than first stated.
5. **A4 (#35)** — live cross-driver verifier session; supplies the Driver
   matrix's missing cross-driver case.
6. **C5 (#207)** — live doctor probes, including `doctor.sandbox` moving off
   presence-only.
7. **Evidence index signed** — ordered against AD-014 per section 8.
8. **B3** — independent `t75-validation.md` binding all of the above, with
   every `not qualified` entry stated rather than omitted, and the macOS x64
   Intel-queue limitation recorded as environmental.
