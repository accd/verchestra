# Cyclomatic-complexity measurement and policy

Repository-quality stream (#159, #160). Independent of the T69–T77 product
qualification chain, and not a public Verchestra capability: nothing here adds
a CLI command or a product claim.

## What is measured, and what is not

Cyclomatic complexity estimates independent control-flow paths through one
function. It is a **risk signal**, not a verdict. It does not measure
correctness, cognitive difficulty, coupling, duplication, security, test
quality, or the number of tests a function needs — a function of complexity
`N` does not require exactly `N` tests; tests cover observable outcome classes
and risk boundaries, not a formula. A lower value that increases coupling,
hides state, weakens error specificity, or turns fail-closed into fail-open is
a regression, never an improvement.

## Analyzer contract

- Tool: the repository's pinned ESLint (`eslint` in `package.json`
  `devDependencies`) running the core `complexity` rule through the same
  parser stack as `pnpm lint` (`typescript-eslint`).
- Variant: `classic`. Each `case` counts; the `modified` variant would count a
  whole `switch` as one and hide exhaustive-dispatch growth.
- Counted per recorded fixture evidence
  (`tests/unit/complexity-analyzer.test.mjs`): `if`, each `else if`, loops,
  `catch`, ternaries, `&&`, `||`, `??`, each logical assignment, each
  optional-chain link, each default parameter and destructuring default, each
  `switch` case (`default` free), class field initializers and static blocks
  as their own code paths. Async, generator, and anonymous functions count
  like any other.
- The fixture suite fails when an ESLint upgrade changes counting semantics,
  so the baseline cannot silently change meaning.
- All values come from analyzer invocations. Estimated values are prohibited.

## Commands

```bash
corepack pnpm complexity:report
corepack pnpm complexity:check
corepack pnpm complexity:update
```

`report` prints the per-scope distribution and top production hotspots.
`check` compares production hotspots against `complexity-baseline.json` and
exits non-zero on any drift. `update` rewrites the baseline and refuses to
raise any entry unless `--allow-increase` is passed inside a reviewed change
that links its issue.

## Scope

Enforced production scopes: `packages/*/src`, `apps/vestra-cli/src`,
`apps/site/src`, `scripts`. Tests, site tests, fixtures, and spikes are
measured in `report` but never enforced: test complexity is usually case
matrices and fault campaigns, and forcing production thresholds there would
punish exhaustiveness. `.astro` component files are outside the lint scope
today and therefore outside this policy; only the site's TypeScript is
covered.

## Policy: baseline and ratchet

New-code target: **10** (classic). The measured repository distribution — not
folklore — chose the model: at the baseline commit, production code held 2446
functions in `packages/*/src` with median 1 and p90 8, but 180 hotspot keys
above 10, topped by fail-closed SQL read-operation parsers, artifact
verification, and the report-contract validator at 38–53. Those are essential
domain branching; a fixed threshold would have demanded either ~180 exceptions
or a mass refactor, both rejected.

Rules, all enforced by `complexity:check`:

- a new production function above 10 with no baseline entry fails;
- a baselined function that measures above its recorded value fails;
- a baselined function that improves fails until the baseline is ratcheted
  down with `complexity:update`, so recorded values only move downward;
- a baseline entry whose function no longer exists (or was renamed) fails
  until reconciled — renames cannot silently reset history;
- raising a baseline value requires editing the tracked baseline in a
  reviewed change with a linked issue stating the reason.

The baseline key is `file :: reported symbol` with no line numbers, so
formatting cannot move it; duplicate anonymous symbols in one file collapse
into one key holding their sorted values.

## Refactoring protocol

Infrastructure and hotspot refactors are separate changes. A hotspot refactor
needs its own issue and, before any structural change: recorded current
behavior and measured value, an outcome map to exact assertions,
characterization tests for gaps, then one small change, remeasure, and a
discrimination sensor against the behavior most at risk. Rejected on sight:
one helper per condition, strategy classes for fixed behavior, single-use
interfaces, generic `process`/`handle` helpers, branches moved into callbacks,
weakened exhaustive checks, changed error precedence. The question for every
extraction is whether it creates a meaningful abstraction or merely moves the
branch.

## Gate placement and performance

Measured on the reference machine: the full report sweep (production plus
tests, 395 files) runs in about 12 seconds cold; the enforcement sweep skips
the test roots and ran in 7.5 seconds warm. The owner approved the
baseline-and-ratchet strategy in #160, so `complexity:check` runs in **all
five gate profiles**, immediately after `lint`; the gate-selection contract
test asserts that placement. The check runs its own traversal rather than
piggybacking on `lint` because ESLint's rule model cannot express a
per-function baseline; the measured cost was accepted with the decision.

## Interpreting a failure

The failure output names the file, symbol, measured and allowed values, and
the reconciliation command. If the code grew a real new decision path, either
simplify it or justify the baseline edit in review with a linked issue. If
you improved a hotspot, run `corepack pnpm complexity:update` and commit the
lowered baseline with the change that earned it.
