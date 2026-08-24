# T76 TUF Publication Validation

This validation covers the incremental publisher and verifier boundary only.

| Requirement | Evidence                                                                                                                                | Result |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TP-01       | `tests/build/tuf-publication.test.mjs` signed root/delegation and target-map assertions                                                 | PASS   |
| TP-02       | `tests/build/tuf-publication.test.mjs` resolves online/mirror/offline/air-gapped and non-consistent snapshots through `TufUpdateClient` | PASS   |
| TP-03       | `tests/security/tuf-publication-security.test.mjs` threshold, expiry, incomplete, duplicate, and byte-mismatch assertions               | PASS   |
| TP-04       | `tests/security/tuf-publication-security.test.mjs` post-publication target tamper rejection with activation denied                      | PASS   |

Focused result: 16 passed, 0 failed/skipped/todo. Typecheck, `agent:check`,
complexity, ESLint, Prettier, and `git diff --check` pass.

Full gates on this branch:

- `gate:quick` PASS — 2,093 unit tests and 153 readiness tests; zero
  failures/skips/todos.
- `gate:release` PASS — 2,093 unit, 39 architecture, 251 qualification,
  1,077 security, 284 fault, and 28 release tests; zero
  failures/skips/todos.

Test adequacy review:

| Requirement | Happy-path assertion                                                                                                                                 | Failure-path assertion                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| TP-01       | `tests/build/tuf-publication.test.mjs:27-38` verifies signed root, delegated metadata, target count, and complete staged bundle                      | `tests/security/tuf-publication-security.test.mjs:23-38` rejects incomplete, duplicate, and digest-mismatched bytes                                   |
| TP-02       | `tests/build/tuf-publication.test.mjs:33-39` resolves online, mirror, offline, and air-gapped modes; `:59-73` verifies non-consistent snapshot paths | `tests/security/tuf-publication-security.test.mjs:41-48` rejects unattainable threshold and expired metadata                                          |
| TP-03       | `tests/build/tuf-publication.test.mjs:42-57` proves order-independent publication identity                                                           | `tests/security/tuf-publication-security.test.mjs:23-48` covers all input validation codes                                                            |
| TP-04       | `tests/build/tuf-publication.test.mjs:27-39` stages only verified bundle bytes                                                                       | `tests/security/tuf-publication-security.test.mjs:51-75` rejects same-length target tampering with `VES_TUF_INTEGRITY` and `activationAllowed: false` |

Reverse mapping: every focused assertion is claimed by TP-01 through TP-04;
there are no unclaimed tests, skipped tests, TODOs, or vacuous assertions.
The test surfaces follow `packages/AGENTS.md` and `tests/AGENTS.md`; fixtures
use ephemeral in-process signing keys only and do not access repository or CI
secrets.

This is an incremental unsigned-key-custody boundary. Independent review,
public publication, rollback evidence, and the remaining T76 requirements are
still required; this change does not close #17 or advance T77.
