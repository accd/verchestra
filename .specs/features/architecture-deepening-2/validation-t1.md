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
`.verchestra` alone (`apps/vestra-cli/src/task/task-run.ts:334`).

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
one function:

- `packages/application/src/execution/task-executor.ts:385-397`:
  `isProtectedTaskPath` drops empty and `.` segments, folds case, and asks
  whether a protected entry's segments are a prefix of the target's.
  `assertTarget` (`:402`) uses it before every tool effect and for every
  inspected change.
- `packages/application/src/execution/gate-commit.ts:560`: the gate's
  inspection check uses the same function.

No error code or message changes. The scope test is untouched. Nothing that
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
