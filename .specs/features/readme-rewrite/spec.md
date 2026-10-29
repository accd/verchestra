# README Rewrite Specification

## Problem statement

The README was 470 lines across 22 headings. It duplicated the quick start,
the site's install page, CONTRIBUTING.md and the data-probe contract, buried
the four things a newcomer needs (what it is, how to run it, what works, what
is ruled out) under operational detail, and carried no diagram a reader could
grasp in a minute. The owner asked on 2026-10-29 for a README that is
friendlier, shorter and more visual, centred on key points and usage, witty in
headings and captions only, and still exact.

## Goals

- A README a newcomer reads in two minutes: definition, status, how to run it,
  the governed task, what works today, what stays local, how the code is laid
  out, where to go next.
- Four GitHub-renderable Mermaid diagrams: the six delivery stages, the
  governed task sequence, the trust boundary, the package layering.
- Every pinned assertion satisfied unchanged.
- Facts that lived only in the README land in their canonical home before the
  README stops carrying them.

## Requirements

| Id    | Requirement                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-01 | `tests/agent-readiness/beta-tester-docs.test.mjs` stays green: `## Beta testers` with the pinned `npx verchestra@<latest>` build, the five-row command table, the SUPPORT and SECURITY anchors; "node 24.14.0 or later"; `### Exit codes` table verbatim with keys 0,1,2,3,4,5,64,70,78; `task check` before `task plan`; the Beta feedback thread link.               |
| RR-02 | `apps/site/tests/unit/product-contract.test.mjs` and `repository-content.test.mjs` stay green: the 13-row capability table matches `capabilityMatrix` cell for cell and is the first `\|` line naming those capabilities.                                                                                                                                             |
| RR-03 | The site build's LLM validators accept the README: H1 then a prose paragraph, no heading-level jump, no `#` comment inside a fence, `0.0.0-qualification` present, no machine-local path.                                                                                                                                                                              |
| RR-04 | `pnpm agent:check` passes: every relative link resolves; the exact license sentence is present.                                                                                                                                                                                                                                                                        |
| RR-05 | Four Mermaid diagrams render on GitHub (quoted labels, no init directives, no line starting with `\|`).                                                                                                                                                                                                                                                                |
| RR-06 | Relocated before deletion: the credential-store details and `doctor --deep` rule into `docs/quick-start.md` section 3; `--dry-run`, idempotent apply and the unadvertised commands into section 2; the probe-scaffold options into `docs/data-probe-contract.md`; the llms.txt paragraph into `docs/contributing-with-agents.md`; `site:preview` and what `site:test` runs into `CONTRIBUTING.md`. |
| RR-07 | Tone: wit in H2 headings and captions only; every sentence with a number, code, platform or maturity word is flat; no emojis, no exclamation marks; no claim of production readiness or 1.0.                                                                                                                                                                           |
| RR-08 | The README carries the AD-017 engine wording and the "published npm package" maturity legend that `site/status-truth` (#692) introduces, so the two branches merge without conflict.                                                                                                                                                                                   |

## Out of scope

- Relocations that touch `apps/site/**` (the init walkthrough into
  `develop-from-source.md`, the handoff sequence diagram into
  `workflows/cross-environment-handoff.md`): a second pull request, because
  changes under `apps/` select `gate:build` and Prettier.
- Any change to the capability table's content; it mirrors `product.ts`.
