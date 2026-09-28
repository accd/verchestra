# OS Secret Backend Validation

Author validation on `feat/os-secret-backend`. No independent verifier has
reviewed it yet, and none is claimed.

| Requirement | Evidence (file:line — assertion) | Result |
| --- | --- | --- |
| OSB-01 | `tests/security/os-secret-backend-security.test.mjs:287` credential evidence and non-exportable-free controls are refused by `QualifiedOsSecretAdapter`; the credential vocabulary never claims `non-exportable`. `:322` credential contract is darwin-only and requires every control. | PASS |
| OSB-02 | `tests/unit/os-secret-backend-darwin.test.mjs:27` presence args are exactly `find-generic-password -s -a`; `:48` exit 0/44/other mapping; `:150` `-g` read decodes quoted and `0x` forms; `:175` delete 0/44/other. | PASS |
| OSB-03 | `tests/security/os-secret-backend-security.test.mjs:94` value absent from every argv and output, present only on one stdin; `:108` child environment allowlist; `:128` errors carry no child output. | PASS |
| OSB-04 | `tests/unit/os-secret-backend-darwin.test.mjs:186` worst-case line fits 4095 bytes and the budget is tight; `:195` oversize value spawns nothing; `tests/security/os-secret-backend-security.test.mjs:149` oversize never on stderr; `tests/integration/os-secret-backend-darwin-keychain.test.mjs:102` real tool untouched. | PASS |
| OSB-05 | `tests/unit/os-secret-backend-darwin.test.mjs:228` path syntax; `:242` missing, plain, directory, and symlink refused before any spawn, for every operation; `tests/integration/os-secret-backend-darwin-keychain.test.mjs:71` real fallback guard with a login-keychain lookup returning 44. | PASS |
| OSB-06 | `tests/unit/os-secret-backend-darwin.test.mjs:77` rotation sequence is find, delete, add, find; `:90` no `-U`, `-A`, or partition-list change, and `-T` only for the tool on add; `:107` failed add after delete is `VES_SECRET_ROTATION_INCOMPLETE`; `tests/security/os-secret-backend-security.test.mjs:185` same through `secret set`. | PASS |
| OSB-07 | `tests/unit/os-secret-backend-darwin.test.mjs:41` presence timeout below the doctor budget; `:122` timeout maps to `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`, including through the adapter; `tests/integration/os-secret-backend-darwin-keychain.test.mjs:120` the real runner kills at its timeout. | PASS |
| OSB-08 | `tests/security/os-secret-backend-security.test.mjs:347` digest equals SHA-256 of the report, which names every control and holds no machine path; `tests/unit/os-secret-backend-darwin.test.mjs:276` only darwin constructs a store. | PASS |
| OSB-09 | `tests/architecture/platform-node-secrets-subpath.test.mjs:76` and `:80` closures reach no `node:sqlite`, runtime store, or package root; `:86` `main.ts` imports the composition dynamically; `:97` doctor composition unchanged. | PASS |
| OSB-10 | `tests/unit/workspace-identity.test.mjs:34` round trip with `buildCanonicalInitFiles`; `:39` absent; `:46` and `:65` fail closed. | PASS |
| OSB-11 | `tests/unit/secret-cli-input.test.mjs:45` hidden TTY entry restores the terminal and never echoes; `:66` one trailing newline stripped; `tests/security/os-secret-backend-security.test.mjs:227` name validation before any spawn; `:240` uninitialized directory refused; `:247` unqualified platform refused; `tests/e2e/secret-cli-e2e.test.mjs:63` binary journey. | PASS |
| OSB-12 | `tests/integration/doctor-secret-backend.test.mjs:42` bound is `pass`; `:61` unbound is `blocked`; `:66` another Workspace does not count; `:77` unanswering store is `fail`; `:85` the doctor never asks for the value; `tests/security/os-secret-backend-security.test.mjs:265` closure exposes only `has`. | PASS |
| OSB-13 | `tests/helpers/disposable-keychain.mjs` random password, unlock, no auto-lock, search list and default proven unchanged, timeout on every call; the integration and e2e files assert a login-keychain lookup returns 44 after every darwin case, and assert refusal instead of skipping elsewhere. | PASS |

## Discrimination sensor

Each mutant was applied to the committed source, run against the fake-runner
suites (`os-secret-backend-darwin`, `os-secret-backend-security`,
`doctor-secret-backend`, `secret-cli-input`, `workspace-identity`; baseline 50
pass), and restored from Git.

| Mutant | Failing tests |
| --- | --- |
| M1 add updates in place with `-U` | 3 |
| M2 explicit keychain re-proof skipped | 1 |
| M3 value budget raised by 10 bytes | 1 |
| M4 read failure carries the child's stderr | 1 |
| M5 presence lookup requests the value (`-g`) | 4 |
| M6 failed rotation not reported distinctly | 2 |
| M7 timeout not mapped to interaction-required | 2 |
| M8 doctor receives the full adapter | 1 |
| M9 piped newline not stripped | 4 |
| M10 key-material contract drops `non-exportable` | 1 |
| M11 namespace not bound to the Workspace | 4 |

11 killed, 0 survived.
