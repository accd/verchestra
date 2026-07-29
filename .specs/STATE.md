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

- **Feature:** `external-review-triage`
- **State:** T1–T5 complete; T6 (GitHub backlog issues) and T7 (final gates) in progress
- **Branch:** `main`
- **Completed:** Verified triage of the external review (11 claims, 2 corrected), full specifications for T68a–T68d, decision specifications for DSSE and context tokenizers, roadmap insertion of T68a–T68d, and the Apache-2.0 license change with AD-007/AD-008.
- **Verification:** `pnpm agent:check` and `pnpm gate:quick` run in T7; site gates run for the license change.
- **Next:** Create GitHub issues for deferred items R7–R11 (or record the permission blocker), run final gates, and mark the triage handoff ready for independent review.
