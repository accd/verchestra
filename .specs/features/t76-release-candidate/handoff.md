---
schema: verchestra-feature-handoff/v1
feature: t76-release-candidate
issue: 17
status: in_progress
branch: codex/issue-17-t76-candidate
baseRevision: 00f0cc12de77c802d95e5ab3936ed401a533bd99
lastCompletedTask: T3
nextTask: "Build real target artifacts, generate supply-chain evidence, and publish independently verifiable TUF views."
lastGate: "Focused release-candidate build/security tests pending"
updatedAt: 2026-08-24T00:00:00Z
---

# Scope completed

The first T76 slice now has a deterministic `ReleaseCandidate` contract. It
binds the exact source revision, hermetic bundle digest, all four distribution
view descriptors, license/SBOM/provenance/evaluation component digests, and a
verified rollback target. `verifyReleaseCandidate` rebuilds the canonical
closure and rejects mutations.

# Remaining work

This is not a public release and does not satisfy #17 by itself. The next
implementer must supply real isolated build outputs, SBOM/license closure,
provenance and signatures, TUF root/delegations, offline/air-gapped views,
rollback execution evidence, and an independently authored T76 report.
