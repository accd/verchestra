---
schema: verchestra-feature-handoff/v1
feature: t76-release-candidate
issue: 17
status: in_progress
branch: codex/issue-17-t76-materialize-evidence
baseRevision: 79024f300b6471ee08fa8dfecf48cde4cee205c8
lastCompletedTask: T5
nextTask: "Obtain independent verification of the candidate, four source views, filesystem publication, and rollback execution."
lastGate: "Focused materializer/TUF/filesystem-publication/rollback suite, typecheck, agent:check, complexity, ESLint, Prettier, gate:quick, and gate:release PASS; zero failures/skips/todos"
updatedAt: 2026-08-25T01:00:00Z
---

# Scope completed

The first T76 slice now has a deterministic `ReleaseCandidate` contract. It
binds the exact source revision, hermetic bundle digest, all four distribution
view descriptors, license/SBOM/provenance/evaluation component digests, and a
verified rollback target. `verifyReleaseCandidate` rebuilds the canonical
closure and rejects mutations.

# Remaining work

PRs #316–#319 supply the isolated artifact inputs, deterministic supply-chain
evidence, four signed TUF source views, filesystem publication, and activation/
rollback execution proof. This is not a public release and does not satisfy
#17 by itself. The next verifier must independently replay the candidate and
all four views, inspect the rollback evidence, and author the T76 validation
report. Public-service publication, release-key custody, and human review
remain open.
