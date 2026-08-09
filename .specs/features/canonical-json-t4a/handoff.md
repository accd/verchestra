---
schema: verchestra-feature-handoff/v1
feature: canonical-json-t4a
issue: 58
status: in-progress
branch: feat/canonical-json-t4a-chain-digests
baseRevision: f1c72a067037d681c16c8d623be1fbe2493daf95
lastCompletedTask: null
nextTask: T1
lastGate: none yet
updatedAt: 2026-08-09T00:00:00Z
---

# Scope

T4a of issue #58: migrate the four unqualified-chain digest owners introduced
by T72-T74 (`promotion-gate.ts`, `campaigns.ts`, `doctor.ts`,
`self-test.ts`) to V2 canonical JSON before their qualification reports
freeze their bytes. Full plan: `spec.md`, `tasks.md`.

# Next action

Begin T1: add `formatCanonicalDigestV2` to `packages/domain`.
