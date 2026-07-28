# CodeQL Alert Remediation Design

## Batch-separator detection (CAR-01, CAR-02)

### Why the expression is polynomial

`/(?:^|\r?\n)\s*GO\s*(?:\r?\n|$)/iu` has three regions that can all match a
newline: the opening alternative `\r?\n`, the `\s*` runs, and the closing
alternative `\r?\n`. On a statement of `n` newlines the engine starts a match
at every newline and, from each start, backtracks `\s*` across the remainder,
giving `O(n²)` work. Measured on Node 24.14.0: 60,000 newlines cost 4,299 ms
for a single `.test()` call.

### Chosen approach

Replace the expression with a per-line scan:

```ts
sql.split("\n").some((line) => line.trim().toUpperCase() === "GO")
```

and, for Oracle, `line.trim() === "/"`.

`split` is linear, `trim` is linear per line, and the sum of line lengths is
the statement length, so the whole guard is linear by construction. There is
no regular expression left for CodeQL to analyze.

### Why this preserves semantics exactly

The old expression matches if and only if a separator token exists such that
everything between it and the nearest preceding line boundary (or string
start) is whitespace, and likewise for the following boundary (or string end).
That is precisely the definition of "some LF-delimited line, once trimmed,
equals the separator":

- Forward: if a trimmed line equals the separator, the line is preceded by
  `^` or `\n` and followed by `\n` or `$`, and its padding is whitespace, so
  the old expression matches.
- Backward: if the old expression matches, take the LF-delimited line holding
  the separator. The padding on both sides lies inside that line and contains
  no LF, so it is whitespace the trim removes.

`toUpperCase()` reproduces the `i` flag. `trim()` removes tab, CR, and space —
which, given the preceding encoding guard, is every whitespace character that
can reach this point. That guard is what makes a lone trailing `\r` behave
identically under both implementations.

### Alternatives rejected

| Alternative                                             | Reason rejected                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Narrow the classes, e.g. `/(?:^\|\n)[^\S\n]*GO[^\S\n]*(?:\n\|$)/` | Still a regular expression to reason about, and the negated-class trick is easy to get subtly wrong on `\r`. |
| Extract a shared helper into a new `data-probe` module   | The three adapters are deliberately self-contained — none imports another, and each carries its own `fail` and error class. A shared module would change package structure for a two-line fix. |
| Cap statement length further                             | Treats the symptom; the guard would still be polynomial below the cap.                  |

## Link-checker scheme selection (CAR-04, CAR-05)

The current code skips `#`, `data:`, `mailto:`, `tel:`, and `javascript:` by
prefix, then resolves everything else with `new URL(value, base)` and ignores
non-production origins. A `vbscript:` link is therefore already skipped in
practice — but only incidentally, by falling through to the origin check. The
defect is the pattern: a deny-list of schemes is unbounded and each new
dangerous scheme is a silent omission.

Invert it. Keep the `#` fragment skip, resolve the value, and continue unless
the resolved protocol is `http:` or `https:`. Every other scheme — present or
future — is excluded by construction, and the subsequent origin and base-path
checks are unchanged, so reported findings stay identical for the targets the
checker is actually about.

## Delivery shape

Two tasks, two commits, two pull requests: the adapters change under
`gate:security` (a product security surface), the link checker under
`site:check` (a build-time documentation tool). Splitting them keeps each pull
request to one reviewable concern and lets the CodeQL rescan attribute each
closed alert to the change that closed it.
