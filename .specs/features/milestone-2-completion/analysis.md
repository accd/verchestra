# Milestone 2 operating reconciliation — 2026-08-22

This is the current, evidence-led operating record for the verified-release
programme. It supersedes the 2026-08-09 planning snapshot. The source revision
was `251f5f7a6406353015e54c34903e6ca1bc79a5fe`; GitHub issue state and the
tracked qualification reports were checked on the same date.

## Derived position

- The product remains `0.0.0-qualification`.
- `corepack pnpm agent:context` derives **T74 complete; T75 next** from
  `docs/qualification/t74-validation.md`.
- #16 and #36 were reopened because their original acceptance criteria remain
  incomplete. A closed issue is not qualification evidence.
- The active operating backlog contains ten obligations: #58, #207, #294,
  #16, #17, #36, #18, #234, #235, and #236. Only the first seven belong to
  Milestone 2; the final three are explicitly post-1.0 work.

## Critical path

`#58 + #207 + #294 → #16/T75 → #17 + #36/T76 → #18/T77 → #234/#235/#236`

| Obligation | Current evidence | Remaining honest outcome |
| --- | --- | --- |
| #58 | Canonical JSON V2 and several migration slices are merged; the compatibility matrix deliberately defers durable effect identities, signed execution evidence, and release activation. | Complete a fresh classified census, then version each remaining portable identity with backward verification or a tested presentation-only exception. |
| #207 | Doctor's seven subsystem checks still use file presence probes. | Read-only live observations, async probe collection, source-mode `blocked`, and architecture/sensor proof. |
| #294 | The T75 evidence index is intentionally unsigned. | Public `PublicKeyRef`, qualification-index predicate, exact-SHA regeneration, DSSE/in-toto signing workflow, and external verification. The owner must provision the protected private-key secret. |
| #16 / T75 | Five platform/profile dispatches and the composed verifier are recorded, but no signed index or T75 report exists. | Re-run the candidate matrix after prerequisites, bind and sign the index, obtain independent validation by MiguelCorre, then atomically advance T75 → T76. |
| #17 / T76 | No reproducible release candidate exists. | Reproducible bundle, SBOM/license/provenance/TUF closure and independently verified T76 report. |
| #36 | `resolveActiveLauncher()` exists, but no publishable npm bootstrap or clean-machine proof exists. | Minimal public `vestra` bootstrap, trusted publishing, and clean-machine evidence as part of T76. |
| #18 / T77 | Not started. | Canonical acceptance matrix, immutable-candidate revalidation, independent sensor, and signed human operational/security decision. |
| #234 | Post-1.0 open issue. | Deterministic `vestra init --probe-engine` scaffold, no automatic AI call. |
| #235 | Post-1.0 open issue. | Out-of-process `verchestra-probe/1` worker/supervisor with bounded, sanitized protocol evidence. |
| #236 | Post-1.0 open issue. | Six Node SEA artefacts with signed supply-chain and offline/rollback evidence. |

## Non-negotiable operating rules

- A change receives one focused branch, one logical commit, one PR, relevant
  gates, independent verification, and human review before merge.
- Authorized automation may create branches, commits, PRs, issue updates and
  rebase merges, but never uses a ruleset bypass to replace human review.
- No private key, passphrase, npm token, environment value, or provider session
  is read, logged, committed, or added to an artifact. Missing provisioning is
  `blocked`, never a pass.
- T77 may promote neither `1.0.0` nor a public installer unless a human
  operational and security decision records PASS. Until then all status
  surfaces retain `0.0.0-qualification`.

## Handoff reconciliation

The historical feature handoffs associated with GitHub-closed issues are
marked `complete` in this programme change so `agent:context` no longer treats
them as present work. The following are active because their issue or actual
uncompleted scope remains open: `milestone-2-completion`, `canonical-json`,
`platform-qualification-matrix`, and `npx-launcher`. New feature directories
are created with their respective implementation PRs for #207, #294, #234,
#235, and #236.
