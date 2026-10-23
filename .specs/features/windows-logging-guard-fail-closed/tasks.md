# Windows logging-policy guard fails closed: tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Reproduce: the real write program in Constrained Language Mode reaches its payload line and exits 0 | one-off probe on Windows 11, PowerShell 5.1 | Complete |
| T2 | Tests first: the guard's shape, the gate line and its position, exit 3 as `VES_SECRET_STORE_LOGGED`; two real cases in the spike | unit and spike cases red on the base revision | Complete |
| T3 | The language-mode refusal and passed marker in the guard, the gate line in reads and writes, the exit-3 outcome | unit 15/15; both real cases green; the no-gate mutant killed by the real full-language case | Complete |
| T4 | XOS-05 and AD-041 updated | `pnpm agent:check` | Complete |
| T5 | The three `credential-store` legs of `os-credential-store.yml` green on the pull request head | CI | Complete: run 39981691267 on `4917651`, all three legs green; the Windows leg ran both new cases, `qualify:keychain` 22 of 22, 0 skipped |

## Delivery rule

Merge only after review and every required check, including the three
`credential-store` legs, green on the exact head.
