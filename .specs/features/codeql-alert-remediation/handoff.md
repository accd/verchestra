---
schema: verchestra-feature-handoff/v1
feature: codeql-alert-remediation
issue: null
status: in_progress
branch: fix/redos-batch-separator-regexes
baseRevision: 67e05ff12edc5206a786836838dfc7fb64c5758a
lastCompletedTask: T1
nextTask: T2
lastGate: pnpm gate:security
updatedAt: 2026-07-28T21:27:56Z
---

# Scope

Close CAR-01–CAR-06: the four open high-severity CodeQL alerts on `main`.
Three are the same polynomial-time batch-separator expression repeated across
the Oracle, SQL Server, and SAP ASE probe adapters; the fourth is an
incomplete URL-scheme check in the built-site link checker.

# Completed Evidence

T1 complete. The three batch-separator expressions are replaced with a
per-line scan (`sql.split("\n").some((line) => line.trim().toUpperCase() ===
"GO")`, and `=== "/"` for Oracle), linear by construction and with no regular
expression left to analyze. Semantic equivalence is argued in `design.md` and
asserted by 18 new parity cases plus 3 discrimination cases across the three
security suites.

Measured on Node 24.14.0 with a 60,000-newline statement: the previous
expression cost 4,299 ms for a single `.test()` call; the replacement costs
4.2 ms, and a full `parseSqlServerReadOperation` call costs 6.2 ms.

Focused suite: 130 tests, 0 failures, 0 skipped
(`tests/security/{oracle,sqlserver,sap-ase}-probe-adapter.test.mjs`).
`pnpm gate:quick` PASS (1,615 unit tests, 21 agent-readiness tests).
`pnpm gate:security` PASS across format:check, lint, typecheck, build,
test:unit (1,615), test:architecture, test:qualification, test:security (912),
and test:fault.

Discrimination sensor: the three new linearity assertions were run against the
previous expressions in a disposable copy. Exactly those three failed
(5,289 ms, 5,289 ms, 5,244 ms against the 1,000 ms bound) and all 127 other
tests passed on both implementations, proving both that the new assertions
detect the defect and that the rewrite preserves the existing semantics.

# Next Exact Action

T2: invert the built-site link checker at
`apps/site/scripts/check-built-site.mjs:76-88` from a scheme deny-prefix list
to an `http:`/`https:` allowlist applied after `new URL()` resolution, then
run `pnpm site:check` and open its own pull request.

# Blockers

None. One prerequisite was found and cleared: `gate:security` could not report
green because `test:architecture` was already failing on a clean `main`.
`tests/architecture/repository-boundaries.test.mjs:16` listed every directory
under `apps/` and `packages/` and compared it to `EXPECTED_PACKAGES`, which
omitted the tracked `apps/site` directory, taking `gate:build`,
`gate:security`, and `gate:release` down with it. CI runs only `gate:quick`,
which is why it went unnoticed. Repaired under its own concern in pull request
\#40, merged as `67e05ff12edc5206a786836838dfc7fb64c5758a`, which is now this
feature's base revision.

# Decisions

- Fix at the source; no alert is dismissed or suppressed.
- Per-line scan over a narrowed regular expression: nothing left for CodeQL to
  analyze, and the `\r` handling is decided by `trim()` rather than by a
  hand-tuned character class.
- No shared helper across the three adapters; each dialect adapter stays
  self-contained, as none imports another today.
- Two pull requests, one per changed surface: adapters under `gate:security`,
  link checker under `site:check`.

# Files Intentionally Left Unchanged

- The other probe adapters; CodeQL reports no alert against them.
- Guard order and error codes in the three adapters.
- The 131,072-character statement cap.
