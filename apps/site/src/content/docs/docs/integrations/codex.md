---
title: Codex
description: How the Codex App Server driver provides bounded analysis and verification.
---

Verchestra integrates Codex through App Server rather than a one-shot prompt wrapper. The driver binds thread and turn identity, validates the authorized tool manifest, and converts protocol events into structured evidence.

The current qualification is deliberately capability-specific. A Passport may allow read-only orchestration, analysis, or independent validation without granting project-writer authority.

If the installed CLI version, protocol schema, model, or approval behavior differs from the qualified evidence, the environment is quarantined until requalification. There is no silent fallback to a weaker interface.
