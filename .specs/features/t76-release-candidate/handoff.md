---
schema: verchestra-feature-handoff/v1
feature: t76-release-candidate
issue: 17
status: in_progress
branch: codex/issue-17-candidate-manifest
baseRevision: 1f034e3be8b0252963208d8bab26e3839c68f558
lastCompletedTask: T4
nextTask: "Dispatch t76-candidate-build.yml at an exact reviewed SHA, materialize and verify the candidate closure from all five target artifacts, then publish and independently replay TUF views."
lastGate: "HEAD 99152c8 plus T4 workflow; builder suite 3/3, candidate suite 3/3, workflow contract suite 6/6; prior gate:quick and gate:release PASS; dispatch and independent review pending"
updatedAt: 2026-08-25T06:00:00Z
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
the exact revision and host target assets and refuses incomplete gate evidence,
plus a candidate-materialization boundary that verifies payload bytes and
derived projections before emitting the canonical candidate closure.
It still does not constitute a qualified public candidate: all five target
dispatches, approved signing/TUF wiring, qualified source views, independent
replay, rollback verification, an independently authored T76 report,
public-service publication, release-key custody, and human review remain open.
