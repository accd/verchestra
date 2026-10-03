# Validation: T10, the credential value limit is defined once (ADR2-10)

The 2026-10-02 review found the first round's C8 residue: the credential value
limit existed twice, as `VALUE_LIMIT_BYTES = 1416` in
`credential-tool.ts` and as `MAX_CREDENTIAL_VALUE_BYTES` derived in
`darwin-keychain.ts`, held equal by a test, and the CLI sized its input
buffer from the darwin constant.

| ADR2-10 clause | Where it holds | Assertion evidence |
| --- | --- | --- |
| The limit is defined once | `packages/platform-node/src/os-secret-backends/credential-tool.ts:183` `export const MAX_CREDENTIAL_VALUE_BYTES = 1416`, the policy every platform shares; `isValidCredentialValue` (`:187`) reads it | `tests/unit/os-secret-backend-policy.test.mjs` "the value policy admits exactly the byte budget the darwin backend derives": 1416, a value of exactly that many bytes is valid, one more is not |
| The keychain's capacity is a different fact, held equal | `darwin-keychain.ts:85` `KEYCHAIN_VALUE_BUDGET_BYTES`, derived from the `security -i` line limit and the longest accepted locator | the same case now asserts `KEYCHAIN_VALUE_BUDGET_BYTES === MAX_CREDENTIAL_VALUE_BYTES` |
| The CLI sizes its buffer from that definition | `apps/vestra-cli/src/secret-composition.ts:70` reads `MAX_CREDENTIAL_VALUE_BYTES`, which `@verchestra/platform-node` and its `./secrets` subpath now export from `credential-tool.ts` | `tests/unit/secret-cli-input.test.mjs`: a value of exactly the limit is read whole, a longer one is refused |

No value, message, error code or behaviour changes; only where the number is
defined and which module exports it. The digest-bound qualification reports in
`credential-store.ts` are unchanged. Three line citations in
`validation-c8.md` moved with the code.

Gates (Node 24.14.0, macOS arm64): the credential suites (96), `gate:quick`,
`test:architecture` (109) and `agent:check` PASS.
