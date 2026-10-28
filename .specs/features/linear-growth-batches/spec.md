# Linear-growth batches of equal length (TST-005 follow-up)

## Problem

`tests/helpers/linear-growth.mjs` judges whether a cost grows linearly by the
ratio of its cost at two input sizes four times apart (TST-005, #598). It kept
failing linear functions on noisy runners:

- `platform-matrix.yml` run 40566619084, macOS x64: `withoutLeadingTitle` 8.8x
  and, on the rerun, `importSpecifiers` 10.6x;
- `sonarcloud.yml` run 40566815287, Linux under V8 coverage:
  `importsCanonicalizeJsonV2` 9.5x;
- after `e7ec847` alternated the sizes and kept the least of up to three
  rounds: run 40573428199, macOS x64, `withoutLeadingTitle` 9.7x as the least
  of three rounds.

Each function's cost per character is flat from 1,250 to 160,000 characters
on an idle host, so the functions are linear and the measurement is biased.

## Cause

Both sizes ran the same number of times, so a large batch lasted four times as
long as a small one. The helper keeps the least of several batches, because
interference only adds time. On an oversubscribed runner, a short batch often
finds a window without preemption, but a long one rarely does, so the large
side is inflated every round, and re-measuring cannot remove a bias that
repeats. On 16 cores loaded twice over, 6 of 12 linear trials crossed the
limit, reading as high as 22.4x.

Keeping the least ratio across rounds has the opposite fault. Noise that slows
the small side pulls a quadratic ratio down, and under load one round in 12
let a quadratic cost pass at 3.3x.

## Requirements

- **LGB-01**: For each round, the large input SHALL run a quarter as many times
  as the small one, so for a linear cost both batches last about as long.
  Calibration SHALL start at `GROWTH_SCALE` repetitions so the quarter is a
  whole number.
- **LGB-02**: The verdict SHALL be the median of the rounds, so one misread
  round neither passes a quadratic cost nor fails a linear one.
- **LGB-03**: The helper SHALL still measure linear work under the limit and
  quadratic work over it. `LINEAR_GROWTH_LIMIT` stays 8, and no wall-clock
  bound is added.

## Decisions

- **A quarter of the count, not separately calibrated counts.** Calibrating the
  large input on its own also equalizes the durations, but its own calibration
  noise reintroduces the mismatch (one 29x linear trial under load). Deriving
  the count from the small one ties the durations to the assumption under test:
  for a linear cost they match. For a quadratic cost the large batch runs
  longer, which can only raise its ratio.
- **Median, not least.** With the bias removed, combining the rounds
  symmetrically keeps both false verdicts down.
