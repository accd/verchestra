---
schema: verchestra-feature-handoff/v1
feature: t76-release-candidate
issue: 17
status: in_progress
branch: codex/issue-17-real-inputs
baseRevision: f13ae8e5855d8430dbdfe558d8171305663962b5
lastCompletedTask: T4
nextTask: "Execute exact-SHA builds on all supported targets with five passing gate-evidence inputs, then construct the candidate and approved TUF publication before independent replay."
lastGate: "reproducible target-builder suite 3/3; typecheck and agent:check PASS; gate:quick, gate:security, and gate:release PASS with zero failures/skips/todos; independent review pending"
updatedAt: 2026-08-25T03:45:00Z
---

# Scope completed

The first T76 slice now has a deterministic `ReleaseCandidate` contract. It
binds the exact source revision, hermetic bundle digest, all four distribution
view descriptors, license/SBOM/provenance/evaluation component digests, and a
verified rollback target. `verifyReleaseCandidate` rebuilds the canonical
closure and rejects mutations.

# Remaining work

PRs #316–#319 implement and test the incremental collector, evidence
generator, candidate materializer, TUF publisher, filesystem publication, and
activation/rollback paths. This branch adds the real build boundary that reads
the exact revision and host target assets and refuses incomplete gate evidence.
It still does not constitute a qualified public candidate: all five target
dispatches, approved signing/TUF wiring, qualified source views, independent
replay, rollback verification, an independently authored T76 report,
public-service publication, release-key custody, and human review remain open.
