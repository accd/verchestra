# Strands Subscription Integration Validation

**Verdict**: PENDING — no implementation task has run. This file holds the
evidence of T1 and T2 and the empty evidence rows that T3–T9 fill. The
independent verifier (author ≠ verifier) fills the verdict after T8, against
`spec.md`, with the discrimination list below.

**Diff range for verification**: `7e274f237648251b972081471134623097122c16..<T9 head>`

## T1 and T2 Evidence

| Check | Command or source | Result |
| --- | --- | --- |
| Base revision | `git rev-parse HEAD` in the new worktree | `7e274f237648251b972081471134623097122c16`, equal to the plan's analysed remote HEAD |
| Install | `pnpm install --frozen-lockfile` (Node 24.14.0, pnpm 10.34.5) | PASS |
| Spec structure | `python3 <tlc-spec-driven>/scripts/validate_spec.py spec.md` | 0 errors, 0 warnings |
| Task structure | `python3 <tlc-spec-driven>/scripts/validate_tasks.py tasks.md` | 0 errors; 1 warning (T1 has no code layer, as the matrix says) |
| Skill copies | SHA-256 of the 39 installed files against the inventory | 39 of 39 match; no extra file |
| Readiness | `pnpm agent:check` | Recorded in `handoff.md` `lastGate` |
| Quick gate | `pnpm gate:quick` | Recorded in `handoff.md` `lastGate` |
| Probes | Scratch install, import, run, and bundle probes in the ignored `.tmp/` (`research.md` S5–S9) | No file outside `.tmp/` changed; `git status` clean apart from this feature's files |

## Requirement Evidence

Each row needs a file-and-assertion citation (`path:line` and what the assertion
checks), the gate run that executed it, and PASS or FAIL. A row without
evidence is FAIL.

| Requirement | Evidence (file:line, assertion) | Gate run | Verdict |
| --- | --- | --- | --- |
| SSI-01 | — | — | — |
| SSI-02 | — | — | — |
| SSI-03 | — | — | — |
| SSI-04 | — | — | — |
| SSI-05 | — | — | — |
| SSI-06 | — | — | — |
| SSI-07 | — | — | — |
| SSI-08 | — | — | — |
| SSI-09 | — | — | — |
| SSI-10 | — | — | — |
| SSI-11 | — | — | — |
| SSI-12 | — | — | — |
| SSI-13 | — | — | — |
| SSI-14 | — | — | — |
| SSI-15 | — | — | — |
| SSI-16 | — | — | — |
| SSI-17 | — | — | — |
| SSI-18 | — | — | — |
| SSI-19 | — | — | — |
| SSI-20 | — | — | — |
| SSI-21 | — | — | — |
| SSI-22 | — | — | — |
| SSI-23 | — | — | — |
| SSI-24 | — | — | — |
| SSI-25 | — | — | — |
| SSI-26 | — | — | — |
| SSI-27 | — | — | — |
| SSI-28 | — | — | — |
| SSI-29 | — | — | — |
| SSI-30 | — | — | — |
| SSI-31 | — | — | — |
| SSI-32 | — | — | — |
| SSI-33 | — | — | — |
| SSI-34 | — | — | — |
| SSI-35 | — | — | — |
| SSI-36 | — | — | — |
| SSI-37 | — | — | — |
| SSI-38 | — | — | — |
| SSI-39 | — | — | — |
| SSI-40 | — | — | — |
| SSI-41 | — | — | — |
| SSI-42 | — | — | — |
| SSI-43 | — | — | — |
| SSI-44 | — | — | — |
| SSI-45 | — | — | — |
| SSI-46 | — | — | — |
| SSI-47 | — | — | — |
| SSI-48 | — | — | — |
| SSI-49 | — | — | — |
| SSI-50 | — | — | — |
| SSI-51 | — | — | — |
| SSI-52 | — | — | — |
| SSI-53 | — | — | — |
| SSI-54 | — | — | — |
| SSI-55 | — | — | — |
| SSI-56 | — | — | — |
| SSI-57 | — | — | — |
| SSI-58 | — | — | — |
| SSI-59 | — | — | — |
| SSI-60 | — | — | — |
| SSI-61 | — | — | — |
| SSI-62 | — | — | — |
| SSI-63 | — | — | — |
| SSI-64 | — | — | — |
| SSI-65 | — | — | — |
| SSI-66 | — | — | — |
| SSI-67 | — | — | — |
| SSI-68 | — | — | — |
| SSI-69 | — | — | — |
| SSI-70 | — | — | — |
| SSI-71 | — | — | — |
| SSI-72 | — | — | — |
| SSI-73 | — | — | — |
| SSI-74 | — | — | — |
| SSI-75 | — | — | — |
| SSI-76 | — | — | — |
| SSI-77 | — | — | — |
| SSI-78 | — | — | — |
| SSI-79 | — | — | — |
| SSI-80 | — | — | — |
| SSI-81 | — | — | — |
| SSI-82 | — | — | — |
| SSI-83 | — | — | — |
| SSI-84 | — | — | — |
| SSI-85 | — | — | — |

## Discrimination Sensor (planned)

Each mutant is applied in a scratch worktree, the named suite is run, and the
mutant must be killed (a test fails). A surviving mutant becomes a fix task.

| Mutant | Requirement | Expected killer | Result |
| --- | --- | --- | --- |
| Drop one descriptor field from the canonical request before digesting | SSI-28 | Per-field binding-digest test | — |
| Accept a cycle in the graph normalizer | SSI-25 | Cycle rejection case | — |
| Let a write scope leave `task.changeScope` | SSI-26 | Scope rejection case | — |
| Skip node write-scope narrowing in the coordinated driver | SSI-41 | Out-of-node-scope write refused before the executor | — |
| Remove the writer mutex | SSI-40 | Two writers never overlap (instrumented fake) | — |
| Raise a default limit by one | SSI-37 | Limit boundary cases | — |
| Accept an undeclared handoff target | SSI-43 | Forbidden-destination swarm case | — |
| Persist a result before checking its size | SSI-47 | Oversized result leaves nothing persisted | — |
| Skip the `apiKeySource` check | SSI-54 | Fake init with `ANTHROPIC_API_KEY` | — |
| Skip the Codex `account/read` check | SSI-55 | Fake `apiKey` account | — |
| Allow `account/rateLimitResetCredit/consume` | SSI-57 | Method allowlist test | — |
| Skip the billing confirmation at resume | SSI-52 | Resume without confirmation is `not configured` | — |
| Clean up the worktree on `suspended` | SSI-60 | Suspended worktree survives | — |
| Re-run a partial node silently | SSI-66 | Uncertain-node refusal | — |
| Construct a Strands `Agent` in the adapter | SSI-03, SSI-79 | Architecture ban and empty-environment probe | — |
| Import the SDK root entry | SSI-02 | Architecture test and sealed build | — |

**Sensor result**: not run.

## Deleted Case → Replacement

None yet. Every test deleted by T3–T8 is listed here with the test at the
deepened interface that covers the same case.
