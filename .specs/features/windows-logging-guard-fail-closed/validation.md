# Windows logging-policy guard fails closed: validation

**Date:** 2026-10-23
**Diff:** `fix/565-logging-guard-fail-closed` from `a31b941`
**Host:** Windows 11 Pro x64, Windows PowerShell 5.1, Node 24.14.0, a standard
user session that is not elevated.
**Verifier:** the implementing agent's local pass; review and the three
`credential-store` legs on the pull request head remain required (T5).

## Reproduction before the change (T1)

A one-off probe ran the backend's real write program through the real runner,
with `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'`
prepended and a `Write-Output` marker inserted after the payload line. On the
base revision: the write failed as `VES_SECRET_BACKEND_FAILURE`, PowerShell
exited 0, and the marker was printed, so the payload line ran. After the change:
`VES_SECRET_STORE_LOGGED`, exit 3, no marker.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| LGF-01 | `tests/unit/os-secret-backend-windows.test.mjs`, "the gate ends the program unless the guard ran to its end" and "a machine that records PowerShell input or output …": guard, gate, then the payload line; reads carry the gate before the call ("the program is one complete statement per line …"). | PASS |
| LGF-02 | "the logging-policy guard checks …": the guard starts with the `FullLanguage` refusal and ends with `$verchestraGuardPassed = $true`. | PASS |
| LGF-03 | "a guard that could not run to its end (exit 3) refuses as logged, never as a generic failure (#565)": reads and writes. | PASS |
| LGF-04 | `spikes/os-secret-store/test/credential-manager-backend.test.mjs`, "win32: in Constrained Language Mode a write ends before its payload line and is refused as logged" and "win32: a guard that throws in full language mode still ends the write before its payload line": exit 3, no marker, nothing listed by `cmdkey`. Both green on the host above; both red on the base revision. | PASS (locally, and on CI run 39981691267: Linux, macOS and Windows legs green; the Windows leg ran both cases, 22 of 22, 0 skipped) |
| LGF-05 | The shape tests keep the preamble, the guard and the value line in order; delete carries neither guard nor gate. | PASS |

## Discrimination sensor

A mutant that drops the gate line from the write program fails two unit tests
and the real full-language case (the payload line ran and the write went
through). The Constrained Language Mode case alone does not kill that mutant,
because the guard's own language-mode refusal also ends the program there; the
two defenses are each covered by their own real case. The source was restored
after the run.

## Named-pipe helper

The helper embeds the guard, so its pinned digest moved from `933d8330…` to
`7f48f1b7…`, with the reason recorded beside the pin. With the new guard the
real helper still passes `tests/security/windows-pipe-bridge-security.test.mjs`
17 of 17 and `tests/unit/task-windows.test.mjs` 15 of 15 on this host.

## Gates on this host

Recorded on the pull request; the stages run as for #555, with the same
environment cases of this host (symbolic-link privilege, the temporary
directory under the home directory).
