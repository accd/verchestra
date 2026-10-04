# Validation T1 — one scoped-path rule for the task path

Task T1 of the second architecture deepening round: the grammar of a task path
(a scope entry, a protected path, a target the implementer writes), its
containment test, the protected-path test and the case rule live in one
module, and every stage of the task path asks it. Source: the architecture
review of `main` at `9eb2881`, card 2.

## 1. Is there a defect? Yes: a security defect

**A write can land on a protected path and be committed.** On `origin/main`
(`35b23b3`) the executor and the gate compare a target with a task's protected
paths as written, by letter case and by spelling, while the macOS default
volume is case-insensitive. Two classes of target pass every stage of the task
path (relay → MCP bridge → executor → worktree tool → Git inspection → gate)
and reach the task commit:

1. **A case variant of a protected path that does not exist at the base
   revision.** Protected `src/Generated`; the model writes
   `src/generated/out.js`. The bridge, the executor, the worktree tool, the
   inspection and the gate all admit it, and the gate commits it. On a
   case-insensitive volume that file is the protected path.
2. **A target under a protected entry spelled with a trailing separator.**
   Protected `src/vendor/`; the model writes `src/vendor/lib.js`. The executor
   and the gate compare `src/vendor/lib.js` with `src/vendor/` + `/`, so the
   entry protects nothing, on any volume. The write is committed. The same
   holds for `./src/vendor`, `src//vendor` and `src/./vendor`, which the
   schema and the executor's pattern also admit.

A third class lands on a protected file and is caught only after the effect:

3. **A case variant of an existing protected file.** Protected
   `src/locked.json`; the model writes `src/LOCKED.json`. The executor admits
   it, and the worktree tool overwrites `src/locked.json`. Git then reports
   the change under its index name `src/locked.json`, so the executor's
   inspection fails the run with `VES_EXECUTOR_PROTECTED_PATH` and removes the
   worktree. Nothing is committed, but the preventive check that AD-039
   promises ("the executor re-checks … protected paths … before
   `ExecutionToolPort` writes") did not hold.

A case variant of an existing protected *directory* (`src/Protected/config.json`)
is refused, but only by accident: the worktree tool's parent walk compares
each parent with its real path (`packages/platform-node/src/worktree-tool-adapter.ts:115`),
and macOS `realpath` returns the stored letter case, so it fails with
`VES_TOOL_PATH_ESCAPE`. On a case-sensitive volume the variant is a different
directory and is committed as a new path.

### Where each stage stood on `origin/main`

The scope is `["src", "cli.js"]` and the protected paths are
`[".git", ".verchestra", "src/protected", "src/locked.json", "src/Generated", "src/vendor/"]`.
Bridge, executor and gate columns were observed with each stage alone; the
worktree tool, inspection and commit columns come from the whole-path journey
on a real repository in a temporary directory (macOS, APFS, case-insensitive,
`core.ignorecase=true`).

| Target | Bridge (`logicalSegments`) | Executor (`assertTarget`) | Worktree tool | Git inspection reports | Gate (`#assertInspection`) | Whole path |
| --- | --- | --- | --- | --- | --- | --- |
| `.GIT/config` | `VES_BRIDGE_PATH_PROTECTED` | `VES_EXECUTOR_SCOPE_DENIED` | (`VES_TOOL_PROTECTED_PATH`) | — | `VES_GATE_SCOPE_DENIED` | refused at the bridge |
| `.Git/HEAD` | `VES_BRIDGE_PATH_PROTECTED` | `VES_EXECUTOR_SCOPE_DENIED` | (`VES_TOOL_PROTECTED_PATH`) | — | `VES_GATE_SCOPE_DENIED` | refused at the bridge |
| `CLI.js` against scope `cli.js` | admits | `VES_EXECUTOR_SCOPE_DENIED` | — | — | `VES_GATE_SCOPE_DENIED` | refused by the executor |
| `.VERCHESTRA/x` against protected `.verchestra` | admits | `VES_EXECUTOR_SCOPE_DENIED` (not as protected) | (`VES_TOOL_PROTECTED_PATH`) | — | `VES_GATE_SCOPE_DENIED` | refused by the executor, for scope |
| `src/Protected/config.json` | admits | admits | `VES_TOOL_PATH_ESCAPE` (parent real path) | — | admits | refused by the worktree tool, by accident |
| `src/LOCKED.json` | admits | admits | **writes `src/locked.json`** | `src/locked.json` | admits the target as written | **lands; run fails at inspection** |
| `src/generated/out.js` | admits | admits | **writes** | `src/generated/out.js` | admits | **committed** |
| `src/vendor/lib.js` | admits | admits | **writes** | `src/vendor/lib.js` | admits | **committed** |

The bridge's read view already folds case for protected paths
(`packages/agent-runtime/src/execution/mcp-bridge-tools.ts:211-213`), so
`src/LOCKED.json` was hidden from reads, but it compares spelling as written:
`src/vendor/lib.js` was readable under protected `src/vendor/`. The worktree
tool folds case only for the roots the composition root gives it, which is
`.verchestra` alone (`apps/vestra-cli/src/task/task-run.ts:385`).

Code on `origin/main`: the executor tests protected paths at
`packages/application/src/execution/task-executor.ts:381-388`, the gate at
`packages/application/src/execution/gate-commit.ts:362-364` and `:558`.

A parenthesised outcome is what the stage does when it is reached alone; the
whole path had already stopped before it.

Reproduce: the regression test that comes with the fix,
`tests/e2e/task-path-case-variant-e2e.test.mjs`, fails 9 of its 14 cases
against these sources; its assertion diffs are the outcomes in the table.

## 2. The fix (its own commit, before the refactor)

The executor and the gate test a protected path by what it names, letter
case folded (decision entry "A protected path is compared by what it names,
in any letter case" in `.specs/STATE.md`). The change is two call sites and
one function (lines at the fix commit; section 3 gives them after the
refactor moved the function into the domain):

- `packages/application/src/execution/task-executor.ts:385-397`:
  `isProtectedTaskPath` drops empty and `.` segments, folds case, and asks
  whether a protected entry's segments are a prefix of the target's.
  `assertTarget` (`:402`) uses it before every tool effect and for every
  inspected change.
- `packages/application/src/execution/gate-commit.ts:560`: the gate's
  inspection check uses the same function.

No error code or message is added. One refusal changes code, to the one the
executor already uses for it: `.VERCHESTRA/x` against protected `.verchestra`
was refused for scope and is now refused as protected. The scope test is
untouched. Nothing that
is stored or digested changes: the function compares, it never rewrites a
path.

### Regression evidence

`tests/e2e/task-path-case-variant-e2e.test.mjs` drives each target through
the real relay, MCP bridge, executor, worktree tool, Git inspection and gate,
over a real repository in a temporary directory, one journey per target:

| Case | Assertion | Before the fix | After |
| --- | --- | --- | --- |
| Case variant of a protected path absent at base (`src/generated/out.js`) | `:272-276` refused with `VES_EXECUTOR_PROTECTED_PATH`, the commit holds only `src/value.txt` | written and committed | refused before the effect |
| Target under a protected entry with a trailing `/` (`src/vendor/lib.js`) | `:272-276` | written and committed | refused before the effect |
| Case variant of an existing protected file (`src/LOCKED.json`) | `:272-276` | written over `src/locked.json`, run failed at inspection | refused before the effect, run commits |
| Case variant of an existing protected directory (`src/Protected/config.json`) | `:272-276` | `VES_TOOL_PATH_ESCAPE` from the parent walk | `VES_EXECUTOR_PROTECTED_PATH` |
| `.VERCHESTRA/x` against protected `.verchestra` | `:272-276` | `VES_EXECUTOR_SCOPE_DENIED` | `VES_EXECUTOR_PROTECTED_PATH` |
| `.GIT/config`, `.Git/HEAD` | `:272-276` | `VES_BRIDGE_PATH_PROTECTED` | unchanged |
| `CLI.js` against scope `cli.js` | `:272-276` | `VES_EXECUTOR_SCOPE_DENIED` | unchanged |
| A change found by the executor's inspection | `:296` | admitted for `src/generated/out.js` and `src/vendor/lib.js` | `VES_EXECUTOR_PROTECTED_PATH` |
| A change found by the gate's inspection | `:322` | committed for `src/generated/out.js` and `src/vendor/lib.js` | `VES_GATE_PROTECTED_PATH` |

The user's checkout stays at its base and clean in every journey
(`:277-279`). Before the fix 9 of the 14 cases fail; after it all 14 pass.
The two `src/LOCKED.json` inspection cases pass before the fix on a
case-insensitive volume, because Git reports the index name, and fail before
it on a case-sensitive one, where the variant is a new file; they pin the
rule on both.

Not in this fix: the bridge's read view still compares a protected entry's
spelling as written, so a protected `src/vendor/` does not hide
`src/vendor/lib.js` from `read_file`. Reads change nothing and the fix stays
on the write path; the refactor routes the read view through the same rule.

## 3. The refactor: one task-path module

### The module and its callers

`packages/domain/src/primitives/task-path.ts` owns the grammar
(`isTaskPath`, `:23-27`), what a path names (`taskPathSegments`, `:33-35`),
containment (`isWithinTaskPath`, `isWithinTaskScope`, `:47-53`), the
protected test (`isProtectedTaskPath`, `:55-58`), Git metadata
(`namesGitMetadata`, `:61-63`), overlap (`taskPathsOverlap`, `:67-71`), and
the case rule (its header, `:1-12`). It is exported from
`packages/domain/src/index.ts:16`. The dependency direction admits every
caller: `application` depends on `domain`; `agent-runtime` and
`platform-node` are adapters that may import it; `apps/vestra-cli` is the
composition root. No package edge was added.

| Stage | Before (`origin/main`) | Now asks the module |
| --- | --- | --- |
| Executor | pattern, case-sensitive (`task-executor.ts:19`); containment `:381-383`; protected as written `:387` | `task-executor.ts:324-325` (scope and protected entries), `:412` (target grammar), `:418-420` (protected, scope), `:765` (tool targets) |
| Gate | pattern that also names `.` (`gate-commit.ts:10`); containment `:362-364`; protected as written `:558` | `gate-commit.ts:10` (list grammar), `:157` (gate `cwd`), `:551-554` (protected, scope) |
| Scheduler | its own overlap (`task-scheduler.ts:266-268`) | `task-scheduler.ts:270` (`taskPathsOverlap`) |
| Verification | pattern (`verification.ts:10`) | `verification.ts:304` |
| MCP bridge | linear scan, folds case (`mcp-bridge-tools.ts:9`, `:33-37`, `:45-47`, `:57`, `:97`, `:211-215`) | `mcp-bridge-tools.ts:48`, `:52` (target), `:90` (protected entries), `:205-207` (read view) |
| Worktree tool | pattern, folds its own roots (`worktree-tool-adapter.ts:18`, `:172`, `:269-275`) | `worktree-tool-adapter.ts:165`, `:263`, `:268-269` |
| Git worktree adapter | pattern (`git-worktree-adapter.ts:21`) | `git-worktree-adapter.ts:64` |
| Git context source | pattern and its own containment (`git-context-source.ts:16`, `:48-50`) | `git-context-source.ts:50`, `:58`, `:148`, `:199` |
| Verifier claims | pattern bounded 1024 (`task-codex.ts:21`) | `task-codex.ts:44`; the 1024 bound stays the stage's own limit |
| Verifier mutation target | its own containment (`task-verifier.ts:117`) | `task-verifier.ts:123` |

Each stage still validates its own untrusted input and keeps its own codes:
the bridge refuses a doubled separator or a `.` segment
(`mcp-bridge-tools.ts:50-51`), the worktree tool collapses separators and
refuses `.` (`worktree-tool-adapter.ts:264-267`), the executor collapses
separators (`task-executor.ts:413`). The regular expressions left on the
path (`/\/{2,}/gu`, `/\/$/u`) have a single quantified character and no
alternation, so they cannot backtrack polynomially.

### The case rule (decision entry "One task-path module in the domain …")

A letter-case variant never widens what is admitted: protected compares
folded, containment compares in the letter case the entry is written, and
overlap compares folded. Every comparison reads a path by what it names
(empty and `.` segments dropped). Folding is for comparison only. Unicode
lookalikes never reach the fold: the grammar is ASCII.

### The schema

`schemas/task-request/1.schema.json` does not change. The module's grammar
accepts exactly what the schema's `changeScope`, `protectedPaths` and gate
`cwd` patterns accept, proven on all 299,593 strings of up to six characters
over an alphabet with a separator, a backslash, a colon, a dot and a
non-ASCII letter (`tests/unit/task-path.test.mjs:210-220`). What changed is
how two paths compare, which is not a shape rule a schema can carry.
`LogicalPath` stays a different rule: each admits paths the other refuses
(`tests/unit/task-path.test.mjs:241-258`).

### Evidence at the module's interface

`tests/unit/task-path.test.mjs`, 107 cases, table-driven:

| Concern | Rows |
| --- | --- |
| Grammar: ordinary, `.`, separators, `..`, rooted, drive, backslash, whitespace, NUL, Unicode lookalikes (`ѕrc`, `ｓrc`, `.gıt`, `.GİT`, Kelvin sign), non-strings | `:24-65` |
| What a path names: `.`, `./`, trailing and doubled separators, `.` segments | `:72-80` |
| Containment: sibling prefix, parent, `.`, every spelling, case variants of a scope entry refused | `:89-108`, `:115-121` |
| Protected: case variants, every spelling, `.`, sibling prefix, empty list | `:126-146` |
| Git metadata at any depth and case; `.github`, `.gitignore` are not | `:153-165` |
| Overlap: either direction, case variants, `.` | `:174-183` |
| Schema parity | `:210-220` |
| Overlong path and 100,000-separator runs in bounded time | `:222-237` |

End to end: `tests/e2e/task-path-case-variant-e2e.test.mjs` (section 2)
passes unchanged on top of the refactor.

### Architecture test

`tests/architecture/task-path-locality.test.mjs` fails when a second copy
appears: the grammar's character set in any product source other than the
module (`:74-79`; the TUF publication grammar is a recorded exception, `:52-54`),
a prefix containment test or a spelled-out `.git` test in any source of the
task path (`:81-86`), or a stage that stops importing and calling the module
(`:88-117`).

Discrimination, each restored byte-for-byte (file hashes compared):

- removing the fold from the module fails 13 module cases;
- a string prefix in place of the segment prefix fails 5 module cases;
- a copy of the grammar pattern added to `gate-commit.ts` and a
  `startsWith(`${root}/`)` added to `task-run.ts` fail the architecture test,
  naming both files.

### Behaviour changes, all where stages disagreed

- A scope entry spelled `src/`, `./src` or `src//` now admits what it names
  in the executor, the gate and the context source, and `src/` in the read
  view; before, it admitted no write. `.` now admits the worktree in the
  executor and the gate, as the read view and the context source already
  read it. The bridge still refuses to open a read scope with a `.` segment
  or a doubled separator (`mcp-bridge-tools.ts:84-87`), so a mediated run
  with such a scope fails closed as before.
- A protected entry in such a spelling now hides what it names from the
  read view (the read-side half of section 2).
- The scheduler serializes tasks whose scopes differ only in case or one of
  whose scopes is `.`.
- No error code, message, stored path, digest or sealed record changes. The
  worktree identity still hashes the scope and protected paths as written
  (`git-worktree-adapter.ts:118-131`).

### Deleted case → replacement

| Deleted case (file at `origin/main`) | Property | Replacement |
| --- | --- | --- |
| `tests/unit/mcp-bridge-logical-path.test.mjs:43` "the linear logical-path check agrees with the replaced pattern on every short input" | The linear scan accepts what the lookahead pattern accepts | `tests/unit/task-path.test.mjs:210-220`, against the schema's own patterns on the same 299,593 inputs; the bridge's codes and segments stay pinned at `tests/unit/mcp-bridge-logical-path.test.mjs:15` |
| `tests/security/mcp-tool-bridge-security.test.mjs:83` read of `/etc/passwd` | A rooted path is not a task path | `tests/unit/task-path.test.mjs:37`; the bridge's refusal of an invalid path stays at `mcp-tool-bridge-security.test.mjs:82` (`../outside/victim.txt`) |
| `mcp-tool-bridge-security.test.mjs:84` read of `src/../docs/secret.txt` | A nested `..` is not a task path | `task-path.test.mjs:44` |
| `mcp-tool-bridge-security.test.mjs:86` read of `src/.GIT/config` | Git metadata at depth, in any case | `task-path.test.mjs:157`; the bridge's refusal stays at `mcp-tool-bridge-security.test.mjs:83` (`.git/config`) |
| `mcp-tool-bridge-security.test.mjs:89` read of `src/Protected/key.txt` | A case alias of a protected entry is protected | `task-path.test.mjs:132`; the read view's refusal stays at `mcp-tool-bridge-security.test.mjs:85` (`src/protected/key.txt`) |
| `tests/security/worktree-tool-security.test.mjs:25` `/etc/passwd`, `:26` `src/../../escape.txt`, `:27` `C:/windows/x`, `:28` `src\..\x` | Rooted, nested-parent, drive and backslash spellings are not task paths | `task-path.test.mjs:37`, `:45`, `:48`, `:50`; the adapter's refusal before any effect stays at `worktree-tool-security.test.mjs:23-29` |
| `worktree-tool-security.test.mjs:71` `src/.git/config`, `:72` `src/.GIT/config` | Git metadata at depth and in any case | `task-path.test.mjs:156-157`; the adapter's refusal stays at `worktree-tool-security.test.mjs:62-68` (`.git/hooks/pre-commit`) |
| `worktree-tool-security.test.mjs:74` `.Verchestra/Policy/x` | A case alias of a protected root is protected | `task-path.test.mjs:130`; the adapter's refusal stays at `worktree-tool-security.test.mjs:62-68` (`.verchestra/policy/rules.cedar`) |
| `tests/security/task-executor-security.test.mjs:27` `/absolute`, `:28` `C:/outside` | Not task paths | `task-path.test.mjs:38`, `:47`; the executor's refusal stays at `task-executor-security.test.mjs:25` (`../outside`) |
| `task-executor-security.test.mjs:30` `packages/application/src/executionish/file.ts` | A sibling sharing a prefix is outside the scope | `task-path.test.mjs:94`; the executor's refusal stays at `task-executor-security.test.mjs:25` (`packages/other/file.ts`) |
| `task-executor-security.test.mjs:53` `.git/config` | A path under a protected entry is protected | `task-path.test.mjs:131`; the executor's refusal stays at `task-executor-security.test.mjs:47` (`.verchestra/policy/builtin.cedar`) |

Each stage keeps one case that proves it asks the rule and refuses with its
own code before any effect; the architecture test proves it calls the
module.

### Guardrails

- Complexity: `pnpm complexity:update` rewrites `complexity-baseline.json`
  to the same bytes; no hotspot moved or rose.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- No sealed record changes: the Execution Package, review surface and Run
  Capsule digest the paths as written, and nothing stores a folded or
  normalized path.
- Migration count (12) and runtime error catalog (19) unchanged; no public
  error code added, removed or changed.
- The digest-bound reports of `credential-store.ts` are untouched.

### Citations fixed

- `.specs/STATE.md` (AD-014) and `.specs/features/dsse-attestation/migration.md`:
  `verification.ts:272` is now `:271`.
- `.specs/features/architecture-deepening/validation-c5.md`: the
  `verification.ts` lines move up one; `task-verifier.ts:200-229` is now
  `:206-235`.
- `.specs/features/live-task-pilot/validation.md`: `task-executor.ts:387-388`
  is now `:386-388`, `mcp-bridge-tools.ts:203` is now `:197`,
  `task-verifier.ts:66` is now `:72`.
- `.specs/features/platform-qualification-matrix/matrix.md`:
  `git-worktree-adapter.ts:367` is now `:366`.
- `.specs/features/governed-task-cli/validation.md` (GTC-12, 13, 14, 16, 17,
  18, 19) and `.specs/features/claude-code-2-1-282/validation.md` (CC-05):
  the bridge and worktree tool security cases at their new lines, and the
  moved cases at their rows in `tests/unit/task-path.test.mjs`. The
  `mcp-tool-bridge-security.test.mjs` citations were already off by a few
  lines at the base.

Not changed: `docs/qualification/t58-validation.md` cites
`task-executor-security.test.mjs` ranges that included the deleted cases; it
is a point-in-time qualification record. Records of earlier citation fixes
(`validation-c4.md:184`, `run-record-hardening/validation.md:214-219`) and
citations already stale at the base (`gate-repair-loop`,
`external-review-triage`) are left as they were.

## 4. Requirements → evidence

ADR2-1 asks for one module that every stage asks, the same decision at every
stage for a case variant of a protected path or a scope entry, and no pattern
that can backtrack polynomially. The rows below map it, and the task's
acceptance items, to evidence.

| Requirement | Evidence |
| --- | --- |
| ADR2-1: a case variant is decided the same way at every stage | Every stage that tests a protected path calls `isProtectedTaskPath` (folded) and every stage that tests scope calls `isWithinTaskScope` or `isWithinTaskPath` (as written): section 3 table, `task-path-locality.test.mjs:88-117`; the outcomes end to end in section 2 |
| Establish whether a case variant passes the task path, before changing behaviour | Section 1, committed before the fix; `tests/e2e/task-path-case-variant-e2e.test.mjs` fails 9 of 14 cases on that commit |
| A security defect is fixed in its own first commit, with a regression test that fails before it | Section 2; `task-path-case-variant-e2e.test.mjs:259-281`, `:286-324` |
| One module in `packages/domain` owns the grammar, containment, the protected test and the case rule | `packages/domain/src/primitives/task-path.ts:1-71`; decision entries in `.specs/STATE.md` |
| Every stage calls it; each still revalidates its own input | Section 3 table; `tests/architecture/task-path-locality.test.mjs:88-117` |
| No backtracking pattern on the path | `task-path.ts:16-27` (linear scan); `tests/unit/task-path.test.mjs:222-237`; the lookahead patterns are gone from every product source (`task-path-locality.test.mjs:74-79`) |
| The schema changes only through its canonical source, if needed | Not needed: `tests/unit/task-path.test.mjs:210-220` proves the grammar equals the schema's patterns |
| `LogicalPath` is not merged unless it is the same rule | It is not: `tests/unit/task-path.test.mjs:241-258` |
| One table-driven test at the module's interface | `tests/unit/task-path.test.mjs` (section 3) |
| End-to-end case-variant tests | `tests/e2e/task-path-case-variant-e2e.test.mjs` |
| Per-site tests that only re-prove the rule are deleted, with a record | Section 3, "Deleted case → replacement" |
| An architecture test fails when a second copy appears | `tests/architecture/task-path-locality.test.mjs`; discrimination in section 3 |
| Public codes and messages unchanged except where the fix needs a refusal | Only `.VERCHESTRA/x` against `.verchestra` moves from `VES_EXECUTOR_SCOPE_DENIED` to `VES_EXECUTOR_PROTECTED_PATH`, an existing code of the same stage |
| Sealed bytes unchanged; folding for comparison only | No stored or digested value changes; `git-worktree-adapter.ts:118-131` still hashes the paths as written |

## 5. Gates

macOS (Darwin 25.6.0), Node 24.14.0, run sequentially.

| Command | Commit | Result |
| --- | --- | --- |
| `node --test tests/e2e/task-path-case-variant-e2e.test.mjs` | evidence (`docs(specs)`) sources | FAIL 9 of 14, as section 1 records |
| `node --test tests/e2e/task-path-case-variant-e2e.test.mjs` | fix | PASS 14/14 |
| focused executor, gate, bridge, worktree tool and task CLI suites | fix | PASS 215/215 and 116/116 |
| `pnpm gate:quick` | fix | PASS (unit 2504/2504, agent-readiness 323/323, census 13/13) |
| `pnpm test:architecture` | fix | PASS 96/96 |
| `pnpm gate:quick` | refactor | PASS (unit 2610/2610, agent-readiness 323/323, census 13/13) |
| `pnpm test:architecture` | refactor | PASS 109/109 |
| `pnpm gate:build` | tip | PASS (unit 2610, contract 782, integration 1056, e2e 275, architecture 109, build 146, qualification 329; no failure, no skip) |
| `pnpm gate:security` | tip | PASS (unit 2610, contract 782, e2e 275, architecture 109, qualification 329, security 1324, fault 310; no failure, no skip) |
| `pnpm test:fault` | tip | PASS 310/310 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | tip | PASS 46/46 |
| `pnpm site:check` (the quick start changed) | tip | PASS |
| `pnpm agent:check` | tip | PASS |
