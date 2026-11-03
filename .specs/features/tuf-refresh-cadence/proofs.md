# tuf-refresh-cadence proofs

**HEAD**: d631fed
**Tree**: clean
**Shell**: /bin/sh
**Result**: 10 pass, 0 fail

| Check | Proof                                                                                                            | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| C1    | `run refresh / ✔ refuses an online window longer than the 90 day policy`                                         | pass   |
| C2    | `run refresh / ✔ accepts an online window of exactly 90 days`                                                    | pass   |
| C3    | `run refresh / ✔ refuses an online window that is past or outlives the offline targets`                          | pass   |
| C4    | `run refresh / ✔ the timestamp window of 90 days is named and enforced before the refresh runs`                  | pass   |
| C5    | `grep -q "at most 90 days" docs/release-custody.md && grep -q "VES_T76_REFRESH_EXPIRY_WINDOW" docs/release-cust` | pass   |
| C6    | `run refresh / ✔ refuses a clock that is not a finite number instead of switching the window off`                | pass   |
| C7    | `run refresh / ✔ the command line offers no way to set the clock`                                                | pass   |
| Build | `node --check scripts/t76-refresh-timestamp.mjs`                                                                 | pass   |
| Build | `corepack pnpm exec prettier --check scripts/t76-refresh-timestamp.mjs tests/build/t76-timestamp-refresh.test.m` | pass   |
| Build | `corepack pnpm exec eslint scripts/t76-refresh-timestamp.mjs tests/build/t76-timestamp-refresh.test.mjs tests/a` | pass   |

## Output

`Run refresh` - exit 0

```
✔ the command line offers no way to set the clock (1.220115ms)
✔ accepts an online window of exactly 90 days (27.03428ms)
✔ the emitted ledger entry appends verbatim and bounds the next refresh (93.015836ms)
✔ the command line never emits key material on success or on failure (492.673674ms)
✔ the refresh is admitted over the ledger entry the publication itself emitted (ADP-7) (65.027451ms)
✔ a refresh at or below the live timestamp version refuses before signing (261.015602ms)
✔ an unreadable live timestamp refuses before signing (241.862042ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3789.80876
```

`grep -q "at most 90 days" docs/release-custody.md && grep -q "VES_T76_REFRESH_EXPIRY_WINDOW" docs/release-cust` - exit 0

```
(no output)
```
