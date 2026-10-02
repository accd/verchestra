# OS Secret Backend Validation

Author validation on `feat/os-secret-backend`. No independent verifier has
reviewed it yet, and none is claimed. Gate evidence never spawns
`/usr/bin/security`. The real-keychain qualification (OSB-14) is **pending**.

**Superseded in part by AD-041:** Linux and Windows now construct qualified
credential stores, so "only darwin constructs a store" (OSB-08) and the
"unqualified platform" cases below now use platforms without a store (such as
`freebsd`). The line references below were recorded before that change; the
current evidence for all three platforms is
`.specs/features/os-secret-backend-cross-platform/validation.md`.

| Requirement | Evidence (file:line — assertion) | Result |
| --- | --- | --- |
| OSB-01 | `tests/security/os-secret-backend-security.test.mjs:361`: credential evidence and controls without non-exportable are refused by `QualifiedOsSecretAdapter`, and the credential vocabulary never claims `non-exportable`. `:396`: the credential contract is darwin-only and requires every control. | PASS |
| OSB-02 | `tests/unit/os-secret-backend-darwin.test.mjs:25`: presence args are exactly `find-generic-password -s -a`. `:39`: exit 0/44/other mapping. `:137`: `-g` read decodes the quoted and `0x` forms. `:162`: delete 0/44/other. | PASS |
| OSB-03 | `tests/security/os-secret-backend-security.test.mjs:96`: the value is absent from every argv and output and present only on one stdin. `:140`: child environment allowlist. `:160`: errors carry no child output. | PASS |
| OSB-04 | `tests/unit/os-secret-backend-darwin.test.mjs:173`: the worst-case line fits 4095 bytes and the budget is tight. `:182`: an oversize value spawns nothing. `tests/security/os-secret-backend-security.test.mjs:181`: an oversize value never reaches stderr. `tests/e2e/secret-cli-e2e.test.mjs:88`: through the binary. | PASS |
| OSB-05 | `tests/unit/os-secret-backend-darwin.test.mjs:193`: path syntax. `:207`: missing, plain, directory, and symlink paths are refused before any spawn, for every operation. `tests/e2e/secret-cli-e2e.test.mjs:100`: the same for every `secret` command through the binary. | PASS |
| OSB-06 | `tests/unit/os-secret-backend-darwin.test.mjs:68`: the rotation sequence is find, delete, add, find. `:81`: no `-U`, `-A`, or partition-list change, and `-T` only for the tool on add. `:98`: a failed add after a delete is `VES_SECRET_ROTATION_INCOMPLETE`. `tests/security/os-secret-backend-security.test.mjs:217`: the same through `secret set`. | PASS |
| OSB-07 | `tests/unit/os-secret-backend-policy.test.mjs:82`: the presence timeout is below the doctor budget. `tests/unit/os-secret-backend-darwin.test.mjs:113`: a timeout maps to `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`, including through the adapter. `tests/security/os-secret-backend-security.test.mjs:236`: through every `secret` command. | PASS |
| OSB-08 | `tests/security/os-secret-backend-security.test.mjs:421`: the digest equals the report's SHA-256, and the report names every control and holds no machine path. `tests/unit/os-secret-backend-darwin.test.mjs:241`: only darwin constructs a store. | PASS |
| OSB-09 | `tests/architecture/platform-node-secrets-subpath.test.mjs:77` and `:81`: the closures reach no `node:sqlite`, runtime store, or package root. `:87`: `main.ts` imports the composition dynamically. `:99`: the doctor composition is unchanged. | PASS |
| OSB-10 | `tests/unit/workspace-identity.test.mjs:34`: round trip with `buildCanonicalInitFiles`. `:39`: absent. `:46` and `:65`: fail closed. | PASS |
| OSB-11 | `tests/unit/secret-cli-input.test.mjs:46`: hidden TTY entry restores the terminal and never echoes. `:67`: exactly one trailing newline is stripped. `tests/security/os-secret-backend-security.test.mjs:293`: name validation before any spawn. `:306`: an uninitialized directory is refused. `:313`: an unqualified platform is refused. `:245`: `--keychain` reaches every invocation. `tests/e2e/secret-cli-e2e.test.mjs:118`: the same through the binary. | PASS |
| OSB-12 | `tests/integration/doctor-secret-backend.test.mjs:62`: bound is `pass`. `:81`: unbound is `blocked`. `:86`: another Workspace does not count. `:97`: a store that cannot answer is `fail`. `:105`: the doctor never asks for the value. `tests/security/os-secret-backend-security.test.mjs:331`: the closure exposes only `has`. | PASS |
| OSB-13 | `tests/architecture/no-keychain-spawn-in-tests.test.mjs:42`: no gate test names the real runner. `:47`: none spawns the tool. `:53`: every test that can reach a store installs `tests/helpers/deny-keychain-spawn.mjs`. `:69`: the guard throws in process. `tests/e2e/secret-cli-e2e.test.mjs:73`: the guard throws in a preloaded child. | PASS |
| OSB-14 | `spikes/os-secret-store/test/keychain-backend.test.mjs` and `credential-cli.test.mjs` (renamed from `keychain-cli.test.mjs` by AD-041), run by `corepack pnpm qualify:keychain` only. `tests/architecture/no-keychain-spawn-in-tests.test.mjs:74`: no other script runs them. | PENDING — owner run on an unlocked macOS session |

## Discrimination sensor

Each mutant was applied to the committed source, run against the fake-runner
suites (`os-secret-backend-darwin`, `os-secret-backend-security`,
`doctor-secret-backend`, `secret-cli-input`, `workspace-identity`; baseline 51
pass, with the spawn guard loaded), and restored from Git.

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
| M12 CLI drops `--keychain` before the store | 1 |

12 killed, 0 survived.

## Gates on this branch

- `pnpm gate:quick`: PASS.
- `pnpm gate:build`: PASS (unit 2194, contract 541, integration 668, e2e 197,
  architecture 61, build 103, qualification 254; 0 failed, 0 skipped, 0 todo).
- `pnpm gate:security`: PASS (adds security 1197 and fault 300; 0 failed,
  0 skipped, 0 todo).
- `pnpm agent:check`: PASS.
