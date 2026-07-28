# CodeQL Alert Remediation Specification

## Problem statement

GitHub code scanning reports four open CodeQL alerts on `main`, all rated
high severity. Three are the same defect repeated across the three
Transact-SQL-family probe adapters: the batch-separator guard uses a regular
expression whose whitespace quantifier overlaps its own line-boundary
alternatives, so matching is polynomial in input length. The fourth is an
incomplete URL-scheme check in the built-site link checker, which enumerates
dangerous schemes by prefix and therefore cannot be complete.

The probe adapters are deny-validators that run before a protected database
statement is admitted, so a slow match is a denial-of-service surface on the
validation path itself rather than an injection surface. Exploitability is
bounded by the existing 131,072-character statement cap, but a 60,000-newline
statement still costs seconds of single-threaded work per call.

## Goals

- Close all four open CodeQL alerts at their source, not by suppression.
- Preserve the exact deny/allow semantics of every affected guard.
- Add assertions that fail if either defect is reintroduced.
- Keep each fix to one logical concern, one gate, one atomic commit.

## Out of scope

| Exclusion                                       | Reason                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Alert dismissal or `codeql` suppression comments | The alerts describe real defects; suppression would hide them.             |
| Other probe adapters (MongoDB, MySQL, SQLite)    | CodeQL reports no alert against them and their guards use different shapes. |
| Sharing a batch-separator helper across adapters | Each dialect adapter is deliberately self-contained; no adapter imports another. |
| Widening or narrowing what the guards deny       | This is a complexity fix, not a policy change.                             |
| New runtime dependencies                         | Dependency additions require explicit human approval and a lockfile update. |

## Alert inventory

Evidence gathered 2026-07-28 against `main` at
`1688320edaff29df11ed1e6ef6eea6f751cc21be`.

| Alert | Rule                            | Location                                        | Defect                                                                                                 |
| ----- | ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1     | `js/polynomial-redos`           | `packages/data-probe/src/oracle-adapter.ts:78`   | `/(?:^\|\r?\n)\s*\/\s*(?:\r?\n\|$)/u` — `\s*` matches `\n`, so it overlaps both boundary alternatives.  |
| 2     | `js/polynomial-redos`           | `packages/data-probe/src/sap-ase-adapter.ts:94`  | Same shape with the `GO` separator.                                                                     |
| 3     | `js/polynomial-redos`           | `packages/data-probe/src/sqlserver-adapter.ts:75`| Same shape with the `GO` separator.                                                                     |
| 4     | `js/incomplete-url-scheme-check`| `apps/site/scripts/check-built-site.mjs:83`      | Skips `javascript:` by prefix without considering `vbscript:`; a prefix deny-list cannot be complete.   |

## Requirements

| ID     | Requirement                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CAR-01 | Oracle, SQL Server, and SAP ASE batch-separator detection SHALL run in time linear in statement length.                                   |
| CAR-02 | Batch-separator detection SHALL deny exactly the statements the previous expressions denied, with no widening or narrowing.               |
| CAR-03 | Each adapter suite SHALL assert linear-time behavior on an adversarial newline-dense statement, and that assertion SHALL fail on the old expression. |
| CAR-04 | The built-site link checker SHALL select link targets by scheme allowlist, so no dangerous scheme depends on being enumerated.            |
| CAR-05 | The link checker SHALL keep reporting the same broken-link and outside-base-path findings for `http:` and `https:` targets.               |
| CAR-06 | All four alerts SHALL move to `state: fixed` on the next `main` scan, with no alert dismissed.                                            |

## Acceptance criteria

1. WHEN a probe adapter parses a statement containing 60,000 newlines THEN it
   SHALL reject the statement in under one second.
2. WHEN a statement contains a standalone separator line — padded with tabs or
   spaces, in either case, under LF or CRLF endings, at the start, middle, or
   end of the statement — THEN the adapter SHALL raise its batch-denied error.
3. WHEN a separator token shares a line with other SQL (`public.go_orders`, a
   division operator) THEN the adapter SHALL NOT treat it as a batch separator.
4. WHEN the link checker encounters a non-`http(s)` target THEN it SHALL skip
   the target without enumerating the scheme.
5. WHEN the link checker encounters an `http(s)` target outside the base path or
   with no matching build output THEN it SHALL still record the finding.

## Edge cases

- A lone carriage return (`GO\r` at end of statement) is whitespace under the
  old expression and must remain denied under the new one.
- The encoding guard runs first and `fail()` throws, so by the time the batch
  guard runs the statement contains only tab, LF, CR, and printable ASCII.
  `String.prototype.trim` therefore covers every whitespace character that can
  reach the guard.
- Scheme-relative (`//host/path`) and protocol-less relative targets resolve
  through `new URL(value, base)` and keep the base scheme, so the allowlist
  must be applied after resolution, not before.

## Safety and authority

The affected probe guards are fail-closed: every rejection path throws. The
change must not convert any throw into a return, and must not reorder guards,
because guard order determines which error code a statement receives. No
assertion may be weakened, skipped, or deleted to obtain a pass.

## Success criteria

All four alerts closed by CodeQL on `main`; `pnpm gate:quick` and
`pnpm gate:security` green; `pnpm site:check` green; every requirement traced
to a named assertion in `validation.md`; and the discrimination sensor shows
the new timing assertions failing against the previous expressions.
