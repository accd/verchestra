---
schema: verchestra-version-line/v1
line: 0.0.0-qualification
latestRelease: 0.0.0-qualification.9
decisionInEffect: docs/qualification/release-decision-1.0.0.md
decisionDigest: sha256:e3b53bd4bc2d076fb7e883ea87e15c0f62e2db0877dae52f8e37f85f317ab11c
decidedBy: accd
decidedAt: <RFC 3339 UTC instant, set by the owner when signing>
signature:
publicKeyRef: docs/qualification/trust/release-decision-public-key.json
---

# The qualification line and its exit conditions

This record says what the `0.0.0-qualification` line is, and under which
conditions a public `0.x` line or a second `1.0.0` decision round would open.
It was written on 2026-10-29, after the owner reviewed a release-gap analysis
and a five-juror panel verdict and chose to stay on the line, keep publishing
`.N` builds, and record the exit instead of renaming the version. Renaming is
one-way across npm, the publication ledger, and the TUF lineage;
`scripts/agent-readiness.mjs` refuses any other `package.json` version; and the
beta plan (`.specs/features/beta-release-2026-10/plan.md`) had already excluded
a rename.

`pnpm agent:check` reads this file: the frontmatter must be present,
`latestRelease` must be the ledger's latest `release` entry, `decisionDigest`
must match the current bytes of the decision in effect, every condition below
must carry a gap id and evidence a clean clone can open, and the signature is
reported as `unsigned` (a warning, never a pass) or verified against
`publicKeyRef`. The owner signs it with the release-decision key, over the same
canonical bytes a decision is signed over (`.specs/features/release-decision/prepared-decision.md`
§4.1 and §4.3, with this file's path in place of the decision's), after filling
`decidedAt`.

## What the line is

`0.0.0-qualification.N` builds are signed public releases of a candidate that
the signed `1.0.0` decision holds. Each `.N` is published to npm, served from
the TUF lineage the ledger records, and verified live on the five targets
before `latest` moves to it (`.specs/features/live-activation-matrix/validation.md`).
They are not a stable package release and not a compatibility promise
(`VERSIONING.md`).

The reject stands. `docs/qualification/release-decision-1.0.0.md` (round 1,
reviewed in #397, closing #18) records a hold: the candidate is fit to keep
operating as `0.0.0-qualification` and is not promoted to `1.0.0`. This record
does not reopen, soften, or supersede it. A later round supersedes a hold only
by its own file under `RELEASE-DECISION-CONTRACT.md`, on a fresh candidate.

The posture is single-operator custody (`docs/qualification/acceptance-matrix.md`
L8; `docs/release-custody.md` section 2). The custody model is proposed, not
ratified, and no custodian #2 is named (owner decision, 2026-10-02).

## Exit conditions for a public 0.x line

A `0.x` line opens only by its own signed record of this schema, naming its
first candidate, never by a quiet rename of `package.json`. Every row below
must hold before that record is written. Each names the gap it closes and the
tracked evidence a reviewer opens to check it.

| Condition | Gap | What must be true | Evidence |
| --- | --- | --- | --- |
| X1 | #596 | The next publication, `0.0.0-qualification.9`, goes through `npm-publish.yml` from the `npm-publication` environment with npm trusted publishing, and `npm view verchestra@0.0.0-qualification.9 dist.attestations` shows a provenance attestation. Met on 2026-10-30: run 41004500072 published `.9` from `npm-publication` through trusted publishing with tag `next`, and `dist.attestations` names the provenance predicate `https://slsa.dev/provenance/v1`. Every earlier version was published by hand under the owner's 2FA and carries none. | `.github/workflows/npm-publish.yml`; `docs/release-custody.md:182-212`; `.specs/features/release-custody/handoff.md` |
| X2 | F2, #382 | At least one successful `role-refresh` entry in the publication ledger, from a `t76-refresh-timestamp.yml` run dispatched from `main` and approved in `tuf-release-signing`. Met on 2026-10-29: run 40963107506 re-signed the `.8` snapshot and timestamp at version 8, and the ledger records it as `role-refresh` entry 9. That refresh kept the expiry at the publication horizon, so no short online expiry is in force yet; a cadence with a short `timestampExpires` is the F2 work left. | `docs/qualification/tuf-publication-ledger.json`; `docs/release-custody.md:169-183`; `.github/workflows/t76-refresh-timestamp.yml`; `.specs/features/tuf-timestamp-refresh/handoff.md` |
| X3 | #406 | Pilot P1, attempt 3, on `0.0.0-qualification.8` with the verifier `gpt-5.5`, reaches `HUMAN_REVIEW` and is recorded in the pilot's results table. Attempts 1 and 2 on `.7` stopped before the verifier finished; nothing has yet shown the installed `vestra task` path to its end on a published build. | `.specs/features/live-task-pilot/handoff.md`; `.specs/features/live-task-pilot/validation.md` |
| X4 | #370, L5 | A `self-test --profile smoke` PASS from a non-elevated Windows home directory, on `.9` or later, re-performed and recorded as a J08 record in a tracked file. Today the only such run is the operational reviewer's PR #523 comment of 2026-10-14 on `.7`, which no tracked file records; the acceptance matrix carries it as reported, not re-performed. | `docs/qualification/acceptance-matrix.md` |
| X5 | L2 | A user of the published package can reach a remediation path for the six deep-doctor checks that report `blocked` on a provisioned machine (`cedar-policy`, `connector`, `driver`, `probe`, `sandbox`, `sqlite-durable-state`): either a documented and exercised provisioning for each, or a `doctor` verdict that scopes them. Today the CLI exposes no command for their remediation codes and the documentation describes no provisioning, so a full `doctor` PASS is not reachable by a user. | `docs/qualification/acceptance-matrix.md`; `.specs/features/deep-doctor-live-probes/handoff.md` |
| X6 | L7, #393 | A recorded live update from a `0.0.0-qualification.N` release to a `0.x` candidate, and a rollback to `.N`, across the semver boundary on all five targets through `live-activation-matrix.yml`. Every recorded lifecycle run so far stays inside the line (`.3` to `.4`, then up to `.7` to `.8`); the version comparison a `0.x` launcher makes against a `0.0.0-qualification.N` release has never run live. | `.specs/features/live-activation-matrix/validation.md`; `.github/workflows/live-activation-matrix.yml` |

Clearing a row does not close its gap by itself: the gap closes where it is
tracked, and this table is updated in a reviewed change that cites the record
of the run.

## Condition for a 1.0.0 round 2

| Condition | Gap | What must be true | Evidence |
| --- | --- | --- | --- |
| R1 | L8, RR1 | Section 6a of `docs/release-custody.md`, "Promoting with single-operator custody declared", is in force: the pull request that carries it is approved, under their own GitHub identities, by the operational and the security reviewer, and both reviewers are active for the round. Today the section is proposed, not in force. | `docs/release-custody.md:385-431` |
| R2 | L1 | The round is `release-decision-1.0.0.round-2.md` under `RELEASE-DECISION-CONTRACT.md`: a fresh candidate descending from `3d363f782bad`, its own `gate:release` pass at that candidate, its own operational and security reviewers distinct from the decider and the implementation author, its own signature, and a verdict for each of round 1's reasons (resolved, declared, or still blocking). | `docs/qualification/RELEASE-DECISION-CONTRACT.md`; `docs/qualification/release-decision-1.0.0.md` |

Nothing in this record, and nothing a session can do, satisfies R1 or R2: both
need named humans acting under their own identities.

## Dissent recorded

The version string was called an internal marker while it is public `latest`:
`VERSIONING.md` read "an internal qualification marker" while
`verchestra@0.0.0-qualification.8` was the version every new install
resolved. That was a true description of the string's origin and a false
description of its reach. This record and the `VERSIONING.md` wording it
replaced ("the published qualification line") are the answer to that dissent
until an exit condition above is met. They do not promote anything, and they
do not rename anything.

## Owner signature

The fields `decidedAt` and `signature` are empty until the owner signs. An
empty signature makes `agent:check` report this record as `unsigned`, which is
a warning and never a pass; a present signature that does not verify against
`publicKeyRef` is an error. The record is signed by `decidedBy` alone, as a
decision is; it names no reviewer, because it decides nothing about a
candidate.
