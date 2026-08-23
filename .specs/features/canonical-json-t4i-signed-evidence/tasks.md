# Canonical JSON T4i Tasks

**Status: all 4 tasks complete.** See `validation.md` for the verification
pass. T1 and T2 were implemented together (tightly coupled single-file
change); T2's design was revised mid-implementation when the "one
backward-compat-sensitive site" premise was empirically disproven — see
`.specs/STATE.md` AD-021's follow-up note.

Single-file feature (`packages/evidence/src/execution-package/execution-package.ts`
plus its test file and the census). 4 tasks, executed inline (no sub-agents).

## Design note (supersedes part of AD-021's stated risk surface)

Tracing every one of the 11 `.localeCompare()` sites against what actually
gets compared during `ExecutionPackageBuilder.verify()`: only
`derivePendingTasks`'s own final sort is genuinely backward-compat-sensitive.
The outer cryptographic check (`sha256Digest(artifact.payload)` vs. the
stored `payloadDigest`) runs on raw stored bytes before this file's
`normalizePayload` ever executes, so re-sorting during normalization changes
nothing about it. The other 10 sorted arrays (`artifactRefs`, `requirements`,
`tasks`, `completedTaskEvidence`, `roleRequirements`, `gates`,
`completionCriteria`, `normalizePending`, the `sourceState` entries sort, and
`invalidations`' `results`) are used only for internal uniqueness/shape
validation or are never persisted at all (`invalidations` is an ephemeral
return value) — none of their re-sorted output is compared against a stored
counterpart. `derivePendingTasks`'s output *is* stored (`payload.pendingTasks`)
and *is* re-derived-and-compared at verify time
(`canonicalizeJson(derived) !== canonicalizeJson(payload.pendingTasks)`) — the
one site that actually needs `schemaVersion` gating. The other 10 can switch
to unconditional code-unit ordering.

## T1 — Widen schemaVersion; migrate the 10 non-derivation sort sites

**What**: `ExecutionPackagePayload.schemaVersion: 1` → `1 | 2`; validate
`row["schemaVersion"] === 1 || row["schemaVersion"] === 2`; add a
`codeUnitCompare(left, right)` helper (native `<`/`>` string comparison, no
`localeCompare`); replace the 10 non-`derivePendingTasks` `.localeCompare()`
sites with it unconditionally.
**Requirement**: CJ4I-08 (sourceState), part of CJ4I-01 (ordering primitive
exists) · **Depends on**: none
**Tests first**: extend `tests/unit/execution-package.test.mjs` with a case
proving `artifactRefs`/`normalizeRequirements`/etc. order mixed-case values
by code unit (e.g. `"T-1"` before `"t-2"`), independent of a mocked
`localeCompare`.
**Gate**: `node --test tests/unit/execution-package.test.mjs`, then
`pnpm gate:quick`.

## T2 — Version-gate derivePendingTasks; wire schemaVersion through build/verify

**What**: `derivePendingTasks(tasks, completedTaskEvidence, version: 1 | 2 = 2)`
sorts with `codeUnitCompare` for `version === 2`, `.localeCompare` for
`version === 1`. `ExecutionPackageBuilder.build()` passes `base.schemaVersion`;
`.verify()` passes `payload.schemaVersion`. `build()` defaults its own input's
`schemaVersion` to `2` when the caller omits it (CJ4I-03).
**Requirement**: CJ4I-01, CJ4I-02, CJ4I-03, CJ4I-04, CJ4I-05, CJ4I-06
**Depends on**: T1
**Tests first**:
- Cross-locale determinism: build the same `schemaVersion: 2` input under
  two different `localeCompare` mocks, assert identical sealed bytes/digest
  (CJ4I-01, CJ4I-02).
- Backward compat: construct a `schemaVersion: 1` artifact whose stored
  `pendingTasks` reflects `localeCompare` order for a mixed-case `taskId`
  pair that would sort differently under code-unit order; verify it after
  the change and assert `ok: true` (CJ4I-04, CJ4I-05).
- New-version re-derivation: a `schemaVersion: 2` package's `pendingTasks`
  re-derives identically at verify time (CJ4I-06).
**Gate**: `node --test tests/unit/execution-package.test.mjs
tests/integration/execution-package.test.mjs` (adjust path if the
integration suite lives elsewhere — check first), `pnpm gate:quick`.

## T3 — Discrimination sensor

**What**: A mutation-style test proving that reverting `derivePendingTasks`'s
V2 branch to `.localeCompare(` is caught by T2's cross-locale test, not
merely present in the diff.
**Requirement**: CJ4I-07 · **Depends on**: T2
**Process**: swap the V2 comparator back to `.localeCompare(`, confirm the
cross-locale determinism test from T2 fails, revert, confirm it passes again.
Record the evidence in `validation.md` per the skill's Verifier step.
**Gate**: manual mutation + re-run, then `pnpm gate:security`.

## T4 — Reclassify the census; update the compatibility matrix

**What**: `docs/canonical-json-census.json`'s entry for
`packages/evidence/src/execution-package/execution-package.ts` moves from
`pending-versioned-migration` to `migrated-v2` with regenerated signal
counts (via the same detector regex used in T4i's own gate). Append a
"Completed vertical slice (T4i)" section to
`docs/canonical-json-compatibility.md` following the existing T3 section's
shape.
**Requirement**: Success criteria (census reclassification) · **Depends
on**: T1, T2, T3
**Gate**: `node --test tests/security/canonical-json-census.test.mjs`,
`pnpm gate:security`, `pnpm gate:quick`.

## Traceability

| Requirement ID | Task |
| --- | --- |
| CJ4I-01 | T1, T2 |
| CJ4I-02 | T2 |
| CJ4I-03 | T2 |
| CJ4I-04 | T2 |
| CJ4I-05 | T2 |
| CJ4I-06 | T2 |
| CJ4I-07 | T3 |
| CJ4I-08 | T1 |

Coverage: 8/8 mapped.
