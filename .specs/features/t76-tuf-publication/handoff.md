---
schema: verchestra-feature-handoff/v1
feature: t76-tuf-publication
issue: 17
status: in_progress
branch: codex/issue-17-t76-tuf-publication
baseRevision: a1445169344802686c6a0500c96c815f7f6fae63
lastCompletedTask: T3
nextTask: "Bind publication to real isolated build outputs and run independent TUF view/rollback verification."
lastGate: "Focused 16-test publisher/census suite, typecheck, agent:check, complexity, ESLint, Prettier, gate:quick, and gate:release PASS; zero failures/skips/todos"
updatedAt: 2026-08-25T00:00:00Z
---

# Scope completed

The publisher verifies a candidate and exact component bytes, emits signed
TUF root/delegation/timestamp/snapshot/targets metadata, and derives
consistent-snapshot target names. The existing TUF update client resolves the
publication in all four source modes and rejects post-publication byte changes.

# Remaining work

No private key was generated or accessed. The publisher is not yet wired into
the real isolated build workflow, public/mirror/offline/air-gapped release
views are not yet published as a qualified candidate, and rollback execution
evidence plus the independent T76 report are still required before #17 closes.
