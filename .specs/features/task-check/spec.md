# Task check: every task prerequisite in one command (#593)

## Status

Owner decision of 2026-10-26: issue #593 asked `doctor` to probe the task
prerequisites. `doctor` is a qualified, closed, read-only catalog (T72). It
stays `BLOCKED` on every tester machine because of the fixture-provisioned
subsystems (cedar-policy, driver, connector, probe, sandbox, sqlite,
secret-presence, native-asset in source mode). It may start only
`git --version` (`tests/architecture/doctor-readonly-graph.test.mjs`), and it
may not import `@verchestra/drivers`. The owner chose a new
`vestra task check` instead, and left `doctor` unchanged.

## Problem

Today a tester learns about the task prerequisites one refusal at a time:
`task plan` stops at the first missing piece, then `task start` stops at the
next. Each refusal names one `requirement` and its recovery, and the next one
appears only after the first is fixed.

## Requirements

| ID | Requirement |
| --- | --- |
| TCK-01 | `vestra task check --request <file>` runs every check below, in the order listed, and does not stop at the first check that is not ready. |
| TCK-02 | Each check reports `ready`, `missing`, or `not-checked`. `not-checked` means a check it depends on is missing, so it could not be judged, and it names that check in `dependsOn`. A `missing` check carries the stable `code`, the safe `details` (the `requirement`, for a `not configured` refusal), and the `recovery` of the refusal that `task plan` or `task start` gives for the same missing piece. |
| TCK-03 | The data is `{ ready, checks: [{ check, status, code?, details?, recovery?, dependsOn? }] }`, and `ready` is true only when every check is `ready`. Each check that is not ready also prints one stderr line: `missing <check>: CODE (k=v): recovery`, or `not-checked <check>: waits for <check>`. The exit code is 0 when ready and 4 otherwise; an argument error stays 2. |
| TCK-04 | The checks, in order: `workspace`; `request`; `source-revision`; `task-policy`; `provider-modes`; `gate-allowlist`; `api-key-models`; `billing` (a v2 request only); one `credential:<name>` for each credential the provider modes need (`credential:providers`, not checked, while they are unknown), then `credential:evidence-signing-passphrase`; `executable:claude` (when the request runs Claude Code) and `executable:codex`; `codex-login` (when the verifier runs on a subscription); `windows` (on win32, when the request runs Claude Code). |
| TCK-05 | A credential is checked for presence only: no credential value is read. No provider session starts. The only children are each provider's `--version` and `codex login status` in a temporary home outside the Workspace. Nothing is written to the repository. Workspace state is not created, except the sessions directory that the Windows check probes, as `task start` does. Every Workspace state directory that exists must resolve inside its owner, as `ensureWorkspaceState` proves for `task plan`; a link that escapes makes `workspace` missing before anything is probed through it. A Codex identity directory that exists must be a real directory, never a link, as `ensureCodexIdentity` requires for `task start`; otherwise `codex-login` is missing with requirement `codex-identity`. The printed login command creates the directory, as the quick start does. |
| TCK-06 | An executable's version is judged by its driver's own probe, against the minimum the run applies: the mediated Claude Code minimum, and the Codex default for a v1 request or the structured minimum for a v2 one. A request that could not be read names no schema version, so Codex is then judged at the v1 floor. |
| TCK-07 | The README task section, the quick start, and the CHANGELOG name `task check`. The README exit-code row 4 names it. |

## Surface

| Route | In | Out | Statuses |
| --- | --- | --- | --- |
| `vestra task check` | `--request <file>` (required), `--keychain <path>` (macOS, as the other task commands) | the TCK-03 data; one stderr line per check that is not ready | exit 0 ready; 4 not ready; 2 argument error |

## Out of scope

| Excluded | Why |
| --- | --- |
| What only planning proves: the compiled task context and the sealed Execution Package | `task plan --dry-run` proves them; `ready` means every prerequisite above, not that planning succeeds |
| Whether the Codex account offers the request's models | it needs a Codex session; `task start` keeps that check (AD-085) |
| Whether the Claude Code token is still valid | it needs a provider call |
| Any change to `doctor` | see Status |
| A human-friendly table renderer | the stderr lines carry the recovery; the data stays the CLI's `key: value` form |
