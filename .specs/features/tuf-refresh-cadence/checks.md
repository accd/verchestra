# TUF refresh cadence checks

Build: `node --check scripts/t76-refresh-timestamp.mjs`; `corepack pnpm exec prettier --check scripts/t76-refresh-timestamp.mjs tests/build/t76-timestamp-refresh.test.mjs tests/agent-readiness/t76-refresh-workflow.test.mjs`; `corepack pnpm exec eslint scripts/t76-refresh-timestamp.mjs tests/build/t76-timestamp-refresh.test.mjs tests/agent-readiness/t76-refresh-workflow.test.mjs`
Run refresh: `node --test --test-reporter=spec tests/build/t76-timestamp-refresh.test.mjs tests/agent-readiness/t76-refresh-workflow.test.mjs`

## Intent

Today the online `timestamp.json` and `snapshot.json` of the live `.8` and `.9` releases expire with
the publication horizon, `2027-09-30T00:00:00Z`. `t76-refresh-timestamp.yml` accepts any
`timestamp_expires` up to that horizon, so nothing in the repository states or enforces a short
online window, and `docs/release-custody.md` says a later round must not cite one as an operating
control. A frozen client stays frozen for almost a year.

When this ships, the refresh tool and the workflow refuse an online expiry more than 90 days after
the moment of the refresh, and the custody documents state a quarterly cadence under that ceiling.
It does not make F2 an operating control: that needs a real refresh run with a short expiry, which
only the owner can approve in `tuf-release-signing`.

5 checks in 1 slice · 0 one-way doors · 1 open, 0 block

## Checks

### S1 - the refresh refuses an online window longer than 90 days

**C1** - A refresh whose `timestampExpires` is 90 days and 1 ms after the clock is refused with `VES_T76_REFRESH_EXPIRY_WINDOW` before any output exists
Proof: run refresh | ✔ refuses an online window longer than the 90 day policy

**C2** - A refresh whose `timestampExpires` is exactly 90 days after the clock is accepted and signs that expiry into timestamp and snapshot
Proof: run refresh | ✔ accepts an online window of exactly 90 days

**C3** - The existing refusals of a past expiry, an expiry after the offline targets and a malformed instant keep their codes
Proof: run refresh | ✔ refuses an online window that is past or outlives the offline targets

**C4** - The workflow's validation step refuses a `timestamp_expires` later than 90 days from the run, and its input description names the window
Proof: run refresh | ✔ the timestamp window of 90 days is named and enforced before the refresh runs

**C5** - The custody documents state the 90-day ceiling and the quarterly cadence, and say F2 is not an operating control until a refresh runs with it
Proof: `grep -q "90 days" docs/release-custody.md && grep -q "VES_T76_REFRESH_EXPIRY_WINDOW" docs/release-custody.md && grep -q "90 days" .specs/features/tuf-role-separation/republish-v3-runbook.md && ! grep -qi "monthly online refresh" .specs/features/tuf-role-separation/republish-v3-runbook.md`

## Coverage

| Set (size)                         | Member -> proof                                                | Unproven |
| ---------------------------------- | -------------------------------------------------------------- | -------- |
| window boundary, AC 1 (3 examples) | now+90d C2 · now+90d+1ms C1 · now+30d (existing round trip) C3 | -        |
| refusals that keep their code (3)  | past C3 · after targets C3 · malformed C3                      | -        |
| places that state the window (3)   | script C1 · workflow C4 · documents C5                         | -        |

## Swept

- validation: C1, C2, C3
- failure modes: C1 (no output directory exists after the refusal)
- idempotency: existing - a repeated refresh is refused by the ledger version check (`tests/build/t76-timestamp-refresh.test.mjs`, "refuses a timestamp/snapshot version that does not strictly exceed every recorded one")
- authorization: existing - `tuf-release-signing` approval and online-key-only checks, unchanged
- concurrency: n/a - the refresh is one manual run per root
- data lifecycle: n/a - no stored data changes; the expiry is the input
- dependency failure: existing - an unreadable live timestamp refuses before signing, unchanged
- state transitions: n/a - no entity moves through states
- observability: existing - the refresh summary already prints `timestampExpires`

## Assumptions

| Assumption                                                                                      | Default                   | Rationale                                   | Confirmed? |
| ----------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------- | ---------- |
| Window of 90 days, quarterly refresh                                                            | 90-day ceiling, quarterly | user: "90 dias, refresh trimestral"         | y          |
| Scope is policy and code check, not the live refresh                                            | no live run               | user: "Só política e verificação em código" | y          |
| The window is measured from the instant of the refresh, not from the signing date of any record | clock at refresh          | the refresh tool has no other anchor        | n          |

## Out of scope

- Running the refresh live with a short expiry, and the ledger entry it produces: owner, after merge.
- `docs/qualification/qualification-line-exit-record.md`: it is signed, so only the owner re-signs it.

## Handoff

- **Settled mid-build:** window 90 days, quarterly, code and policy only (user, 2026-11-03)
- **Dispatched:** Verifier, round 1, at the HEAD of the commit that carries this line; not yet returned
- **Boundary:** C1-C5 closed at 63d6590
- **Abandoned:** none
- **Walked:** n/a - no screen
