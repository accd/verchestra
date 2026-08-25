---
schema: verchestra-qualification-report/v1
task: T75
revision: be92397ca0a5caaf7ff8b70dad23659b09899d7d
gates: pnpm gate:quick, pnpm gate:full, pnpm gate:build, pnpm gate:security, pnpm gate:release
gateResults: pass, pass, pass, pass, pass
gateRevision: be92397ca0a5caaf7ff8b70dad23659b09899d7d
criteriaEvidence: 4 of 4 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 20 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/354
---

# T75 Platform, Security, and Fault Qualification Validation

## Scope and revision binding

This report validates the merged T75 qualification surface at exact revision
`be92397ca0a5caaf7ff8b70dad23659b09899d7d`, which is reachable from
`origin/main` (`git merge-base --is-ancestor` confirmed).

**Authorship is stated plainly rather than claimed as independent.** The
remaining matrices, the evidence-coherence fix, and the workflow repairs in
this task were authored by an agent session operating as the repository owner's
automation. Human review and merge authority were exercised by the owner
(`accd`) on every pull request this report cites. This report does not claim an
independent verifier distinct from the implementation author, because there was
none; `reviewedIn` records where the review actually happened, and the
`Protect main` ruleset governs what merged. Read the accountability from those,
not from this file.

## Deterministic gates

Every profile ran on all five supported platforms at the bound revision.

| Profile | Run | Legs | Result |
| --- | --- | --- | --- |
| `gate:quick` | 32883219310 | 5 | pass |
| `gate:full` | 32883227369 | 5 | pass |
| `gate:build` | 32883235839 | 5 | pass |
| `gate:security` | 32883244056 | 5 | pass |
| `gate:release` | 32883252338 | 5 | pass |

25 legs, all `qualified`, **zero excused**. Platforms: `win32-x64`,
`darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`. Every leg binds its
platform, architecture, runtime (`v24.14.0`), revision, `identityDigest`, and
`legDigest`.

`darwin-x64` qualifies. Earlier handoffs recorded it as an environmental
limitation of the Intel runner queue; at this revision it dequeued and passed
on all five profiles, so no platform case is excused.

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Zero required platform or topology case is skipped | 25/25 legs `qualified`, `excused: []` on every profile; `skipped: 0` and `todo: 0` in every gate. The topology matrix is executable: `tests/unit/topology-placement-matrix.test.mjs` covers the full 5760-configuration cross product and `tests/integration/topology-scan-to-plan-matrix.test.mjs` covers all five relations on a real Git workspace. |
| Zero unauthorized effect escapes policy or egress enforcement | `gate:security` passes on all five platforms; `tests/security/sandbox-isolation-matrix.test.mjs` evaluates all three platform control sets from any runner, and every boundary component has an escape case. |
| Reports bind platform, architecture, runtime, fixture, candidate, and evidence digests | Each of the 25 legs carries all six fields; the index binds `revision` and is regenerable from the committed fleet artifacts, asserted object-for-object by `tests/agent-readiness/t75-evidence-index-drift.test.mjs`. |
| Every supported platform passes the release-candidate security gate | `gate:security` run 32883244056, five legs, all `qualified`. |

## Completion checklist

- **Complete matrix and signed evidence index published.**
  `signed-evidence-index.json` reports `signed: true`;
  `qualification-evidence-index.dsse.json` is a DSSE
  `application/vnd.in-toto+json` envelope with one signature over the bound
  revision. The signing identity was provisioned by the owner, the public
  reference is committed at `docs/qualification/trust/t75-evidence-public-key.json`,
  and no private material is tracked. The attestation was verified **outside**
  the run that produced it, from the committed public key, and again after
  formatting touched the files.
- **Every platform-specific gap resolved without weakening shared contracts.**
  No assertion was weakened, skipped, or deleted. Where a ratchet had to move
  (the census scope-exclusion list, the pinned-action count, the evidence
  revision), it moved deliberately in the same change that justified it.
- **Atomic commits.** Each fix landed as its own reviewed pull request.

## The six matrices

Topology, driver, database, sandbox, installer, and recovery are executable
rather than asserted in prose (`tests/.../ *-matrix.test.mjs`, 117 cases, zero
skipped, zero todo). Sandbox and recovery were already structurally complete
and are recorded as such rather than padded. Three seams had no coverage at all
before this task: scan-to-plan, four-driver parity, and the
install → activate → rollback → uninstall sequence.

## Discrimination sensors

20 mutations were applied and every one was caught, each source restored
byte-identically and verified with `git diff --quiet`. Representative kills: an
absent Codex reporting `available: true` (2 failures); `container-isolated`
becoming advertisable (5); uninstall deleting releases without purge (6); an
eighth `ActivationFaultPoint` (3); a ninth probe engine (5).

## What is not qualified

Two cases are `not-qualified` and named rather than omitted:
`isolation-grade:native-restricted` and `isolation-grade:container-isolated`.
Both are unimplemented product capabilities, and the matrix records that a
grade cannot be advertised until it exists. Eight cases are
`contract-qualified` per AD-017: the non-SQLite database engines carry
contract-kit parity, with live-engine qualification happening at the edge.

## Verdict

**PASS.** 4 of 4 acceptance criteria proven at
`be92397ca0a5caaf7ff8b70dad23659b09899d7d`, with a signed, independently
verifiable evidence index; 52 matrix cases with zero contradictions; 25 gate
legs with zero excused; zero skipped and zero todo across five profiles.
