---
schema: verchestra-feature-handoff/v1
feature: probe-host-composition
issue: 235
status: planned
branch: docs/ad-037-ratified
baseRevision: f03189724bb907dad4c256ae10db934630235427
lastCompletedTask: null
nextTask: "The owner reviews plan.md (slice 1: register, approve, list, revoke and check a workspace probe worker). Only after that review: derive checks.md from it, then build."
lastGate: "validate_plan.py: 0 errors, 1 warning (one open question recorded on purpose); agent:check PASS"
updatedAt: 2026-10-28T18:30:00Z
---

# Evidence

AD-037 was ratified by the owner on 2026-10-28, as amended on 2026-10-27. The
owner then chose slice 1 (register, approve and check, with nothing spawned)
and that slice 2's grant is a `CapabilityGrant` recorded under a run in the
authority store. `plan.md` is the T3 plan for slice 1. No check or code exists.

# Next exact action

The owner reviews `plan.md`, in particular `Flow`, `Impact` (the lock
placeholder `task plan` hashes), and `Landing` doors 2 and 3 (signing under the
existing `approval` purpose and the approval record's location). After that,
derive `checks.md`.
