---
schema: verchestra-feature-handoff/v1
feature: strands-subscription-integration
issue: null
status: in_progress
branch: codex/strands-subscription-integration
baseRevision: 7e274f237648251b972081471134623097122c16
lastCompletedTask: T1
nextTask: "Owner: review setup-draft.md, confirm the threat-model assumptions (D7), and decide D1-D9 in spec.md; then mark T2 complete and start T3, T4, and T7 in parallel worktrees."
lastGate: "Node 24.14.0 macOS arm64 on the tree of this commit: agent:check PASS; gate:quick PASS (unit 2666, agent-readiness 331, census 13); 0 failed, 0 skipped, 0 todo; validate_spec 0 errors 0 warnings; validate_tasks 0 errors 1 warning; no provider called; docs/ unchanged so site:check not required"
updatedAt: 2026-10-03T21:00:00Z
---

# Scope

The owner's approved plan ("Integrate Strands into Verchestra with the current
subscriptions"): an optional coordination module on `@strands-agents/sdk` 1.19.0 that
runs one governed task as a single agent, a Graph, or a Swarm of Claude Code
and Codex sessions, on subscriptions only, with suspension and manual resume on
quota exhaustion, and a Windows bridge transport. Requirements SSI-01..85 in
`spec.md`; tasks T1–T10 in `tasks.md`.

# Completed Evidence

T1: worktree from `origin/main` at `7e274f2`, equal to the remote HEAD the plan
analysed; frozen install; baseline gates in `validation.md`.

T2 (awaiting the owner): `spec.md`, `design.md`, `threat-model.md`,
`tasks.md`, `validation.md`, `research.md`, `setup-draft.md`, and eight
decision entries "to be numbered at merge" after AD-067 in `.specs/STATE.md`.
`validate_spec.py` and `validate_tasks.py` report no error; the 39 installed
skill files match their pinned hashes. T2 completes when the owner has
reviewed `setup-draft.md` and the threat-model assumptions and decided D1–D9.

# Next Exact Action

1. The owner reviews `setup-draft.md` (edits, accepts, or declines it) and
   answers D1–D9 and D7 in `spec.md` and `threat-model.md`.
2. Mark T2 complete in `tasks.md` and here, and write the setup configuration
   only if the owner accepted the draft, in its own commit.
3. Start T3 (contracts), T4 (driver results), and T7 (Windows transport) in
   separate worktrees from this branch; T5 waits for T3, T4, and decision D1.

# Blockers

- D1 (required SDK peers) blocks T5 commit 3; D2 (sealed build check) blocks T5
  commit 5; D6 and a Windows machine with PowerShell 7 block T7's last commit
  and the Windows pilot.
- Live pilots (T9) need the owner's subscriptions on each platform.

# Decisions

Proposed in `.specs/STATE.md` (numbered at merge): coordination behind the
executor's driver port through one SDK subpath; Task Request v2 binds the whole
normalized descriptor; Verchestra enforces destinations, results, and limits;
suspension as an executor checkpoint stage; subscription-only coordinated runs;
two Driver event types; the Windows named-pipe transport; the metafile-based
sealed build check. Open owner decisions: D1–D9 in `spec.md`.

# Files Intentionally Left Unchanged

All product code, schemas, `package.json` files, and `pnpm-lock.yaml` (this
task specifies; it adds no dependency). `docs/` (no projected document changes
until T8). `AGENTS.md`, `CLAUDE.md`, and `docs/agents/` (the setup draft is not
applied). `.specs/features/architecture-deepening/` (owned by the
coordinator). The `## Handoff` section of `.specs/STATE.md` (this file is the
feature's portable handoff). The SDK pack and probes stay in the ignored
`.tmp/`.
