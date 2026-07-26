---
schema: verchestra-feature-handoff/v1
feature: agent-ready-repository
issue: null
status: blocked
branch: agent/agent-ready-repository
baseRevision: fd585f128d310a6f355a544deee0ae4e5e54aa4f
lastCompletedTask: T8
nextTask: Complete human review, merge to protected main, and verify the deployed Pages endpoints.
lastGate: corepack pnpm agent:check && corepack pnpm gate:quick && corepack pnpm site:test && corepack pnpm site:build
updatedAt: 2026-07-26T00:06:29Z
---

# Scope

Implement AGT-01–AGT-10 and LLM-01–LLM-07 through the tracked T1–T8
delivery plan without changing the T69–T77 product dependency chain.

# Completed Evidence

- Clean clone created from `accd/verchestra` at the recorded base revision.
- Repository, architecture, roadmap, existing website spec, and current state
  inspected.
- GitHub milestone `1.0.0 — Verified release` and requested labels verified.
- Feature specification, design, task plan, decisions, and current repository
  handoff recorded.
- Public status contract passed: 3 tests, 0 failures.
- Root and seven scoped instruction files added; the root is 105 lines.
- Claude and Gemini compatibility pointers match their exact import-only bytes.
- Repository map covers all 17 workspace packages.
- Instruction contract passed: 4 tests, 0 failures.
- Dependency-free context compiler emits schema version 1 and safe
  repository-relative JSON before installation.
- Handoff parser validates frontmatter, blocked requirements, path
  normalization, and allowed transitions.
- `agent:check` validates instructions, pointers, commands, status, links,
  handoffs, budgets, prohibited files, and unsafe tracked context.
- `test:agent-readiness` is part of `gate:quick`: 11 readiness tests and 1,615
  unit tests passed with 0 failures.
- Six provider-neutral feature templates cover context, requirements, design,
  atomic tasks, portable handoff, and independent validation.
- Agent contribution bootstrap, prompt-injection handling, canonical-source
  edits, handoff, verification, and PR preparation are documented.
- Both issue forms and the PR template require acceptance, canonical sources,
  verification, safety, handoff, and human-review readiness; authorship
  disclosure remains optional.
- Readiness suite passes 15 tests; quick gate passes 1,615 unit tests.
- Six-case provider-neutral corpus covers onboarding, domain routing, canonical
  website docs, generated contracts, handoff resume, and malicious text.
- Generic runner uses disposable detached worktrees, validates exact structured
  outcomes/proposed patches, records tool/model versions and a digest, and
  fails closed on malformed results.
- Fake adapter passes all six cases; Claude Code, Codex, and OpenCode/Qwen
  report `not configured` without local profiles.
- Protected-main optional workflow has read-only permissions, no persisted
  checkout credential, sanitized summaries, and 14-day retention.
- Readiness suite passes 19 tests; quick gate passes 1,615 unit tests.
- Root `llms.txt` exactly matches the concise compiler projection.
- Site build emits `/verchestra/llms.txt`, a 520,347-byte attributed
  `llms-full.txt`, and 116 `index.html.md` alternates.
- Full context includes allowlisted project docs, instructions, active feature
  state, site guides/integrations, and contiguous T01–T68 evidence with stable
  ordering and SHA-256 content digests.
- Compiler mutation checks reject duplicate routes, unsafe paths, malformed
  headings, status drift, and output at or above 1 MiB.
- Site check passes 24 unit tests, Astro type checks, 119-page build, link/base
  path checks, output safety, and alternate parity; quick gate remains green.
- Public contributing-with-agents documentation, README and governance
  entrypoints, prompt-injection guidance, navigation, structured metadata,
  robots disclosure, sitemap entries, and text/plain discovery links are
  present.
- Site verification passes 24 unit tests, a 120-page build, 45 Playwright/Axe
  checks across Chromium, Firefox, and WebKit, and Lighthouse assertions.
- `gate:quick` passes 1,615 unit tests and 19 agent-readiness tests.
- Detached clean-clone acceptance at `9649966` proved the JSON context command
  before installation, frozen installation, readiness, quick gate, site test,
  and site build with exit code 0.
- Clean-clone verification passed 1,615 unit tests, 19 readiness tests, 24 site
  unit tests, 45 Playwright/Axe checks across three engines, Lighthouse, and a
  120-page static build.
- Production was probed without mutation: the existing landing page returned
  200 while the new guide and LLM endpoints returned 404 before merge and
  deployment, as expected.
- Independent validation traced all 17 requirements: 14 are fully verified and
  LLM-02, LLM-03, and LLM-06 remain blocked only on public deployment/topics.
- The verifier passed 1,703 counted tests with zero failures or skips,
  Lighthouse, and both 120-page builds in a disposable worktree.
- All eight required discrimination mutations were killed; no implementation
  defect or spec-precision gap was found.

# Next Exact Action

Complete mandatory human review, merge to protected `main`, deploy the gated
Pages artifact, verify public HTTP responses, add the three repository topics,
and create/link the tracking issue.

# Blockers

GitHub issue creation returned `403 Resource not accessible by integration`.
Unblock by granting the connected GitHub integration issue-write access or
creating the issue from an authenticated maintainer session, then record its
number here.

The available GitHub connector exposes no repository-topic write and the
browser session is signed out. Add `agents-md`, `llms-txt`, and
`ai-coding-agents` from an authenticated maintainer session.

Production deployment is intentionally pending mandatory human review, merge
to protected `main`, and the existing GitHub Pages workflow. After deployment,
verify the guide, search, `llms.txt`, `llms-full.txt`, representative Markdown
alternates, sitemap, and robots endpoints return 200.

The available GitHub integration does not expose Dependabot alert reads.
Before closing the tracking issue, an authenticated maintainer must verify the
repository has zero open Dependabot alerts.

# Decisions

- `AGENTS.md` is the only canonical agent instruction source.
- Git/specification/handoff artifacts are durable cross-agent memory.
- Provider compatibility files contain generated import pointers only.
- LLM-readable output is a deterministic projection of canonical content.

# Files Intentionally Left Unchanged

- Product implementation and the T69–T77 roadmap dependency chain.
- Existing generated contracts.
- Machine-local profiles and credentials.
