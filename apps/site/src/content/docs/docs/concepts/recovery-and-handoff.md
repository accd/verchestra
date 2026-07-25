---
title: Recovery and handoff
description: Resume interrupted work without losing evidence or repeating external effects.
---

Checkpoints capture package identity, completed operations, pending intents, evidence digests, and the last accepted transition.

On resume, Verchestra verifies the source and package, reconciles operations with external systems, and rebuilds local authority. Completed effects are adopted only when their external identity matches the recorded intent.

The same mechanism supports machine recovery and team handoff. The difference is that a new machine must select its own qualified driver and credentials before continuing.
