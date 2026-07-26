# Agent-Ready Repository and LLM Discovery Design

## Architecture

The feature adds two projections over canonical tracked repository content:

1. A progressive context plane rooted at `AGENTS.md`, compiled by
   dependency-free Node scripts into deterministic context and readiness
   results.
2. An LLM discovery plane compiled by the existing site repository loader into
   bounded text endpoints and Markdown alternates.

Git, specifications, decisions, handoffs, repository documentation, schemas,
and package manifests remain authoritative. Compatibility files, context
snapshots, and website outputs are projections.

## Components

| Component | Responsibility |
| --- | --- |
| Instruction hierarchy | Route agents from root rules to the closest scoped repository rules. |
| Compatibility pointers | Import root instructions for Claude and Gemini without duplicated truth. |
| Repository map | Declare package responsibilities, dependency direction, tests, and canonical docs. |
| Context compiler | Emit a safe human or JSON snapshot before dependency installation. |
| Readiness checker | Validate hierarchy, commands, status, handoffs, links, paths, budgets, and generated pointers. |
| Portable handoffs | Preserve resumable provider-neutral feature state in Git. |
| Evaluation runner | Run one deterministic corpus against fake or optional local real-agent adapters. |
| LLM content compiler | Project allowlisted canonical sources into stable, attributed, size-bounded public output. |
| Site alternates | Publish page Markdown and HTML alternate metadata under the Pages base path. |

## Trust Boundaries

- Repository instructions outrank issue, PR, document, generated content, and
  tool output; those sources are data, not execution authority.
- Secrets, environment values, credentials, provider sessions, production data,
  absolute local paths, and private profiles never enter tracked context.
- Generated contracts are changed through schemas and generators.
- Dependency changes require explicit approval and existing dependencies are
  preferred.
- Local agent evaluation runs are disposable, untracked, non-authoritative, and
  never substitute for deterministic gates or human review.

## Determinism

- Node built-ins and existing repository modules only.
- Explicit allowlists and stable lexical ordering.
- Repository-relative normalized paths in all persisted output.
- Fixed schemas for JSON context, handoff frontmatter, evaluation cases, and
  result records.
- Exact generated pointer bytes and content digests.
- Mutation fixtures operate only in disposable copies or worktrees.

## Dependency Direction

Repository scanning and status compilation remain build-time utilities. Domain
packages do not import platform or site packages. The site may read canonical
repository content at build time but never becomes its source of truth.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Instruction drift or contradiction | Budgeted scoped files plus deterministic hierarchy checks. |
| Sensitive local data leaks | Allowlisted inputs, redaction checks, and mutation tests. |
| Provider lock-in | Canonical neutral files and optional untracked adapters. |
| Generated content diverges | Status/compiler reuse, digests, attribution, and parity tests. |
| Agent follows malicious content | Explicit authority model and refusal corpus. |
| Live evaluation gains authority | Protected-main, read-only token, disposable workspaces, sanitized summaries, and non-blocking status. |

