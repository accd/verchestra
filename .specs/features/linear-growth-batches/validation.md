# Linear-growth batches of equal length: validation

**Date:** 2026-10-28
**Diff:** `test/linear-growth-equal-batches` from `ff557cf`
**Host:** Windows 11 Pro x64, 16 logical cores, Node 24.14.0.
**Verifier:** the implementing agent's local pass. No independent review yet.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| LGB-01 | `tests/unit/linear-growth.test.mjs`: after calibration the rounds alternate the small input R times and the large input R/4 times; a 25 ms stall on the first call does not leave the measured batches under 64 runs; a cost that fills its batch in one run still compares whole runs. | PASS |
| LGB-02 | The same suite: a round that misreads a quadratic cost as linear does not pass it, and a round that misreads a linear cost as slow does not fail it. | PASS |
| LGB-03 | The same suite: linear work under the limit, quadratic work over it. `LINEAR_GROWTH_LIMIT` is still 8, and the helper's signature is unchanged for its callers. | PASS |

## The cause, measured

On the idle host, the cost per character of `withoutLeadingTitle` and
`importSpecifiers` is flat from 1,250 to 160,000 characters (1.7–1.9 ns and
5.8–7.4 ns), so both are linear.

Calibration of `importsCanonicalizeJsonV2`, 12 times each:

| Condition | Repetitions chosen |
| --- | --- |
| idle | 16,384 every time |
| 16 cores loaded twice over, one batch decides | 32 to 4,096 |
| loaded, the fastest of three batches decides | 2,048 to 8,192 |

## Contention runs

The helper on `main` (`a78645d`, after `e7ec847`) against this one, with
every core oversubscribed by busy loops. Each cell is 15 trials. A wrong
verdict is a linear function at 8x or more, or quadratic work under 8x.

| Condition | Helper | `withoutLeadingTitle` | `importSpecifiers` | `importsCanonicalizeJsonV2` | quadratic |
| --- | --- | --- | --- | --- | --- |
| idle | `main` | 0/15 | 0/15 | 0/15 | 0/15 |
| idle | new | 0/15 | 0/15 | 0/15 | 0/15 |
| loaded 2x | `main` | 8/15 (up to 19.5x) | 12/15 (up to 21.6x) | 7/15 (up to 19.1x) | 0/15 |
| loaded 2x | new | 0/15 (3.0–4.4x) | 0/15 (2.1–6.7x) | 0/15 (3.7–6.9x) | 0/15 (15.1–21.3x) |
| loaded 3x | `main` | 0/15 | 0/15 | 0/15 | 0/15 |
| loaded 3x | new | 0/15 | 0/15 | 0/15 | 0/15 |

Earlier runs of the variants on the same host: with equal counts and the least
round, 6 of 12 linear trials crossed the limit under 2x load. With separately
calibrated counts and the least round, one quadratic trial in 12 read 3.3x.
With quarter counts, one-batch calibration and the median, two
`importsCanonicalizeJsonV2` trials in 10 misread (0.3x and 40.7x), which the
fastest-of-three calibration removed.

## Discrimination sensors

Each mutant was applied to `tests/helpers/linear-growth.mjs`, the unit suite
run, and the file restored. All five were killed.

| Mutant | Killed by |
| --- | --- |
| both sizes run the same number of times | the alternation case |
| the least round decides | the case of a round that misreads a quadratic cost |
| the sizes are not alternated | the alternation case; the quadratic misread case |
| calibration starts at one repetition | the case of a cost that fills its batch in one run |
| one calibration batch decides | the stall case |

## Gates

| Gate | Result |
| --- | --- |
| `tests/unit/linear-growth.test.mjs` | 7 of 7 |
| The helper's callers: `regex-linearity` and the Oracle, SAP ASE and SQL Server probe adapter security suites | 146 of 146 |
| `pnpm gate:quick` | PASS: unit 3,153, agent-readiness 401, census 13 |
| `pnpm agent:check` | PASS |
