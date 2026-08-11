---
schema: verchestra-feature-handoff/v1
feature: platform-qualification-matrix
issue: 16
status: verification
branch: main
baseRevision: 3f97047cd26ea1ab4d91b099aafeb8fdc11c2f3b
lastCompletedTask: null
nextTask: "The declared matrix is now machine-checked (matrix.json + tests/agent-readiness/t75-matrix-declaration.test.mjs): every dimension issue #16 names is declared, and the platform/gate-profile/database/self-test case sets are bound to their canonical sources so a case cannot be silently dropped. REMAINING for T75: (1) SIGN the evidence index - blocked on an owner decision about which identity signs release evidence, since the docs/proof TEST-ONLY key pattern would be a category error here (it signs fixture data and carries no trust); (2) C5/#207 live doctor probes (bruno, partly landed); (3) B3 independent t75-validation.md, which cites matrix.json and the four fleet indexes. Chain is at T73; T74 must qualify first."
lastGate: FLEET GREEN — gate:security passed SIMULTANEOUSLY on Windows x64, Linux x64, Linux arm64, macOS arm64 at 5c86436 (run 31315589420); macOS x64 environmentally queued on the retiring Intel fleet; on-main confirmation run 31315939879 dispatched at bb11932
updatedAt: 2026-08-09T17:00:00Z
---

# READ FIRST — `matrix.md`

The remaining T75 scope is now specified in
`.specs/features/platform-qualification-matrix/matrix.md`: every dimension's
canonical case set, what is actually exercised, seven identified defects
(M-1..M-7), two owner decisions (D1 database scope, D2 Pi driver), and the
design of the signed evidence index. **Start there**, not in the historical
sections below, which record the platform × security-gate leg that is already
complete and green.

Headline findings from that specification:

- **No gate profile runs every stage.** `test:integration` is absent from
  `gate:security` — the only profile ever dispatched fleet-wide — so the
  real-git topology cases have never run on any platform but the single CI
  runner. Four dispatches (`quick ∪ full ∪ security ∪ release`) are needed for
  full stage coverage.
- **The per-leg evidence digest is computed and thrown away**
  (`platform-matrix.yml:164-166`), and no workflow ever downloads the
  artifacts. Acceptance criterion 3 has nothing to bind to.
- **No live database engine except SQLite is qualified anywhere**, while
  issue #16 calls SAP ASE a principal target — its "16.1 SP00 PL02" is a
  default string in a fake connection (`sap-ase-adapter.ts:342`).
- **The signed evidence index is a new artifact type**, and AD-014's DSSE
  migration constrains when it can be signed.

# Scope

Resolve the two platform gaps that the T75 platform matrix
(`.github/workflows/platform-matrix.yml`, dispatch-only) surfaced when it first
ran `gate:security` off Linux x64. After both are fixed, a `gate=security`
dispatch of the matrix must be green on all five supported platforms (Windows
x64, macOS x64/arm64, Linux glibc x64/arm64) — T75 acceptance criterion 4 from
issue #16. This is issue #16 work; it does NOT advance the qualification chain
(officially still T71; T72–T74 code merged but unqualified).

The platform-matrix infrastructure itself is DONE and verified — do not rebuild
it. This handoff is only the two red findings it exposed.

## Evidence to re-open

- Security run (bound to `5a8921f`): <https://github.com/accd/verchestra/actions/runs/31201561765>
  — legs: Linux x64 PASS; Windows x64 FAIL (F2); Linux arm64 FAIL (F1); macOS
  arm64 FAIL (F1); macOS x64 was still queued on scarce Intel runners.
- Per-job logs while a run is still in progress:
  `gh api repos/accd/verchestra/actions/jobs/<jobId>/logs` (on Git Bash prefix
  `MSYS_NO_PATHCONV=1` and drop the leading slash). Job ids from that run:
  Windows x64 `92942522324`, Linux arm64 `92942522353`, macOS arm64
  `92942522452`.
- Both findings live in the `test:qualification` stage, whose script runs the
  `spikes/*/test/*.test.mjs` suites (see root `package.json` `test:qualification`).

# Completed Evidence

- Platform matrix delivered: `.github/workflows/platform-matrix.yml` +
  `tests/agent-readiness/platform-matrix-workflow.test.mjs` (9 invariants),
  merged in PR #193 (rebase, admin) at `55d9efd`. `gate:quick` PASS locally.
- Plumbing verified on all five platforms by a `gate=quick` dispatch (run
  31195616672, bound `55d9efd`): 4/5 legs green (macOS x64 stayed queued). It
  confirmed the hard unknowns: the `ubuntu-24.04-arm` runner label is valid,
  bash-on-Windows heredocs/`set -euo pipefail`/`case` work, `pnpm install
  --frozen-lockfile` succeeds on darwin/arm, and the runner-arch self-check
  passes.
- Root causes fully diagnosed (below). Neither is a workflow bug.
- **F1 DONE** (commit `07f51be`, verified on darwin-arm64 — an unqualified host,
  so the degraded path is exercised for real rather than simulated). The six
  affected assertions in `spikes/sqlite/test/sqlite-memory-stack.test.mjs` are
  now platform-aware; qualified-host assertions are unchanged. Discrimination
  proven by three source mutations, each caught, source restored byte-identical
  after each: fail-closed guard removed → 2 failures; `searchVector` returning
  `[]` instead of refusing → 3; `rebuildVectorIndex` reporting a no-op success
  → 2. Spike result 19/20; the one remaining failure is the `node: "24.14.0"`
  pin against this machine's Node 24.18.1 and is environmental, not F1.

## Corrections to this handoff's own earlier F1 text

- The prescription said to assert `inspectSqliteRuntime().sqliteVecSha256 ===
  null` on an unqualified host. That is wrong: `inspectSqliteRuntime` hashes the
  asset it actually loaded and returns a real digest (`193e480c…` on
  darwin-arm64). It is `QUALIFIED_SQLITE.sqliteVecSha256` that is `null`. The
  commit asserts the real contract.
- The failing-test list omitted line 99 (`wrong vector asset checksum fails
  closed…`). It fails on an unqualified host too, because the platform check
  refuses before any checksum is compared, yielding `VES_VECTOR_UNAVAILABLE`
  rather than `VES_VECTOR_ASSET_MISMATCH`. Now covered.

## Finding 1 (F1) — sqlite-vec vector index qualified only for {Linux, Windows} x64

- Canonical source: `spikes/sqlite/src/sqlite-memory-stack.mjs`.
  `QUALIFIED_SQLITE_ASSETS` (line ~8) is frozen to exactly `linux-x64` and
  `win32-x64` (sha256 + bytes). `qualifiedSqliteAsset()` returns `null` for any
  other `${platform}-${arch}`, so `hostQualifiedSqliteAsset` is `null` and
  `QUALIFIED_SQLITE.sqliteVecSha256` is `null` on arm64/macOS.
- The stack ALREADY fails closed correctly: `bootstrapVector` (line ~231) throws
  "platform is not qualified" when `!hostQualifiedSqliteAsset`, caught into
  `{ enabled:false, code:"VES_VECTOR_UNAVAILABLE" }`, and lexical (FTS5) search
  keeps working. Graceful degradation is real and already tested for the
  mismatch/missing cases (`spikes/sqlite/test/sqlite-memory-stack.test.mjs`
  lines 99–113).
- What is red is that the qualification tests assert the vector-READY happy path
  UNCONDITIONALLY. Failing tests in that file: line 44 (`inspectSqliteRuntime`
  deep-equals a fixed object whose `sqliteVecSha256` is `null` off qualified
  hosts while the real loaded asset hashes to something else), line 55 (asserts
  `qualifiedSqliteAsset() != null`), line 92 (asserts `VES_VECTOR_READY`), line
  197 (`searchVector` returns neighbors), line 216 (rebuild). On Linux x64 all
  pass; on Windows x64 sqlite-vec is fine (its asset is qualified) so F1 does not
  fail there.

## Finding 2 (F2) — Claude/Codex driver probe returns available:false on Windows

- Test: `spikes/claude-code-driver/test/claude-driver.test.mjs:13` "probes the
  installed Claude Code without invoking a model" builds
  `new ClaudeCodeDriver({ command: ["claude"], minimumVersion: "2.1.168" }).probe()`
  against the globally-installed CLI and asserts `result.available === true`
  (line 15). On Windows it is `false` (the log shows `actual:false,
  expected:true`). The Codex probe fails identically.
- Root cause (high confidence, classic win32): the driver spawns the bare
  command `claude`/`codex` without `shell:true` and without resolving the
  Windows executable extension. npm's global bin is `claude.cmd` (plus `.ps1`
  and a POSIX shim); Node `child_process.spawn("claude", …)` cannot execute the
  `.cmd` directly on win32, so the probe spawn fails and `available` is `false`.
  The spawn/probe code is in `spikes/claude-code-driver/src/claude-code-driver.mjs`
  (and the sibling `spikes/codex-driver/src` — very likely the same defect).

### F2 is broader than "a win32 spawn bug" (new evidence, darwin-arm64)

All three driver probe tests fail here, and none of the three failures is the
win32 spawn. Each depends on real provider tooling that is not part of the repo:

| spike | probe test | pinned | this machine | failure |
| --- | --- | --- | --- | --- |
| claude-code-driver | `claude-driver.test.mjs:13` | `2.1.168` | `claude` 2.1.220 installed | version drift |
| codex-driver | `codex-driver.test.mjs:12` | `0.115.0` | `codex` not installed | `available:false` |
| opencode-driver | `opencode-driver.test.mjs:58` | `1.18.9` | probe reports `1.18.5` | silent PATH fallback (below) |

### The opencode row is the most serious of the three — diagnosed

`defaultCommand()` (`spikes/opencode-driver/src/opencode-driver.mjs:9-12`) builds
a cwd-relative path and falls back to a bare PATH lookup when it misses:

```js
const executable = path.resolve("node_modules", "opencode-ai", "bin",
  process.platform === "win32" ? "opencode.exe" : "opencode");
return existsSync(executable) ? [executable] : ["opencode"];
```

The installed `opencode-ai@1.18.9` ships **only `opencode.exe`** in `bin/` — there
is no POSIX `opencode` binary — so on darwin/linux `existsSync` is always false
and the driver silently falls back to whatever `opencode` is on PATH. On this
machine that is Homebrew's `/opt/homebrew/bin/opencode` at 1.18.5, which is why
a test called "probes the exact repo-local OpenCode" was in fact probing a
global install two patches off the pinned version.

It looks green in CI only because pnpm prepends `node_modules/.bin` to PATH, so
the bare `opencode` resolves to the repo-local 1.18.9 shim. Proof — same commit,
same machine, only PATH differs:

- `PATH="$PWD/node_modules/.bin:$PATH" node --test spikes/opencode-driver/test/*.test.mjs` → 17 pass, 0 fail
- `node --test spikes/opencode-driver/test/*.test.mjs` → 16 pass, 1 fail

So the mandatory gate's verdict depends on how the runner was invoked, and the
"exact repo-local" guarantee in the test name is not enforced by anything. Treat
this as a qualification-integrity defect in its own right, not a flaky test:
a driver on a security-qualification surface silently accepting an arbitrary
PATH binary is the same class of problem as F2's win32 gap.

The win32 `.cmd` spawn is therefore one instance of a wider defect: these are
provider-dependent tests inside a mandatory gate. `spikes/AGENTS.md` forbids
exactly that — "Tests must cover expected behavior and discriminating failure
modes without network or provider requirements in mandatory gates" and
"Unavailable tooling is `not configured`, never a pass" — while the same file
also requires recording exact tool versions. Reconciling those two is a policy
call on a qualification surface, not a refactor.

# F2 blocked on decision

**Do not write the F2 code before the owner picks a shape.** Three options:

1. **Hermetic gate + separate attestation.** Mandatory-gate probe tests run
   against the existing `fake-*.mjs` fixtures; a separate, non-gating command
   attests the real installed provider versions and reports `not configured`
   when a provider is absent. Best fit for `spikes/AGENTS.md`, and it fixes
   Windows, this machine, and every future version bump at once.
2. **Keep the real-provider assertions, fix only the win32 spawn.** The literal
   original F2. Leaves all three tests brittle to provider upgrades — the claude
   and opencode rows above would still be red here after the Windows fix lands.
3. **Pin providers as repo-local dev dependencies** so the qualified version is
   installed by `pnpm install` rather than assumed on the host. Largest change;
   needs the dependency-approval rule in root `AGENTS.md`.

Whoever picks (2) or (3) should know the win32 half cannot be verified from this
macOS checkout at all: resolving `claude.cmd` through `PATH`/`PATHEXT` is only
half the fix, because Node refuses to spawn `.bat`/`.cmd` without `shell: true`
(the CVE-2024-27980 hardening), and `shell: true` reintroduces argument-injection
surface on a driver that forwards a caller-supplied `--model`. That trade-off
needs a Windows host or a matrix dispatch to settle honestly — it must not be
guessed at from here.

# FLEET GREEN — every finding fixed; the platform × security-gate leg is proven

All five findings are fixed and merged, and `gate:security` passed
SIMULTANEOUSLY on Windows x64, Linux glibc x64, Linux glibc arm64, and macOS
arm64 at `5c86436` (matrix run 31315589420; on-main confirmation run
31315939879 at `bb11932`). macOS x64 stayed queued on GitHub's retiring Intel
fleet — an environmental limit, not a product gap; re-dispatch when Intel
capacity returns or the owner re-scopes that leg.

- **F1a** — sqlite spike platform-aware assertions (`07f51be`, PR #200).
- **F1b** — memory-vector tests exercise the installed asset identity; closed
  default contract asserted per platform (PR #221).
- **F3** — git-worktree adapter canonicalizes platform path aliases (PR #216).
- **F4** — memory-lifecycle rebases promotion targets into canonical space
  before the ancestry walk (PR #222).
- **F2** — Windows npm cmd-shims resolved by parsing the shim's own generated
  target line and running .js targets under process.execPath — no shell, no
  injection surface, empty args preserved (PR #225, three fleet-verified
  iterations). CI installs the pinned providers, so bruno's hermetic-vs-real
  policy question (kept below) no longer blocks the gate; it remains a
  worthwhile qualification-policy decision on its own merits.

What T75 still needs (issue #16): the topology, Driver, database (SAP ASE /
Sybase), sandbox, installer, and recovery matrices; the signed evidence index;
and the independent `t75-validation.md` (author != verifier) with the atomic
chain advance. Those are qualification-surface changes — serialize them per the
session-coordination protocol.

# Historical: fleet re-run that surfaced F3 and F1b (superseded by the above)

The matrix dispatch that "Next Exact Action" #2 asked for HAS now been run on
`main` (`gate=security`, run 31311344239, bound `22c41f2`): green ONLY on Linux
x64. It confirms F1a and surfaces two things the earlier single run could not,
because `gate:security` has since expanded to also run `test:contract` and
`test:e2e`.

- **F1a is verified in CI.** On Linux arm64 the sqlite spike passes
  (`✔ records the exact qualified …`, `✔ controlled vector bootstrap`,
  `✔ vector search is derived`). bruno's `07f51be` holds on a real unqualified host.
- **F3 (FIXED — commit `965a1e4`, PR #216) — `git-worktree-adapter` rejected
  macOS/Windows path aliases.** macOS arm64 and Windows x64 both died at
  `test:e2e`, before `test:fault`/`test:qualification`, in
  `packages/platform-node/src/git-worktree-adapter.ts` `#qualifiedRepositoryRoot`
  (~line 240; `fail` at ~43) — the "real isolated worktree" / "removes the real
  worktree" / "Driver bypass outside task scope" tests. It was the FIRST
  non-Linux blocker and MASKED the later gaps. **Fix:** `#qualifiedRepositoryRoot`
  and `#qualifiedWorktreesRoot` now canonicalize via `realpath` instead of
  rejecting `input !== realpath` (which rejected macOS `/var`→`/private/var` and
  Windows 8.3 `RUNNER~1`→`runneradmin`); every real escape guard is kept, proven
  by a "still refuses a worktrees root whose own entry is a link" test plus a
  discrimination sensor. Verified by matrix run 31313342425: macOS + Windows
  cleared `test:e2e` with zero worktree errors, unmasking F1b on macOS
  (`test:security`) and F2 on Windows (`test:qualification`). Linux was unaffected.
- **F1b (confirmed) — the product memory index has the same asset-scope gap.**
  Linux arm64 clears F3, then fails at `test:fault`:
  `tests/fault-injection/memory-vector-index-faults.test.mjs` (16 tests) →
  `packages/memory/src/memory-vector-index.ts:188`. Same sqlite-vec-only-on-
  {linux,win}-x64 gap as F1a, one layer up in the PRODUCT index. The "Files
  Intentionally Left Unchanged" note about `packages/memory` below is SUPERSEDED:
  the gap IS there.

**Fix ordering to green the fleet:** F3 is DONE (`965a1e4`). Now **F1b**
(arm64/macOS memory index — same platform-aware degradation pattern as F1a; do
NOT weaken), then **F2** (win32 probes, now confirmed unmasked at
`test:qualification`; still on the owner decision above). Note F1b cannot be
reproduced on a Windows host (Windows has a qualified sqlite-vec asset, so the
gap only bites on arm64/macOS); it must be verified by a matrix dispatch.

# Next Exact Action

**Superseded by `matrix.md` section 10.** In order:

1. **Owner decides D1** (database qualification scope — no live engine but
   SQLite is qualified, while SAP ASE is documented as a principal target)
   and **D2** (Pi driver reports a hardcoded version and can never fail).
   Both are scope calls in the F1 mould: an honest narrowing is acceptable,
   a silent overclaim is not.
2. **M-1** — dispatch the fleet at the qualification revision with
   `gate=full` and `gate=release`; record all four run ids. No code change;
   this is the cheapest gap and it closes the topology hole.
3. **M-2** — persist the per-leg evidence digest into
   `platform-validation.json` (today it is only `console.log`ged) and add a
   collection job that downloads every leg's artifact into one index.
4. **M-3** — parameterize the installer/activation tests by host platform
   instead of the hardcoded `win32`, then re-dispatch so the platform axis
   stops being inert.
5. Then A4 (#35 cross-driver session), C5 (#207 live doctor probes), the
   signed evidence index (ordered against AD-014), and finally B3's
   independent `t75-validation.md`.

## Historical fix order (F1/F2/F3 — all complete)

F1a is done (`07f51be`) and verified in CI. Remaining, in fix order:

1. **Get an owner decision on F2's shape** — see "F2 blocked on decision" above.
   Nothing else about F2 should be written first.
2. **F3 — DONE** (`965a1e4`, PR #216). `git-worktree-adapter` now canonicalizes
   the roots; macOS + Windows clear `test:e2e` (matrix run 31313342425). No
   further action.
3. **Then F1b — the product memory index.** Apply the same platform-aware
   degradation as F1a to `packages/memory/src/memory-vector-index.ts` and its
   `tests/fault-injection/memory-vector-index-faults.test.mjs` (assert the real
   degraded contract on unqualified hosts; do NOT weaken). Now proven, not
   speculative. The fleet dispatch this step used to ask for HAS been run
   (run 31311344239) — it is the source of F3/F1b above.

The original F1 prescription is kept below for provenance; it is implemented.

**F1 (owner chose: scope to {Linux, Windows}, degrade the rest — NOT weaken):**
Make the qualification assertions platform-aware so they assert the REAL
per-platform contract. On a qualified host (`qualifiedSqliteAsset() != null`):
keep the current vector-READY + exact-version + exact-checksum assertions
unchanged. On an unqualified host: assert the fail-closed-to-lexical contract
that already exists — `inspectSqliteRuntime().sqliteVecSha256 === null`, the
bootstrap reports `VES_VECTOR_UNAVAILABLE`, `searchVector` throws
`VES_VECTOR_UNAVAILABLE`, and lexical search still returns the row. This turns
the degraded path into a first-class asserted behavior; it is NOT skipping or
weakening. Touch only `spikes/sqlite/test/sqlite-memory-stack.test.mjs` (and, if
needed for a clean predicate, a small exported helper in
`spikes/sqlite/src/sqlite-memory-stack.mjs`). Do NOT edit the linux-x64/win32-x64
sha256/bytes. (Alternative, rejected for now: Option B — add real darwin-x64,
darwin-arm64, linux-arm64 entries to `QUALIFIED_SQLITE_ASSETS` with their true
sha256/bytes from the installed sqlite-vec npm optional packages, CI-verified.
Choose this only if the owner later wants vector search first-class on every
platform.)

**F2 (fix the win32 spawn):** in `spikes/claude-code-driver/src/claude-code-driver.mjs`
resolve the executable on Windows — either spawn with `shell: true`, or append
the correct extension from `PATHEXT`/use `.cmd` on `process.platform === "win32"`.
Apply the same fix to `spikes/codex-driver/src` (and check `spikes/opencode-driver/src`).
Add/extend a probe test that exercises the win32 path deterministically against
the `fake-claude.mjs` fixture (do not depend on a real global install for the
unit assertion). This repo's dev machine is Windows, so F2 is reproducible
locally: `npm i -g @anthropic-ai/claude-code@2.1.168 @openai/codex@0.115.0`
then `node --test spikes/claude-code-driver/test/claude-driver.test.mjs`.

**Verify:** run `node scripts/gate.mjs security` locally (Windows will cover F2
and the Windows sqlite path; it cannot cover arm64/macOS). Then dispatch the
matrix for the full proof: `gh workflow run platform-matrix.yml --ref <branch or main> -f gate=security`
and watch every leg — `gh run watch <id> --exit-status` can return early, so also
poll `gh run view <id> --json status --jq .status` until `completed`. All five
legs must be green. Commit F1 and F2 as two atomic commits (per the repo's
one-concern rule); rebase-merge with admin per the owner's standing
authorization (see the `merge-authorization` memory note).

# Blockers

None for the platform × security-gate leg — the fleet is green (see "FLEET
GREEN"). The macOS x64 Intel leg is environmentally queued, not blocked by any
product gap. The remaining T75 matrices and the qualification report are
qualification-surface work to serialize per the session-coordination protocol;
the historical "F2 blocked on decision" section below records a policy question
that no longer gates the fleet.

Two environment limits on this darwin-arm64 checkout, neither caused by the
change and both reproducible on unmodified `main`:

- Local Node is 24.18.1 against a qualified 24.14.0, so the sqlite spike's
  `node`/`sqlite` version pins fail locally. CI on the qualified runtime is the
  authority for those two assertions.
- `pnpm gate:quick` stops at `typecheck` because the workspace packages
  (`@verchestra/drivers`, `@verchestra/agent-runtime`, `@verchestra/effects`)
  have no built declarations locally. Byte-identical failure on unmodified
  `main`, so it is a build-state issue, not a regression. Build the packages or
  rely on CI's `Quality gate`.

Practical: a full cross-platform proof requires
dispatching the matrix (macOS/arm64 cannot run locally), and macOS x64 (Intel,
`macos-13`) can sit queued a long time on GitHub's winding-down Intel fleet —
budget for that latency, do not read a long queue as a failure.

# Decisions

- Owner decision (2026-08-07, this session): resolve F1 by scoping the vector
  index to {Linux, Windows} x64 and formalizing lexical-only degradation
  elsewhere, rather than shipping multi-platform sqlite-vec assets. Reconfirm
  before choosing Option B.
- F1 must NOT be "fixed" by weakening/skipping tests or by editing the qualified
  linux/win checksums. The degraded-path assertion is the honest contract.
- Human review is mandatory before merge; these are qualification-surface
  changes. The qualification chain stays at T71 — this work does not write a
  t<NN>-validation.md.

# Files Intentionally Left Unchanged

- `.github/workflows/platform-matrix.yml` and
  `tests/agent-readiness/platform-matrix-workflow.test.mjs` — the delivered,
  verified infrastructure. No change needed; they correctly report red until
  F1/F2 land.
- `packages/memory/src/memory-vector-index.ts` — SUPERSEDED by the fleet re-run:
  the same asset-scope gap IS present here (F1b). It is now in scope, not left
  unchanged — see "Authoritative fleet re-run" and Next Exact Action #3.
- Root status surfaces (`AGENTS.md`, `llms.txt`, `apps/site/src/data/product.ts`,
  current-qualification-status) — untouched; the chain is not advancing.
