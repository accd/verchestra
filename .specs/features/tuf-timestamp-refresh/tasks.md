# TUF timestamp refresh tasks

1. **T1 (TR-08)**: factor snapshot and timestamp signing into one routine with
   per-role versions, and prove the existing publication bytes are unchanged.
   Status: done.
2. **T2 (TR-02, TR-03, TR-05, TR-12)**: add `buildTufOnlineRoleRefresh` to the
   distribution publication module. It verifies the published offline metadata,
   binds the online signers, and signs only timestamp and snapshot. Add the
   security tests. Status: done.
3. **T3 (TR-01 to TR-07)**: add `scripts/t76-refresh-timestamp.mjs` with ledger
   admission, the manifest, and ledger-entry emission. Add the ledger helpers
   `assertRefreshAdmitted`, `nextLedgerEntry`, and `assertLedgerPrefix`, and the
   build round-trip and refusal tests. Status: done.
4. **T4 (TR-09 to TR-11)**: add `t76-refresh-timestamp.yml`. Give the publish
   workflow the `timestamp_expires` input and make both workflows read the
   ledger from main. Add the workflow shape tests. Status: done.
5. **T5 (TR-13)**: update the runbook, the tuf-role-separation handoff, and the
   canonical-JSON census. Record the gates in `validation.md`. Status: done.
