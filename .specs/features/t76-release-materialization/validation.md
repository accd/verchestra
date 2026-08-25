# T76 Release Materialization Validation

This validation covers only the isolated-build-to-bundle materialization
boundary and does not claim #17 completion.

| Requirement | Evidence                                                                                                                                                                              | Result |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| RM-01       | `tests/build/release-materializer.test.mjs:52-71` and `tests/security/release-materializer-security.test.mjs:95-109` assert retained bytes and change-sensitive identities            | PASS   |
| RM-02       | `tests/build/release-materializer.test.mjs:56-65` verifies four generated evidence documents and complete bundle closure                                                              | PASS   |
| RM-03       | `tests/build/release-materializer.test.mjs:77-90` proves order-independent identity, bytes, and finding preservation                                                                  | PASS   |
| RM-04       | `tests/security/release-materializer-security.test.mjs:48-109` rejects generated inputs/collisions, preserves failed mutant findings, and kills source-byte tampering                 | PASS   |
| RM-05       | `tests/build/materialized-tuf-publication.test.mjs:78-150,161-209` binds materialized bytes to a candidate/TUF publication, resolves all four modes, and verifies activation/rollback | PASS   |
| RM-06       | `tests/build/tuf-publication.test.mjs:79-115` verifies separate metadata/targets trees, byte preservation, atomic destination commit, and traversal rejection                         | PASS   |

Focused materializer/TUF result: 15 passed, 0 failed/skipped/todo (the
aggregate artifact/census suite ran 21 passed). Typecheck, `agent:check`,
complexity, ESLint, Prettier, and `git diff --check` pass.

Full gates:

- `gate:quick` PASS — 2,093 unit tests and 153 readiness tests; zero
  failures/skips/todos.
- `gate:release` PASS — 2,093 unit, 39 architecture, 251 qualification,
  1,077 security, 284 fault, and 28 release tests; zero
  failures/skips/todos.

The focused assertions map one-to-one to RM-01 through RM-06; no test is
unclaimed, skipped, todo, or used as a vacuous pass. Independent rollback
evidence and T76 review remain required before #17 can close.
