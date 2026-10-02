---
schema: verchestra-feature-handoff/v1
feature: subscription-provider-auth
issue: null
status: verification
branch: feat/subscription-provider-auth
baseRevision: a6df70a2347d34d0ddec00b99bb5bccef73284dc
lastCompletedTask: T6
nextTask: "Independent verification and human review; the platform matrix on this branch; then the owner's one-time setup, the decisions G1-G3, and the first supervised live run."
lastGate: "Node 24.14.0 macOS arm64 on the tree of b4e7a8b, rebased on main a6df70a: gate:quick PASS (unit 2395, agent-readiness 323, census 13); gate:build PASS (contract 673, integration 861, e2e 236, architecture 69, build 146, qualification 296); gate:security PASS (security 1339, fault 310); qualify:claude 53/53; qualify:codex 20/20; site:check PASS; agent:check PASS; 0 failed, 0 skipped, 0 todo; no provider called"
updatedAt: 2026-10-02T18:00:00Z
---

# Scope

Requirement ADP-A of `.specs/features/architecture-deepening/spec.md` (tasks
TA1 and TA2): let the governed task path authenticate Claude Code and Codex
through subscriptions without weakening the mediated profile's isolation.
Requirements SPA-01..21 in `spec.md`.

# Completed Evidence

T1: `spec.md` (the TA1 evidence with its sources, the gaps G1–G3, and
SPA-01..21), `design.md`, `threat-model.md`, `tasks.md`, and the decision
`AD-044` in `.specs/STATE.md`.

T2: the `mediated-mcp-subscription` profile in
`packages/drivers/src/claude-code-driver.ts`, the fake's own invocation check,
`spikes/claude-code-driver/test/claude-driver-subscription.test.mjs`,
`tests/contract/claude-code-driver-subscription.test.mjs`, and the report
`docs/qualification/claude-code-driver-subscription.md`.

T3: `apps/vestra-cli/src/task/task-codex-identity.ts`, the identity option of
`runCodexVerifier`, `tests/integration/codex-identity.test.mjs`, and the
read-only probe `spikes/codex-driver/test/codex-identity-probe.test.mjs`.

T4: unbilled usage in `packages/application/src/execution/budget-meter.ts` and
the `billing` member of the Run Capsule's budget evidence.

T5: `apps/vestra-cli/src/task-provider-auth.ts`, the wiring in `task-run.ts`,
`task-implementer.ts`, `task-verifier.ts`, `task-plan.ts`, `task-status.ts`,
`task-review.ts`, and `secret-composition.ts`, and the journeys and security
cases for both modes.

T6: `docs/quick-start.md`, `README.md`, and the amended live pilot
pre-registration.

Every requirement is mapped in `validation.md`; ADP-A is mapped in
`.specs/features/architecture-deepening/validation-a.md`.

# Next Exact Action

Independent verification of `validation.md`, then human review. The platform
matrix must run on this branch, because PR CI is Ubuntu-only and the journeys
run their cases on macOS. After merge the owner does the one-time setup in
`docs/quick-start.md` step 3, decides G1–G3, and runs the first supervised
task, which is the first live observation of the subscription profile.

# Blockers

None for review. The live run needs the owner's subscription token and Codex
login, which only the owner can create.

# Decisions

`AD-044` in `.specs/STATE.md`. Open owner decisions:

- **G1** managed Claude Code policy: keep the refusal of the file and MDM
  locations, and decide whether a Team or Enterprise plan (server-managed
  settings, not detectable before a session) is in scope.
- **G2** the Keychain lookup Claude Code may still make for the per-run config
  directory: accept it, given that it cannot find the ambient session.
- **G3** startup requests no documented switch covers: accept them.
- Whether `--include-hook-events` stays if Claude Code reports events for its
  own built-in behaviour: the first live run shows it, and the session fails
  closed with `VES_CLAUDE_HOOK_UNEXPECTED` if so.

# Files Intentionally Left Unchanged

`.specs/features/architecture-deepening/spec.md`, `tasks.md`, and `handoff.md`
(the coordinator owns them). `docs/qualification/claude-code-driver-mediated.md`
and `claude-code-driver-2.1.282.md` (immutable evidence for their revisions).
`schemas/task-request/1.schema.json` (the mode is machine-local by decision).
`.specs/features/governed-task-cli/spec.md`, `design.md`, and
`threat-model.md` (they describe the API-key path, which is unchanged; this
feature's documents state what the subscription path adds). The live pilot's
requests and probes (they name no credential). `complexity-baseline.json`.
`CHANGELOG.md` (it has not tracked task-path changes since #405).
