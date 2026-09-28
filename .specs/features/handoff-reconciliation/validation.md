# Handoff reconciliation validation

Issue: #407. Base: `origin/main` at `20071a78eb5b96b9de63e5e9c863b6997643c767`.

Author and verifier are the same session, and no independent review is
claimed. The next action in `handoff.md` asks for that review.

## File-to-evidence reconciliation

| Handoff | Before | After | Complete, with evidence | Still open, with owner | Next action |
| --- | --- | --- | --- | --- | --- |
| `release-decision` | `verification`; next T7/T8 | `complete`, T8 | **T7:** `9d5d6e3` verifies the Ed25519 signature over the §4.1 body (`scripts/agent-readiness.mjs` `decisionSignatureBytes`; `tests/agent-readiness/release-decision.test.mjs`). **T8:** `045a73b`, `e0c1d2a`, `62ccde4`, PR #397 merged 2026-08-28. `docs/qualification/release-decision-1.0.0.md` records `decision: reject` with three distinct identities and a signature that verifies against `docs/qualification/trust/release-decision-public-key.json`. | Nothing in this feature. A future promote round is separate work on a fresh candidate: #408, #382, #387, #379, #405, #406. AD-033 still reads "proposed"; ratifying it is the owner's call. | None for this feature. |
| `t75-evidence-signing` | `blocked`; next provision secret and PublicKeyRef | `complete`, T3 | Public reference in `84ae20a` (`docs/qualification/trust/t75-evidence-public-key.json`). Signed attestation in `11f9318`: `signed-evidence-index.json` has `signingState.signed: true`, key id `t75-evidence-20260825`. `docs/qualification/t75-validation.md:65-73` records verification outside the producing run. Acceptance-matrix L16 marks it resolved. | No independent human verifier is claimed (`t75-validation.md:23-32`); owner #408. | None for this feature. |
| `t76-artifact-inputs` | `in_progress`; next dispatch, materialize views and rollback | `complete`, T4 | `t76-validation.md:48-62`: candidate run 32927839487 at `a49f3dd`, 25 of 25 profile executions pass. `:64-71`: publication run 32929312169 with a sealed prior rollback index. Views were made auditable in `bc2280f` and proven cross-adapter equivalent in `f8fa711` (acceptance-matrix L6). | Independent verification (#408). Live client rollback (#387, #393). | None for this feature. |
| `t76-release-candidate` | `in_progress`; next dispatch, publish, independent replay | `complete`, T4 | Same T76 evidence. The `ReleaseCandidate` contract sealed the candidate that run 32929312169 consumed. `t76-validation.md:176-221` records R2 serving (990 assets verified) and npm publication. | Independent replay and independent report (#408). Key custody is single-operator (acceptance-matrix L8; #408). Live rollback (#387, #393). | None for this feature. |
| `t76-release-materialization` | `in_progress`; next independent verification | `complete`, T5 | Materializer and filesystem publisher output is the tree run 32929312169 emitted and R2 serves (`t76-validation.md:64-71,176-195`). | Independent verification was **not** obtained (`t76-validation.md:33-44,248-256`; #408). Live rollback (#393). | None for this feature. |
| `t76-supply-chain-evidence` | `in_progress`; next materialize documents from the real build | `complete`, T4 | The real target builder binds `license`, `sbom`, `provenance`, and `evaluation` (the `tests/build/reproducible-target-build.test.mjs` case "the real target builder binds exact revision, host assets, and all supply-chain evidence", T76 sensor mutation 2). The candidate targets were sealed by run 32927839487. | Independent validation (#408). The T76 report does not list the four documents individually; that is a wording limit, not a task. | None for this feature. |
| `milestone-2-completion` | `verification`; next PR reviews, T75 signing, T75 report | `blocked` | P0 `dc482e2`/`71ab3a5`/`8f2d05d`. P1: #58 closed (`b738b04`, `44c7a85`, `190e06f`, `e469dbd`). P2: #207 closed. P3: `84ae20a`, `11f9318`. P4: `3365a47`. P5: `aa59ba7`, `5514322`. P6: `bee42fa`, `9722d03`, and the signed hold in `62ccde4`. | M2C-04, an independent verifier, is unmet (acceptance-matrix L1): #408. M2C-07: #234, #235, #236 are open (post-1.0, after a promote). | Resolve #408, then start a fresh promotion round. |
| `canonical-json-t4-completion` | `in_progress`; next T1 of T4j | `in_progress`, T20 | T4j `b738b04` (T4j validation: "Verdict: PASS"). T4k `44c7a85`, with follow-ups `5a530c4`, `95b2b80`, `6f77378`. The census has no `pending-versioned-migration` entry. T4i `190e06f`, `e469dbd`. #58 closed. | **T21**: `tests/security/canonical-json-locale-allowlist.test.mjs` has 9 duplicate keys in `MATRIX_CEILINGS` and 5 in `UNCLASSIFIED_CEILINGS` (counted by parsing the file). **No open issue.** T22 and T23 were superseded by #58's closure. | The maintainer files an issue for T21 or takes it as a focused security change. |
| `canonical-json` | `complete`; `nextTask` pointed at T4j/T4k | `complete`; `nextTask` corrected | Same #58 commits. | None; T21 is tracked in `canonical-json-t4-completion`. | None. |
| `live-activation-matrix` | `verification`; next ".3 closes J02" | `blocked` | Runs 33087399859, 33091253051, and 33092399993: activation, self-test, and recovery pass 5 of 5, and `.2` activates fresh (`validation.md`). | J02 update and rollback. `republish-v3-runbook.md` finding 2: `.3` changes the root, so v1 and `.2` cannot update in place. Finding 3: anti-rollback. Owners #387 and #393. | Owner key, then `.3` (#387), then a later same-root release, then re-run `base=.3`/`update=.4`. Rollback follows the #393 decision. |
| `tuf-role-separation` | `in_progress` | `blocked` | Role separation `1ee646e`; monotonic `metadataVersion` guard `5ac3122`. | The online key and anchor are absent from `docs/qualification/trust/` (owner). `.3` (#387). #382 is open. The runbook's line 92 claim that the #382 routine exists is false; the runbook is not edited here. | The owner provisions the online key and anchor, then step 4, then the runbook for `.3`. |
| `agent-ready-repository` | `verification`; next add topics | `verification`, unchanged | T1 to T8. The topics were re-checked read-only on 2026-09-29: 12 topics, none of `agents-md`, `llms-txt`, or `ai-coding-agents`. | LLM-06 topics. **No open issue.** | A maintainer adds the three topics, reads them back, and marks the handoff `complete`. |
| `deep-doctor-live-probes` | `verification`; next human-trigger the platform matrix | `blocked`, T21 | T1 to T21 in PRs #302 and #306; #207 closed. | **T22 (DDL-14)**: none of the five fleet files under `platform-qualification-matrix/fleet/` mentions doctor, and `platform-matrix.yml` has no doctor step (the grep count is 0 for each). **No open issue.** #379 may keep `secret-presence` in `blocked`. | The maintainer files an issue, adds a reviewed doctor-capture step, and dispatches it at an exact SHA. The owner may instead re-scope DDL-14. |

## Requirement evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| HR-01 | Table above: every named handoff, plus `canonical-json`, which acceptance-matrix L18 cites. | Verified |
| HR-02 | Each audited handoff carries a dated "Reconciliation" or "reconciled" section with the complete, open, and next split. Superseded text sits under "historical" headings. Six audited handoffs stay non-complete, each with an owner or an explicit "no issue". | Verified |
| HR-03 | `.specs/features/release-decision/handoff.md`, frontmatter and "Reconciliation". `tasks.md` rows T7 and T8, and the §5 "Closed" note. | Verified |
| HR-04 | `.specs/features/live-activation-matrix/handoff.md` "Next (reconciled …)" and `validation.md` "Correction to the recorded next step". The withdrawn single-`.3` step is kept only as history. | Verified |
| HR-05 | `pnpm agent:context` before and after (branch report). The six stale entries for `release-decision`, `t75-evidence-signing`, and the four T76 slices are gone. `milestone-2-completion`, `live-activation-matrix`, `tuf-role-separation`, `deep-doctor-live-probes`, `canonical-json-t4-completion`, and `agent-ready-repository` remain listed with their corrected next actions. | Verified |
| HR-06 | `git diff --stat` for this change touches only `.specs/`. No file under `docs/qualification/`, `docs/requirements-register.json`, `ROADMAP.md`, or `package.json` `version` changes. | Verified |

## Transition notes

`validateHandoffTransition` is not applied across revisions. This change moves
handoffs as follows:

- `blocked` to `complete`: `t75-evidence-signing`.
- `in_progress` to `complete`: the four T76 slices.
- `in_progress` to `blocked` and `verification` to `blocked`: allowed by the
  transition rule.

For the moves to `complete`, the qualification report named in each row is
the verification step. No handoff moves out of `complete`.
