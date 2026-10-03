# Validation: T11, the timestamp refresh derives its ledger entry through the ledger module (ADR2-11)

The 2026-10-02 review found the first round's C7 residue: a release derived its
ledger entry through `admitRelease`, but the timestamp refresh asserted its
admission (`assertRefreshAdmitted`) and then assembled its role-refresh entry
by hand with `nextLedgerEntry` (`scripts/t76-refresh-timestamp.mjs`,
`ledgerEntryFor`).

| ADR2-11 clause | Where it holds | Assertion evidence |
| --- | --- | --- |
| The refresh is admitted and its entry derived in one step | `scripts/tuf-publication-ledger.mjs` `admitRefresh`: `assertRefreshAdmitted`, then `nextLedgerEntry` with the kind, the chain fields, the null `urlPrefix` and `rootDigestPrefix`, and the two online roles derived | `tests/agent-readiness/tuf-publication-ledger.test.mjs` "the refresh admission refuses what assertRefreshAdmitted refuses and derives the role-refresh entry": the entry is pinned field by field, chained to the newest committed entry, never aliases the caller's evidence list; each of the three refusals (`VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC`, `VES_T76_REFRESH_TARGETS_CHANGED`, `VES_T76_REFRESH_LINEAGE_UNKNOWN`) is raised by both functions on the same input; an unrecordable run id is `VES_T76_PUBLISH_LEDGER_INVALID` |
| The refresh assembles no entry itself | `scripts/t76-refresh-timestamp.mjs` calls `admitRefresh` at the point it called `assertRefreshAdmitted`, and writes the entry it returns | "the timestamp refresh takes its ledger entry from the admission and builds none itself"; `tests/build/t76-timestamp-refresh.test.mjs` passes unmodified, including its `ledger-entry.json` checks |

Behaviour: the same refusals in the same order, the same entry bytes. The
entry is now validated at admission, before any re-signing, instead of after
it; a refusal still leaves nothing written. No line citation moved (the new
function follows every cited line).

Gates (Node 24.14.0, macOS arm64): the ledger, refresh and refresh-workflow
suites (43), `gate:quick`, `gate:release` and `agent:check` PASS.
