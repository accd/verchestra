# Verchestra Specification State

## Decisions

### AD-001 — GitHub Pages website architecture

- **Status:** active
- **Decision:** Build the public website as the private `@verchestra/site` Astro workspace package and deploy static output through GitHub Actions to `https://accd.github.io/verchestra/`.
- **Rationale:** The website belongs with the product source, requires no runtime service, and must be reviewed and qualified with the same repository controls.

### AD-002 — Public website truth boundaries

- **Status:** active
- **Decision:** Repository Markdown remains canonical; website-only guides may live in the site package, and build-time adapters may project canonical documents without changing their source.
- **Rationale:** Public presentation must not create a second, drifting architecture or qualification record.

### AD-003 — Public status language

- **Status:** active
- **Decision:** The site describes `0.0.0-qualification`, T68 complete, and T69 next. It must not claim a public installer, production readiness, or a 1.0 release.
- **Rationale:** Evidence and release state take precedence over marketing language.

### AD-004 — Canonical agent instructions

- **Status:** active
- **Decision:** `AGENTS.md` is the only canonical agent instruction format; scoped files refine root rules and provider compatibility files are generated import-only pointers.
- **Rationale:** A provider-neutral hierarchy keeps a clean clone understandable without duplicated or drifting rules.

### AD-005 — Durable cross-agent memory

- **Status:** active
- **Decision:** Git, tracked specifications, decisions, tasks, validation evidence, and feature handoffs are the authoritative cross-agent memory.
- **Rationale:** Contribution and resumption must not depend on chat history, provider memory, an IDE, MCP, or an installed skill.

### AD-006 — LLM-readable content projection

- **Status:** active
- **Decision:** LLM-readable repository and website output is generated only from allowlisted canonical repository content and never becomes a second source of truth.
- **Rationale:** AI retrieval should preserve provenance, current qualification state, and the existing documentation authority boundary.

### AD-007 — Project license is Apache-2.0

- **Status:** active
- **Decision:** The project license changes from GPL-3.0-only to Apache-2.0, decided by the repository owner on 2026-07-26 after the external review triage (`.specs/features/external-review-triage/`).
- **Rationale:** The product targets enterprise adoption (auditable handoffs, Cedar, first-class enterprise database adapters); permissive licensing removes legal-department friction, and Apache-2.0 keeps an explicit patent grant. Authorship was verified with `git log`: the project is effectively single-author (owner plus the owner's local `Test` identity and trivial Dependabot bumps), so no external consent is required.
- **Consequences:** `package.json`, `LICENSE`, `README.md`, `CONTRIBUTING.md`, and site pages (`index.astro`, `community.astro`, `ProductLayout.astro`) were updated in the same change. The GPL strings in `tests/unit/governed-skill-registry.test.mjs` and `tests/contract/skill-update-lifecycle.test.mjs` are skill-registry fixture data, not project license statements, and remain unchanged. Commits made before this decision stay historically GPL-licensed; the new terms apply from this change forward.

### AD-008 — External review re-prioritization (T68a–T68d)

- **Status:** active
- **Decision:** Four tasks from the verified external review triage are inserted into the product chain between T68 and T69: T68a key lifecycle, T68b budget enforcement, T68c declarative gate repair, T68d policy hardening. DSSE/in-toto and context-tokenizer decisions are mandatory before T76.
- **Rationale:** The review's blocker (ephemeral keys breaking cross-machine verification) and the cheap, high-value controls (budget, repair, policy) gate the product's central portability promise; existing T01–T68 evidence and T69–T77 numbering are preserved.
- **Consequences:** Derived status surfaces (`agent:context`, root `AGENTS.md`, `llms.txt`, site contracts) still assert "T68 complete; T69 next" and are migrated deliberately as part of starting T68a, with the corresponding gate-script and contract-test updates reviewed in that change.

## Handoff

- **Feature:** `lighthouse-performance-budget` (issue #110)
- **State:** T1-T7 complete. First Verifier pass returned FAIL (LPB-03 unattributed, LPB-02 sample-size deviation undocumented, this file stale); both content gaps fixed with real evidence and the deviation logged in `spec.md`. Awaiting re-verification. See `.specs/features/lighthouse-performance-budget/tasks.md` Execution Evidence and `validation.md`.
- **Branch:** `fix/lighthouse-performance-budget`, pushed to `origin` (user's fork `brunomjanuario/verchestra`); PR **#139** open against `accd:main`, not merged.
- **Classification:** instability (B2) — CI-side sample `{0.92 (PR #108, historical), 1, 1, 1, 1}` (4 fresh CI runs of pre-remedy code): median = 1, minimum = 0.92. Logged as `N=5` not the spec's `N=10` (deviation rationale in `spec.md` Assumptions table): sampling further after the remedy lands would measure the new 3-run-median config, not the single-run config being classified, and the two values that decide the verdict can't move with more passing draws.
- **Remedy:** `apps/site/lighthouserc.cjs` — `numberOfRuns: 1 → 3`, added `assert.aggregationMethod: "median"` (default `"optimistic"` would let one good run mask two bad ones). `categories:performance` threshold unchanged at `0.95`. Verified on real CI (job time 2m55s → 3m43s, well under the 45-min budget).
- **Discrimination sensor:** injected a 1.5s main-thread-blocking script into gitignored `apps/site/dist/` (never committed) — confirmed fails (`performance: 0.86`, FCP/Speed Index carry the loss, LCP/CLS assertions still pass), confirmed passes clean. Reproduced twice; second pass captured full per-metric numbers to close the LPB-03 gap.
- **Gates:** `pnpm gate:quick` 97/97 pass. `pnpm gate:release` (selected because this diff touches `.github/workflows/ci.yml`) fails locally only in `spikes/sqlite` (missing `fts5` in this machine's Node v23.11.0, confirmed unrelated — that path isn't in the diff); CI's `Quality gate` job runs the identical gate-selection output on the qualified Node v24.14.0 and passed on every run of this branch.
- **Next:** Re-dispatch the Verifier against commit range `4c0ce07..HEAD` to confirm the two fixed gaps and the STATE.md staleness gap are resolved. If PASS, the feature is done pending human review/merge of PR #139 — this agent will not merge it (human-review boundary, `AGENTS.md`).
- **Note:** other features (`budget-enforcement`, `gate-repair-loop`, `policy-hardening`, `canonical-json`, `isolation-process-tree`, `opencode-cancellation-race`, `probe-value-declassification`) have their own in-progress/verification state tracked in their individual `handoff.md` files under `.specs/features/`; this section only reflects the session's active feature.
