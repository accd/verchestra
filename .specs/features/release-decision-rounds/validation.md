# Release decision rounds — validation

All test evidence is in `tests/agent-readiness/release-decision.test.mjs`
(abbreviated `rd.test.mjs`); all implementation is in
`scripts/agent-readiness.mjs` (abbreviated `ar.mjs`). Line numbers are at
commit `2f4287b`.

| Requirement                                                         | Evidence (file and assertion)                                                                                                                                                                                                                                                                                                                                                                                                                | Result |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| RDR-01 round 1 unchanged; the committed hold verifies byte for byte | `rd.test.mjs:578` reads the committed `release-decision-1.0.0.md`, resolves its committed key, asserts no round field (`:586`) and no error from the full per-file rules including signature verification (`:587`); `:589` the same bytes under a round 2 name are refused. `git diff 534236829e7f -- docs/qualification/release-decision-1.0.0.md` is empty. `pnpm agent:check` PASS reads it through `readReleaseDecisions` with Git trust | PASS   |
| RDR-02 later-round names; misnamed and misnumbered files refused    | `ar.mjs:299` `RELEASE_DECISION_FILE`, `ar.mjs:597` `readDecisionRound`; `rd.test.mjs:603` reads version and round from three names, `:611` rejects four near-misses; `rd.test.mjs:675` `.round-1`, `.round-02` and `.round2` each produce a named error and `:680` the misnamed promote never takes effect                                                                                                                                   | PASS   |
| RDR-03 round fields bind to the name; round 1 carries none          | `ar.mjs:368` `checkDecisionRound`; table `rd.test.mjs:616`, rows `:617`-`:619` (round 1 with each field), `:621` (round 3 in a round 2 file), `:627` (no `round`); each row asserts exactly one error (`:659`), named by the round's file (`:660`), naming the rule (`:661`)                                                                                                                                                                 | PASS   |
| RDR-04 the signature covers the round fields                        | `ar.mjs:507` signs every field but `signature`; `rd.test.mjs:567` a correctly signed round 2 is accepted; `:571` for each of `round`, `supersedes`, `supersedesDigest`, a signature over every claim except that field is refused with exactly `signature does not verify against publicKeyRef`                                                                                                                                              | PASS   |
| RDR-05 one file per version and round; no gap                       | `ar.mjs:637` `admitDecisionRound`, `ar.mjs:696` gap check; `rd.test.mjs:460` (renamed, assertion kept: `:477`, `:478`); succession table `rd.test.mjs:707` rows `:709` (gap), `:716` (no round 1), `:723` (two files claiming round 2)                                                                                                                                                                                                       | PASS   |
| RDR-06 a promote is final                                           | `ar.mjs:648` `checkSupersession`; row `rd.test.mjs:733`                                                                                                                                                                                                                                                                                                                                                                                      | PASS   |
| RDR-07 `supersedes` names the immediate predecessor                 | `ar.mjs:368`; rows `rd.test.mjs:633` (round 2), `:639` (round 3 naming round 1), `:645` (absent)                                                                                                                                                                                                                                                                                                                                             | PASS   |
| RDR-08 earlier rounds immutable                                     | `ar.mjs:648` digest comparison against bytes hashed in `readDecisionRound`; `rd.test.mjs:683` turns the space after `decision:` in round 1 into a tab after round 2 was signed: byte length unchanged (`:690`), round 1's own signature still verifies, and the only error is round 2's digest mismatch (`:694`); the effective decision falls back to round 1 (`:697`); digest form row `rd.test.mjs:651`                                   | PASS   |
| RDR-09 `decidedAt` strictly later                                   | `ar.mjs:660` `checkRoundInstant`; rows `rd.test.mjs:740` (equal), `:747` (earlier)                                                                                                                                                                                                                                                                                                                                                           | PASS   |
| RDR-10 fresh candidate that descends from the previous one          | `ar.mjs:672` `checkFreshCandidate` through `isAncestor` (`ar.mjs:249`, shared with `isTrustedRevision`); rows `rd.test.mjs:756` (same candidate), `:763` (round 2 names an older trusted commit)                                                                                                                                                                                                                                             | PASS   |
| RDR-11 every round validated in full                                | `ar.mjs:597` calls `validateReleaseDecision` for every round; `rd.test.mjs:536` the three-round chain is clean only because each round passes the full per-file rules with Git trust, the register, and the signature; succession harness `rd.test.mjs:780` asserts round 1 stays error-free in every row                                                                                                                                    | PASS   |
| RDR-12 effective decision and history                               | `ar.mjs:696` `settleDecisionRounds`; `rd.test.mjs:542` round 1 alone, `:553` round 3 promote is effective with all three rounds in history, `:557` round 1's bytes untouched; `:785` a refused round never takes effect in any succession row                                                                                                                                                                                                | PASS   |
| RDR-13 consumers                                                    | the only consumer is `checkReleaseDecisions` (`pnpm agent:check`), which reads the round-aware errors. `agent:context`, the site loader, and the status surfaces do not read decision files (spec Design 8). `pnpm agent:check` PASS                                                                                                                                                                                                         | PASS   |
| RDR-14 contract                                                     | `docs/qualification/RELEASE-DECISION-CONTRACT.md`: rule paragraph, "Additional frontmatter for a later round", nine new fail-closed rows, "That a later round answered the earlier one", historical marker on the introduction sentence                                                                                                                                                                                                      | PASS   |
| RDR-15 nothing weakened                                             | No assertion was removed or loosened; every pre-existing test passes unchanged except the rename below                                                                                                                                                                                                                                                                                                                                       | PASS   |

## Renamed and deleted tests

| Before                                         | After                                                    | Why                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "a version may have at most one decision file" | "a version may have at most one decision file per round" | The old name became false once a version may have later rounds. Its assertions (`rd.test.mjs:477`, `:478`, two files declaring 1.0.0 round 1) are unchanged. The old name is a prefix of the new one, so `docs/qualification/t77-validation.md:215`, an immutable report that cites it, still finds it. |

No test was deleted.

## Discrimination sensor (each mutation made in place, run, then restored)

Every mutation was applied to the committed file, the focused test file was
run, and the file was restored from its committed content; `git status` was
clean afterwards.

| Mutation                                                                                                                             | Killed by                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **(a)** Fixture: after round 2 and 3 are signed in the clean-chain test, flip one byte of round 1 (space after `decision:` to a tab) | `a later round supersedes a hold without editing it and becomes the effective decision`                 |
| (a′) Code: drop the `supersedesDigest` comparison                                                                                    | `an earlier round edited after the next was signed breaks the next round, even unseen by its signature` |
| **(b)** Remove the "promote is final" check                                                                                          | `a release decision round is refused for a round that follows a promote`                                |
| Drop the `decidedAt` ordering                                                                                                        | the equal-instant and earlier-instant rows                                                              |
| Drop the ancestry check                                                                                                              | `... for a candidate the previous round's candidate is not an ancestor of`                              |
| Drop the same-candidate check                                                                                                        | `... for the previous round's candidate decided again`                                                  |
| Drop the gap check                                                                                                                   | the gap row and the no-round-1 row                                                                      |
| Effective decision ignores validity                                                                                                  | 8 tests (the tamper test and every succession row)                                                      |
| Round fields left out of the signed bytes                                                                                            | 4 tests, including `the signature covers round, supersedes, and supersedesDigest`                       |
| Misnamed round files skipped silently                                                                                                | `a round suffix outside the convention is refused rather than skipped`                                  |
| Round 1 allowed to carry round fields                                                                                                | the three round-1 rows                                                                                  |
| Duplicate rounds admitted                                                                                                            | `a version may have at most one decision file per round` and the two-files row                          |
| Filename round not compared with frontmatter round                                                                                   | the committed-hold test and two per-file rows                                                           |
| `supersedes` not compared with the previous round                                                                                    | the three `supersedes` rows                                                                             |

14 killed, 0 survived.

## Gates (this branch, Node 24.14.0)

| Command                                                       | Result                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `node --test tests/agent-readiness/release-decision.test.mjs` | PASS: 71 tests (48 before), 0 failed, 0 skipped, 0 todo                                                           |
| `pnpm test:agent-readiness`                                   | PASS: 354 tests, 0 failed, 0 skipped, 0 todo                                                                      |
| `pnpm test:architecture`                                      | PASS: 122 tests, 0 failed, 0 skipped, 0 todo                                                                      |
| `pnpm test:census`                                            | PASS: 13 tests (after `pnpm census:refresh`)                                                                      |
| `pnpm complexity:check`                                       | PASS: 174 baselined hotspot keys, nothing above 10 unaccounted                                                    |
| `pnpm agent:check`                                            | PASS                                                                                                              |
| `pnpm gate:quick`                                             | PASS: format, lint, complexity, typecheck; unit 2666, agent-readiness 354, census 13; 0 failed, 0 skipped, 0 todo |
| `pnpm site:check`                                             | not run: the site does not project the contract or any decision file (spec Design 8), and no site source changed  |

`gate:full`, `gate:build`, and `gate:security` were not run locally because
the machine is short of disk; the pull request CI and the platform matrix run
them.

## Guardrails

- Complexity: no new hotspot and no baseline key changed; every new function
  is at or below 10.
- Census: `scripts/agent-readiness.mjs` digest signal 3 → 4 (the new
  `createHash` hashes raw file bytes, not structured JSON); classification
  unchanged.
- No `<file>.ts:<line>` citation of a moved file exists; `agent-readiness.mjs`
  line citations in docs and `.specs` are to qualification reports and the
  dossier, which are not changed.
- Intentionally unchanged: `docs/qualification/release-decision-1.0.0.md`,
  `docs/release-custody.md`, `docs/merge-governance.md`,
  `docs/qualification/acceptance-matrix.md`, every qualification report,
  `apps/site` (no projection of the contract), and
  `.specs/features/release-decision/spec.md`, a completed feature whose
  "at most one file per version" now reads as history superseded by this
  feature.
