# Qualification line exit record

## Problem statement

Verchestra is `0.0.0-qualification`, T77 complete, and the 1.0.0 decision in
effect is a signed reject recorded as a hold
(`docs/qualification/release-decision-1.0.0.md`, #18). The published package
`verchestra@0.0.0-qualification.8` is npm `latest` and ledger sequence 8. On
2026-10-29 the owner reviewed a release-gap analysis and a five-juror panel
verdict and chose path A: stay on the line, keep publishing `.N` builds, and
record the conditions under which a public `0.x` line or a 1.0.0 round 2
would open, rather than rename the version. A rename is one-way across npm,
the ledger, and the TUF lineage; `scripts/agent-readiness.mjs` refuses any
other `package.json` version; and the beta plan
(`.specs/features/beta-release-2026-10/plan.md`) already excluded it.

Three record inconsistencies the analysis found are fixed in the same change:
`VERSIONING.md` called the version "an internal qualification marker" while it
is public `latest`; the operational reviewer's Windows home-directory
`self-test` PASS on `.7` exists only in a PR #523 comment; and `.specs/STATE.md`
AD-033 reads proposed while the signed decision records it as ratified.

## Goals

- A tracked, owner-signable record of the line and its exit conditions, each
  with the gap it closes and tracked evidence, validated by `pnpm agent:check`.
- An honest `VERSIONING.md` sentence, with the record linked from `ROADMAP.md`
  and `docs/release-custody.md` section 9.
- The untracked evidence recorded as reported, not re-performed, without
  moving acceptance-matrix L5 between groups.
- The AD-033 status discrepancy named for the owner, without editing the
  signed decision.
- The three stale handoffs (`tuf-role-separation`, `release-custody`,
  `milestone-2-completion`) refreshed to their true next actions.

## Out of scope

| Exclusion | Reason |
| --- | --- |
| Renaming the version or opening a `0.x` line | The owner chose path A; a `0.x` line opens only by its own signed record. |
| Editing `docs/qualification/release-decision-1.0.0.md` or any `t*-validation.md` | Signed and immutable evidence. |
| Editing `README.md` | Another change rewrites it. |
| Signing the record, confirming AD-033, creating the `npm-publication` environment, running the refresh or the pilot | Owner-only; listed in `handoff.md`. |
| Claiming production readiness, 1.0, or an independent verification | None happened. |

## Requirements

| Id | Requirement |
| --- | --- |
| QLE-01 | `docs/qualification/qualification-line-exit-record.md` carries frontmatter `schema: verchestra-version-line/v1`, `line`, `latestRelease`, `decisionInEffect`, `decisionDigest`, `decidedBy`, `decidedAt`, `signature`, and `publicKeyRef`, and a body with the four sections: what the line is, exit conditions for a public `0.x` line, the condition for a 1.0.0 round 2, and the dissent recorded. |
| QLE-02 | `pnpm agent:check` fails when the record's frontmatter is missing, `latestRelease` is not the ledger's highest-sequence `release` entry, `decisionDigest` is not the sha256 of the decision in effect's current bytes, a condition lacks a gap id or an evidence path, or an evidence path does not resolve inside the repository. |
| QLE-03 | An empty `signature` is reported as `unsigned`, a warning that `agent:check` prints and that is never a pass; a present signature is verified with the Ed25519 verification the decision uses, and a signature that does not verify, or a key reference that does not resolve, is an error. |
| QLE-04 | A repository without the record has no error and signature state `absent`; every error names the record's path. |
| QLE-05 | `VERSIONING.md` says the version is the published qualification line whose `.N` builds are signed public releases of a candidate the signed 1.0.0 decision holds, not a stable release and not a compatibility promise; `ROADMAP.md` "Release conditions" and `docs/release-custody.md` section 9 link the record. |
| QLE-06 | Acceptance-matrix L5 gains an "Update" paragraph recording the PR #523 report of 2026-10-14 as reported, not re-performed, until a J08 run on `.9` or later is recorded; L5 stays in the Qualifying group. |
| QLE-07 | `.specs/STATE.md` AD-033 gains a dated note that the decision file records it as ratified on 2026-08-28 and that the owner is asked to confirm the status; the status line is unchanged. |
| QLE-08 | The three handoffs name their true next actions and stay valid for `corepack pnpm agent:context`. |

## Acceptance criteria

- QLE-01 to QLE-04: `tests/agent-readiness/version-line-record.test.mjs`, one
  case per fail-closed condition, plus the committed record validating with
  signature state `unsigned` or `verified`, never `invalid`.
- QLE-05 to QLE-08: the file-and-line evidence in `validation.md`;
  `pnpm agent:check` (links resolve) and `corepack pnpm agent:context` (handoffs
  parse; "T77 complete; the declared chain is fully verified" unchanged).

## Edge cases

- A `role-refresh` entry appended after the latest release must not change
  the ledger's latest release.
- An evidence path with a `:line` or `:from-to` suffix resolves by its path.
- A path that escapes the repository (`../`) does not resolve even if the file
  exists.
- A signed record whose `decidedAt` is still the placeholder is an error.

## Safety and authority

The record decides nothing about a candidate and supersedes no decision. The
owner signs it with the release-decision key, never through a session; no
session fills `decidedAt`, `signature`, or AD-033's status. No secret, home
directory, or machine-local path enters a tracked file.

## Success criteria

`pnpm gate:quick`, `pnpm agent:check`, the two agent-readiness test files, the
site unit tests, build, and `check:built` pass; `agent:context` still derives
"T77 complete; the declared chain is fully verified"; the record validates as
`unsigned`; every link resolves; the three handoffs are current; a pull
request against `main` carries the change for human review.
