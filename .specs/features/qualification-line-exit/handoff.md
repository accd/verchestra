---
schema: verchestra-feature-handoff/v1
feature: qualification-line-exit
issue: null
status: verification
branch: docs/qualification-line-exit-record
baseRevision: d2f6de855089e1496a6d9a95c01c54975da1120e
lastCompletedTask: T6
nextTask: "Human review of the pull request, then the owner checklist below: every remaining step is owner-only. No session signs the record, fills decidedAt, confirms AD-033, or publishes."
lastGate: "gate:quick, agent:check (record unsigned, a warning), release-decision and version-line-record tests, agent:context (T77 complete; the declared chain is fully verified), site unit tests, build, and check:built PASS on win32-x64; astro check not runnable on this host, covered by CI (validation.md)"
updatedAt: 2026-10-29T12:00:00Z
---

# Scope

Record, in a tracked and owner-signable file, what the `0.0.0-qualification`
line is and under which conditions a public `0.x` line or a 1.0.0 round 2
opens; validate it in `agent:check`; fix the record inconsistencies the
2026-10-29 analysis found. See `spec.md`.

# Completed Evidence

T1 to T6 are done on this branch; `validation.md` records the gates and the
file-and-line evidence per requirement. `pnpm agent:check` reports the record
as `unsigned` (a warning) and passes; `agent:context` still derives "T77
complete; the declared chain is fully verified".

# Next Exact Action

Human review of the pull request. Then the owner checklist.

# Owner checklist

Each step is one no session can take. Ticking one is the owner's act; the
tracked evidence it produces is named beside it.

- [x] Create the `npm-publication` GitHub environment (owner as interim
      required reviewer, deployment branch `main` only, administrators unable
      to bypass), add the trusted publisher on npmjs.com for
      `.github/workflows/npm-publish.yml` and that environment, and publish
      `0.0.0-qualification.9` through `npm-publish.yml` (#596;
      `docs/release-custody.md` section 9, O6; exit condition X1). Done on
      2026-10-30: run `41004500072` published `.9` with tag `next` and a
      SLSA provenance attestation. The evidence is in
      `.specs/features/live-activation-matrix/validation.md`.
- [x] Dispatch `.github/workflows/t76-refresh-timestamp.yml` from `main`,
      approve it in `tuf-release-signing`, upload the refreshed snapshot and
      timestamp, and append the `role-refresh` entry to
      `docs/qualification/tuf-publication-ledger.json` in a reviewed pull
      request (#382; exit condition X2).
- [ ] Run pilot #406 P1 attempt 3 on `verchestra@0.0.0-qualification.8` with
      the verifier `gpt-5.5`, as `.specs/features/live-task-pilot/spec.md`
      section 8 orders it, and record the row in its `validation.md` (exit
      condition X3).
- [x] Move npm `latest` to `0.0.0-qualification.9` once it is published
      through the workflow and verified live. It is now published and
      verified live on all five targets (run `41005172967`). The owner moved
      `latest` on 2026-10-30, so both `latest` and `next` now name `.9`.
- [x] Sign `docs/qualification/qualification-line-exit-record.md`: fill
      `decidedAt`, sign the canonical bytes with the release-decision key
      (`.specs/features/release-decision/prepared-decision.md` §4.3, with the
      record's path), paste the signature, and confirm `pnpm agent:check`
      reports no warning.
- [x] Sign the record again for `.9`. Recording `.9` in the ledger moved
      `latestRelease` to `0.0.0-qualification.9` and marked X1 met, so the
      2026-10-29 signature no longer covers the record's bytes. Signing works
      as in the step above. Signed by the owner at 2026-10-30T21:09:54Z, and
      `pnpm agent:check` reports no warning.
- [x] Confirm the status of AD-033 in `.specs/STATE.md`: the signed decision
      records it as ratified on 2026-08-28; the status line still reads
      proposed.
- [ ] Name a custodian #2 if one becomes available
      (`docs/release-custody.md` section 9, O1); the custody work then resumes
      from O1.

# Blockers

None for the change itself. Everything in the owner checklist is owner-only
and does not block review.

# Decisions

- The record is a table per section so that each condition is one checkable
  row: a condition id, the gap ids it closes, what must be true, and the
  evidence paths. Prose around the tables is not read by the validator.
- The record is signed over the same §4.1 canonical bytes as a decision, with
  the same key and the same verification, so no second signing scheme exists.
- An unsigned record is a warning printed by `agent:check` on every run, not an
  error: the owner's pending act must stay visible without blocking unrelated
  work.
- `docs/canonical-json-census.json` was refreshed with `pnpm census:refresh`,
  not edited by hand: the validator's one new `createHash` call moved the
  `digest` signal of `scripts/agent-readiness.mjs` from 4 to 5; classification
  and reason are unchanged.

# Files Intentionally Left Unchanged

`README.md` (another change rewrites it), every `docs/qualification/t*-validation.md`,
`docs/qualification/release-decision-1.0.0.md` (signed), `package.json`
(the version stays `0.0.0-qualification`), `complexity-baseline.json`.

# Known Risks Declared in Advance

- The record's `decisionDigest` binds the hold's current bytes; a later round
  that supersedes the hold leaves the hold's bytes unchanged, so the digest
  still verifies, but `decisionInEffect` must then be re-pointed at the round in
  effect in a reviewed change.
- The record's line references (`docs/release-custody.md:182-212`, `:169-177`,
  `:385-431`) are locations as of this change; the validator resolves the path,
  not the lines.
