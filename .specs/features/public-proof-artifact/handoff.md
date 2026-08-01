---
schema: verchestra-feature-handoff/v1
feature: public-proof-artifact
issue: 155
status: verification
branch: feat/155-execution-package-artifact
baseRevision: d243d9cb750dfa4523ed58c457788cb514516f46
lastCompletedTask: T4
nextTask: Independent verification and human review of the implementation PR
lastGate: pnpm gate:quick
updatedAt: 2026-08-01T15:00:00Z
---

# Scope

One real, deterministic, regenerable Execution Package published on the site
and linked from the README, with drift protection. Specification only; no
design, tasks, or implementation exist yet — the flow stopped after Specify
by owner instruction.

# Next Exact Action

Independent verification of the implementation PR, then human review and
merge. After merge, #155 closes: the artifact, page, README link, drift
tests, and sensor evidence are all in.

# Blockers

None.

# Decisions

- First artifact is an Execution Package (owner-approved); seed is the
  canonical execution-package fixture input (the same input the qualified
  cross-backend delivery journey builds from); route is
  `docs/proof/execution-package` (owner approved defaults with "FAÇA TUDO").
- Determinism closed with a committed TEST-ONLY Ed25519 key; all other
  inputs were already pinned. See design.md.
- The site consumes committed, reviewed bytes only; generation never runs in
  deploy. NestJS: not applicable.
