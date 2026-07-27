# External Review Triage Design

## Approach

One documentation-only feature produces the triage record and seeds every
accepted item with a resumable specification. No product code changes. The
work decomposes into independent document units so each can be reviewed on
its own.

## Mapping

| Review item | Artifact | Roadmap effect |
| --- | --- | --- |
| R1 key lifecycle | `.specs/features/key-lifecycle/` (full spec) | New task T68a before T69 |
| R2 budget enforcement | `.specs/features/budget-enforcement/` (full spec) | New task T68b |
| R3 gate repair loop | `.specs/features/gate-repair-loop/` (full spec) | New task T68c |
| R4 policy hardening | `.specs/features/policy-hardening/` (full spec) | New task T68d |
| R5 DSSE + in-toto | `.specs/features/dsse-attestation/` (decision spec) | Decision required before T76 |
| R6 context tokenizers | `.specs/features/context-tokenizers/` (decision spec) | Decision required before T76; dependency approval gate |
| R7–R11 deferred | GitHub issues, or handoff backlog if blocked | None |
| R12 license | Evaluation + AD in `.specs/STATE.md` | None |
| R13 portability demo | Acceptance evidence inside key-lifecycle spec | Ships with T68a |

## Status-Surface Constraint

`agent:context` derives qualification status from
`docs/qualification/t<N>-validation.md` files, and
`scripts/agent-readiness.mjs:310-311` asserts highest=68/next=69. The phrase
"T68 complete; T69 next" is additionally asserted in
`tests/architecture/agent-instructions.test.mjs:20`, `llms.txt`,
`apps/site/scripts/check-built-site.mjs:123,145`, and site contract tests.
Therefore this feature inserts T68a–T68d into `ROADMAP.md` only, with an
explicit note that derived status surfaces migrate to "T68a next" as a
deliberate, separately reviewed change when T68a implementation starts. This
keeps every gate green without weakening any assertion.

## License Evaluation Design

1. Enumerate copyright holders with `git log --format='%an <%ae>'`.
   Result: `Antonio David <accd.rj@gmail.com>`, `Test <test@test.com>`
   (local test identity, owner-confirmed), `dependabot[bot]` (trivial
   dependency bumps). Single-author project; relicensing is legally
   feasible once the owner confirms the `Test` identity.
2. Present GPL-3.0-only versus Apache-2.0 trade-offs to the owner.
3. If Apache-2.0 is chosen, change in one atomic edit set:
   `package.json:6`, `LICENSE` (full Apache-2.0 text), `README.md:5` badge,
   `CONTRIBUTING.md:56`, `apps/site/src/pages/index.astro:22`,
   `apps/site/src/pages/community.astro:36`,
   `apps/site/src/layouts/ProductLayout.astro:108`.
   The GPL mentions in `tests/unit/governed-skill-registry.test.mjs:87` and
   `tests/contract/skill-update-lifecycle.test.mjs:55` are skill-registry
   fixture data, not project license statements — left unchanged.
4. Record the outcome as an architecture decision in `.specs/STATE.md`
   either way.

## Roadmap Edit Design

Insert into `ROADMAP.md`:

- Mermaid chain: `T68 --> T68a --> T68b --> T68c --> T68d --> T69`.
- One-line description per inserted task matching the accepted specs.
- A note that T68a–T68d originate from the external review triage, are a
  human re-prioritization decision, and that R5/R6 carry mandatory pre-T76
  decisions.

## Verification Design

- `pnpm agent:check` validates handoff frontmatter, status consistency, and
  Markdown links across all new files.
- `pnpm gate:quick` proves no test or assertion regressed.
- `pnpm site:check` / `site:test` run additionally if the license change
  touches site sources.
- `git status` confirms only intended files changed.
