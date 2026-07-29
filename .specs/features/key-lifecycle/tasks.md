# Key Lifecycle Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | `KeyProviderPort` contract and public error codes | None | Contract tests |
| T2 | `EncryptedFileKeyProvider` adapter (KEY-01, KEY-02, KEY-07) | T1 | Unit + security tests |
| T3 | Rotation with overlap window and revocation (KEY-03, KEY-04) | T2 | Unit + fault-injection tests |
| T4 | Composition-root wiring in `apps/vestra-cli` (KEY-05) | T2 | Integration tests; no direct `NodeEd25519Signer` construction in product code |
| T5 | Two-environment portability proof + demo transcript (KEY-06, R13) | T3, T4 | New e2e test; recorded demo |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Full | `pnpm gate:full` |
| Security | `pnpm gate:security` |

## Completion Rules

- No new runtime dependency for the file adapter; `node:crypto` only.
- Fail-closed error codes documented in the public error schema through the
  schema generator, never by editing generated output.
- Qualification evidence recorded under `docs/qualification/` as task T68a.

## Execution Evidence

| Task | Status   | Evidence                                                                                                                   |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| T1   | Complete | `pnpm test:contract` (440 passed), `pnpm typecheck`, and `pnpm gate:quick` (1,620 unit tests + 64 readiness tests) passed. |
| T2   | Complete | `pnpm gate:quick` (1,624 unit tests + 64 readiness tests) and `pnpm test:security` (914 passed) passed.                 |
| T3   | Complete | `pnpm gate:quick` (1,628 unit tests + 64 readiness tests) and `pnpm test:security` (915 passed) passed.                 |
| T4   | Pending  | —                                                                                                                          |
| T5   | Pending  | —                                                                                                                          |
