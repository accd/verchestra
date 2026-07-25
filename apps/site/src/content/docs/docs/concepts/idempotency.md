---
title: Idempotency
description: Make initialization, execution, recovery, and handoff converge safely.
---

Idempotency means repeating an operation produces the same accepted state instead of duplicate effects.

Verchestra applies stable operation keys to workspace initialization, tracker projection, Git effects, probe runs, package transitions, and recovery. Before an external effect, it records intent; after the effect, it records verifiable completion.

If a process crashes between those points, recovery inspects the external state and either adopts the completed effect or safely retries. It does not guess.

This is what lets a second developer continue the workflow on a different driver without recreating issues, comments, commits, or evidence.
