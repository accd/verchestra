---
schema: verchestra-feature-handoff/v1
feature: init-probe-scaffold
issue: 234
status: verification
branch: feat/234-init-probe-scaffold
baseRevision: e281ba9026d14b26f5d19cb8cde99612fb67178d
lastCompletedTask: T5
nextTask: "T6 — independent review of AD-035 (vendored contract copy, .verchestra/probes/ confinement, .mts format); then rebase onto main after #379 merges"
lastGate: "pnpm gate:quick PASS; pnpm gate:build PASS; pnpm gate:security PASS; pnpm test:e2e PASS; pnpm agent:check PASS"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Issue #234: `vestra init --probe-engine <engine>` emits a deterministic probe
scaffold into the team's repository. Requirements IPS-01 to IPS-12 in
`spec.md`; decision AD-035 in `.specs/STATE.md`. The branch is based on the
local `feat/os-secret-backend` (#379), which is not yet on `origin`.

# Completed Evidence

- `packages/workspace/src/init/probe-scaffold.ts` and
  `probe-scaffold-engines.ts`: the generator for eight engines, keyed by
  engine and `PROBE_CONTRACT_VERSION` 1.
- `apps/vestra-cli/src/main.ts`: `--probe-engine`, `--probe-language`, and
  `--probe-dir` through the existing `SafeInitService` preview and apply.
- Tests and the discrimination sensor are listed in `validation.md`.
- `README.md` (Scaffold a database probe) and `docs/data-probe-contract.md`
  (Scaffolding the probe with `vestra init`).

# Next Exact Action

Submit `feat/234-init-probe-scaffold` for independent review. The reviewer
ratifies or amends AD-035. After #379 merges, rebase onto `main` and rerun
`pnpm gate:build`.

# Blockers

- None in the repository. The branch depends on the unmerged #379 branch.
