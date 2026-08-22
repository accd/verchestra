# Feature Tasks — milestone-2-completion

Each row is independently reviewable. The branch name follows
`codex/issue-<n>-<slug>` for issue work; reports and status-chain changes are
single-purpose PRs.

| Task | Scope | Depends on | Required evidence and gates |
| --- | --- | --- | --- |
| P0 | Reconcile the remote `main`, reopen #16/#36, replace stale programme state, and classify historical handoffs. | None | `agent:context`, `agent:check`, `gate:quick`, reviewed documentation PR. |
| P1 | #58: complete canonicalization census and version remaining portable digest identities, including effects, signed evidence, hermetic bundle and activation. | P0 | Compatibility matrix with no unclassified portable path; V1/V2 fixtures and sensor; `gate:quick`, `gate:security`. |
| P2 | #207: replace Doctor presence-only probes with asynchronous, read-only live observations. | P0 | Unit/integration/security and architecture sensor; source mode reports `blocked`; `gate:quick`, `gate:security`. |
| P3 | #294: sign T75 qualification evidence through protected GitHub Actions custody. | P0 | Public key ref, predicate/schema, exact-SHA regeneration and external DSSE/in-toto verification; `gate:quick`, `gate:security`. Protected secret provisioning is owner-only. |
| P4 | #16/T75: qualify one immutable candidate and advance the chain. | P1, P2, P3 | Five profiles on five targets, signed zero-contradiction index, MiguelCorre report, `t75-validation.md`, `gate:quick/full/build/security/release`, human-reviewed atomic status advance. |
| P5 | #17 and #36/T76: build the reproducible candidate and public bootstrap. | P4 | Formal T76 specification; SBOM/licenses/provenance/TUF/rollback; trusted npm publishing; clean-machine `npx vestra` evidence; independent report; `gate:quick`, `gate:release`. |
| P6 | #18/T77: final qualification and promotion decision. | P5 | Canonical 98-criterion/12-journey matrix, immutable-candidate rerun, independent final sensor, operational and security human signed decision; `gate:release`. |
| P7 | #234, #235, #236: post-1.0 scaffolding, out-of-process probes, and six SEA artefacts. | P6 PASS | Separate specs/PRs; their issue-specific architecture, contract, integration, security, build, release, platform, offline and rollback evidence. |

## Merge protocol

1. The author pushes a focused branch and PR; required checks are tied to its
   exact head.
2. A distinct verifier maps acceptance criteria to assertions and runs a
   discrimination sensor. A reviewer must be human and satisfy the current
   GitHub ruleset.
3. Only after approval, resolved conversations and required checks may the PR
   be rebase-merged and its branch deleted. The merge result is checked on
   `origin/main` by content, not only by API state.
4. An unmet secret/publishing/reviewer/final-decision prerequisite changes the
   handoff to `blocked`; it does not alter evidence or relax a gate.
