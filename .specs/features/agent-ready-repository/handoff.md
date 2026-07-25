---
schema: verchestra-feature-handoff/v1
feature: agent-ready-repository
issue: null
status: in_progress
branch: agent/agent-ready-repository
baseRevision: fd585f128d310a6f355a544deee0ae4e5e54aa4f
lastCompletedTask: T4
nextTask: T5
lastGate: pnpm gate:quick
updatedAt: 2026-07-26T00:07:00Z
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

# Next Exact Action

Add the provider-neutral evaluation corpus, deterministic fake adapter, generic
runner, ignored local profiles, and protected optional live matrix.

# Blockers

GitHub issue creation returned `403 Resource not accessible by integration`.
Unblock by granting the connected GitHub integration issue-write access or
creating the issue from an authenticated maintainer session, then record its
number here.

# Decisions

- `AGENTS.md` is the only canonical agent instruction source.
- Git/specification/handoff artifacts are durable cross-agent memory.
- Provider compatibility files contain generated import pointers only.
- LLM-readable output is a deterministic projection of canonical content.

# Files Intentionally Left Unchanged

- Product implementation and the T69–T77 roadmap dependency chain.
- Existing generated contracts.
- Machine-local profiles and credentials.
