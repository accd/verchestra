---
schema: verchestra-feature-handoff/v1
feature: probe-host-composition
issue: 235
status: in_progress
branch: feat/235-extension-commands
baseRevision: f03189724bb907dad4c256ae10db934630235427
lastCompletedTask: null
nextTask: "Build slice 1 against checks.md (32 checks), then dispatch an independent Verifier over the feature range."
lastGate: "validate_plan.py 0 errors; validate_checks.py 0 errors, 0 warnings (profile light); the owner approved plan.md as written on 2026-10-28"
updatedAt: 2026-10-28T19:00:00Z
---

# Evidence

AD-037 was ratified by the owner on 2026-10-28, as amended on 2026-10-27. The
owner then chose slice 1 (register, approve and check, with nothing spawned)
and that slice 2's grant is a `CapabilityGrant` recorded under a run in the
authority store. `plan.md` is the T3 plan for slice 1. No check or code exists.

# Next exact action

Build slice 1 against `checks.md`: write the tests each check names, implement,
run every proof, and commit. Then dispatch a fresh Verifier.
