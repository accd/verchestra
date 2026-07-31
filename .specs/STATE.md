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
- **State:** Phase A (diagnose) done; Phase B blocked on CI data before a remedy can be chosen. See `.specs/features/lighthouse-performance-budget/tasks.md` Execution Evidence.
- **Branch:** `fix/lighthouse-performance-budget` (pushed to `origin`, the user's fork `brunomjanuario/verchestra`; not pushed to `upstream`)
- **Completed:** T1/T2/T3 — 10 local Lighthouse runs against a production build all scored a perfect `performance: 1` with near-zero variance (LCP ~322ms, TBT 0ms). Per the spec's pre-registered decision rule (LPB-02), this classifies as **"not reproduced locally"**, not deterministic and not instability — local hardware is faster than the shared `ubuntu-latest` CI runner and cannot surface the same CPU-bound cost.
- **Blocker:** `ci.yml` only triggers on `push: [main]` or `pull_request: [main]` (`ci.yml:3-7`); a branch push alone does not run `Site quality`. The user chose to open the PR (draft, on their own fork only) themselves rather than have this agent do it, to get a real CI-runner score distribution.
- **Next:** Once the user reports the PR's `Site quality` / Lighthouse run URL or scores, re-enter T2's decision rule with CI data as authoritative (branch B3 in `tasks.md`), then implement the corresponding remedy (T4a optimize / T4b fix sampling), record timing against the 45-minute job budget (T5), add the discrimination sensor (T6), and run final gates + Verifier (T7). No file under `apps/site/` has been modified yet — Phase A's exit gate (diagnose only, no edits) has been honored.
- **Note:** other features (`budget-enforcement`, `gate-repair-loop`, `policy-hardening`, `canonical-json`, `isolation-process-tree`, `opencode-cancellation-race`, `probe-value-declassification`) have their own in-progress/verification state tracked in their individual `handoff.md` files under `.specs/features/`; this section only reflects the session's active feature.
