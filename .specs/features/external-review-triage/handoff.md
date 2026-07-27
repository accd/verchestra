---
schema: verchestra-feature-handoff/v1
feature: external-review-triage
issue: null
status: verification
branch: docs/external-review-triage
baseRevision: 6e0af0527d35080f178eafcfae7f00eb289378bd
lastCompletedTask: T7
nextTask: merge
lastGate: pnpm gate:quick
updatedAt: 2026-07-27T18:13:33Z
---

# Scope

Triage a verified external review of `main` at `6e0af05` into tracked
specifications, a human-decided roadmap re-prioritization (T68a–T68d), a
license decision record, and backlog issues for deferred multipliers.
Documentation only; no product code, no status-surface migration.

# Completed Evidence

Every review claim verified read-only against code; two claims corrected
(work-claims IS wired via `task-executor.ts:392,521`; the 1287-line
`handoff.ts` lives in `packages/application/src/handoff/`). Full
specifications written for T68a key-lifecycle, T68b budget-enforcement,
T68c gate-repair-loop, T68d policy-hardening; decision specifications for
dsse-attestation and context-tokenizers (mandatory before T76). `ROADMAP.md`
inserts T68a–T68d without renumbering. License changed GPL-3.0-only →
Apache-2.0 per owner decision (single-author verified via `git log`);
recorded as AD-007, roadmap insertion as AD-008 in `.specs/STATE.md`.
Deferred items filed as GitHub issues #33 (parallel scheduler), #34 (probe
evidence wiring), #35 (cross-driver verification), #36 (install friction),
#37 (handoff.ts split). Gates: `agent:check` PASS, `gate:quick` PASS, site
unit/types/build/built-checks PASS, Playwright chromium e2e 17/17 PASS
(details in `validation.md`).

# Next Exact Action

Open the PR for branch `docs/external-review-triage`, wait for required
checks (Quality gate, Site quality), squash-merge, and verify post-merge CI
plus the deployed Pages endpoints.

# Blockers

None.

# Decisions

- R1–R4 accepted for near-term work; R5–R6 accepted as mandatory pre-T76
  decisions; R7–R11 deferred to GitHub issues #33–#37; R13 folded into R1
  acceptance.
- Roadmap insertion uses T68a–T68d; T69–T77 keep their numbers to preserve
  evidence traceability.
- Status surfaces asserting "T69 next" are NOT migrated in this feature;
  migration is part of starting T68a and requires its own reviewed change
  touching `scripts/agent-readiness.mjs:310-311`, `AGENTS.md:6`,
  `tests/architecture/agent-instructions.test.mjs:20`, `llms.txt`, and site
  contract tests (recorded in AD-008 consequences).
- The ROADMAP.md heading avoids "T69" so the visible-first text assertion
  in `apps/site/tests/e2e/site.spec.ts:82` keeps matching visible content.

# Files Intentionally Left Unchanged

- All product packages, schemas, and generated contracts.
- `AGENTS.md`, `llms.txt`, and `docs/architecture.md` (status-surface
  migration deferred to T68a start).
- The GPL strings in skill-registry test fixtures (fixture data, not
  project license statements).
