# Milestone 2 operating reconciliation — 2026-08-23

This is the current, evidence-led operating record for the verified-release
programme. It supersedes the 2026-08-09 planning snapshot. The source revision
is `190e06f50e5a0b014013bda4dd7618104db3182a` (`origin/main`); GitHub issue
state and the tracked qualification reports were checked against that exact
revision.

## Derived position

- The product remains `0.0.0-qualification`.
- `corepack pnpm agent:context` derives **T74 complete; T75 next** from
  `docs/qualification/t74-validation.md`.
- #16 and #36 were reopened because their original acceptance criteria remain
  incomplete. A closed issue is not qualification evidence.
- The programme contains ten obligations: #58, #207, #294, #16, #17, #36,
  #18, #234, #235, and #236. The first seven are the Milestone 2 path; the
  final three are explicitly post-1.0 work. GitHub currently reports #207 and
  #294 closed because their implementation PRs merged, but their remaining
  evidence and owner-only prerequisites still gate T75 and are not silently
  promoted by issue state.

## Critical path

`#58 + #207 + #294 → #16/T75 → #17 + #36/T76 → #18/T77 → #234/#235/#236`

| Obligation | Current evidence | Remaining honest outcome |
| --- | --- | --- |
| #58 | The source-derived census and signed-evidence Execution Package slice are merged; PR #307 merged at `190e06f`. The inventory still contains pending versioned portable identities and the release/activation vertical. | Finish the T4j release-identity and T4k census work, then migrate each remaining portable identity with backward verification or a tested presentation-only exception. |
| #207 | PR #302/#306 merged live, read-only Doctor probes and the async sentinel bracket. The issue is closed, but the T75 fleet dispatch (T22) is still a human-triggered evidence step. | Run the exact T75 matrix workflow, preserve source-mode `blocked`, and bind the resulting observations into the independent T75 report. |
| #294 | PR #303 merged the fail-closed DSSE/in-toto signer and exact-SHA workflow. No private key or public `PublicKeyRef` has been provisioned in the repository. | The owner must provision the protected Actions secret and matching public reference; then regenerate and independently verify the signed index. Missing custody remains `blocked`, never an unsigned pass. |
| #16 / T75 | Five platform/profile dispatches and the composed verifier are recorded, but no signed index or `docs/qualification/t75-validation.md` exists. | Re-run the candidate matrix at one immutable SHA after #58/#207/#294 prerequisites, bind and sign the index, obtain validation from the owner-designated independent verifier, then atomically advance T75 → T76. |
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
