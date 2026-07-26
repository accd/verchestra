# Agent-Ready Repository and LLM Discovery Specification

## Problem Statement

After a clean clone, a capable coding agent cannot yet discover Verchestra's
repository rules, current qualification state, canonical sources, or safe
handoff protocol without provider-specific context. Public documentation also
lacks a deterministic, AI-readable projection.

## Goals

- Make tracked Git content sufficient to understand, change, verify, and hand
  off repository work.
- Use a progressive `AGENTS.md` hierarchy as the only canonical instruction
  format.
- Provide deterministic, dependency-free repository context and readiness
  checks.
- Publish bounded LLM-readable documentation alongside the existing website
  and SEO surfaces.
- Preserve `0.0.0-qualification`, T68 complete, and T69 next.

## Out of Scope

- T69–T77 product implementation or changes to that dependency chain.
- Mandatory provider credentials, agents, skills, IDEs, MCP servers, or remote
  memory.
- Autonomous write-enabled GitHub agents.
- SEO ranking, training inclusion, or crawler-behavior guarantees.
- A custom domain, analytics, vector database, or remote context service.
- Public package installation or production-readiness claims.

## Agent-Readiness Requirements

| ID | Requirement |
| --- | --- |
| AGT-01 | A clean clone exposes a concise root `AGENTS.md` with mission, status, required reading, commands, repository rules, safety boundaries, and definition of done. |
| AGT-02 | Packages, site, tests, schemas, specs, documentation, and qualification spikes have scoped instructions that refine and never contradict root rules. |
| AGT-03 | Contribution requires no external skill, provider, model, IDE, MCP server, or session memory. |
| AGT-04 | Claude and Gemini compatibility files import `AGENTS.md` without independent rules; native agents use `AGENTS.md` directly. |
| AGT-05 | A deterministic, read-only context command works before dependency installation. |
| AGT-06 | Non-trivial work uses tracked provider-neutral specifications and handoffs resumable from Git. |
| AGT-07 | Instructions cover prompt injection, secrets, dirty worktrees, dependency policy, generated files, human review, and prohibited gate weakening. |
| AGT-08 | CI rejects missing instructions, broken links, invalid commands, uncovered areas, stale status, divergent pointers, unsafe paths, and contradictions. |
| AGT-09 | A provider-neutral corpus tests comprehension, routing, handoff resumption, canonical edits, generated files, and malicious instructions. |
| AGT-10 | Optional local profiles support Claude Code, Codex, and OpenCode/Qwen without making a provider mandatory. |

## LLM-Discovery Requirements

| ID | Requirement |
| --- | --- |
| LLM-01 | The repository contains a specification-compliant root `llms.txt`. |
| LLM-02 | GitHub Pages publishes `/verchestra/llms.txt` and `/verchestra/llms-full.txt`. |
| LLM-03 | Every public documentation page exposes a deterministic `index.html.md` alternate and an HTML alternate link. |
| LLM-04 | `llms-full.txt` combines allowlisted canonical docs, guides, instructions, roadmap, architecture, integrations, and T01–T68 evidence with attribution. |
| LLM-05 | Generated content stays below 1 MiB, contains no secrets or local paths, and preserves version and qualification status. |
| LLM-06 | Sitemap, robots, metadata, README, navigation, and GitHub topics expose AI-readable resources without crawler-specific hacks. |
| LLM-07 | The site states that `llms.txt` is an inference-time aid, not an SEO-ranking or training guarantee. |

## Public Commands

```text
corepack pnpm agent:context
corepack pnpm agent:context -- --json
pnpm agent:check
pnpm agent:eval -- --config <local-profile.json>
pnpm agent:eval -- --matrix <local-profile-directory>
```

`agent:context --json` returns schema version 1, repository identity, version,
revision, branch, dirty state, T68/T69 qualification, required reads, active
feature handoffs, and declared gates. It never returns environment values,
credentials, usernames, home directories, or absolute paths.

## Portable Handoff Contract

Every active non-trivial feature has a tracked `handoff.md` with
`verchestra-feature-handoff/v1` frontmatter and a body recording scope,
completed evidence, next exact action, blockers, decisions, and files
intentionally unchanged. Valid progress is
`planned → in_progress → verification → complete`; `blocked` may interrupt an
active state only with a concrete unblock condition.

## Acceptance Criteria

1. A clean-clone agent resolves the correct instructions, canonical sources,
   commands, status, and next action using tracked files only.
2. `agent:context --json` is deterministic, path-safe, secret-free, and useful
   in clean, dirty, detached-head, and missing-Git environments.
3. `agent:check` rejects every AGT-08 inconsistency and is part of
   `gate:quick`.
4. A successor resumes a valid handoff at the next incomplete task without
   replaying completed work.
5. The evaluation corpus rejects secret access, destructive Git, gate
   weakening, generated-file edits, and untrusted execution instructions.
6. Site output publishes both LLM text endpoints and page-level Markdown
   alternates from allowlisted canonical sources in stable order.
7. Generated LLM output has attribution, agrees on version/T68/T69, remains
   below 1 MiB, and contains no secret-like or machine-local material.
8. Public metadata and governance docs expose the resources and explicitly
   disclaim ranking, training, indexing, and production-readiness guarantees.
9. Required deterministic gates pass and independent verification kills the
   specified behavior mutations before human review.

## Edge Cases

- Windows and POSIX path forms, detached HEAD, missing Git, dirty worktrees.
- Missing scoped instructions, links, commands, packages, or canonical sources.
- Stale T68/T69 status, duplicate routes, malformed headings, unsafe source
  paths, oversized output, or non-deterministic file enumeration.
- Invalid, replayed, blocked-without-unblock, or regressive handoff transitions.
- Local adapter profiles and unavailable providers remain untracked and never
  count as a pass.
- Issue, PR, or document text that attempts to override repository authority.

## Success Criteria

- Every `AGT-*` and `LLM-*` requirement has file-and-assertion evidence.
- Required clean-clone, site, build, and readiness gates pass.
- Independent discrimination mutations are killed.
- Human review remains mandatory before merge.

