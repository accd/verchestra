# README Relocations to the Site Specification

## Problem statement

The README rewrite of 2026-10-29 (`docs/readme-rewrite`, #694) drops two
pieces of content that have no other home: the walkthrough of `init` run from
a source checkout (the `--dry-run` preview, the apply, the no-op repeat, the
probe-scaffold variant, and the note that `bootstrap`, `sync`, and
`workspace reconcile` are not advertised yet), and the Mermaid sequence
diagram of a cross-environment handoff. Both belong in hand-written site
guides under `apps/site/src/content/docs/docs/`: the first next to the clone
and gate steps of "Develop from source", the second next to the numbered
handoff description in "Cross-environment handoff". Without this change the
rewritten README and the site together say less than the old README did.

## Goals

- "Develop from source" carries the `init` walkthrough with a
  repository-relative CLI path, never a `/path/to/...` placeholder.
- "Cross-environment handoff" carries the sequence diagram the README used
  to carry, rendered by the site's existing client-side Mermaid path.
- Neither guide claims more than the repository does: `init` is the part
  composed into the CLI today; the 1.0 decision stays a signed hold; nothing
  says production-ready.
- Hand-written guides keep linking only to hand-written site routes,
  qualification reports, or GitHub, as `scripts/agent-readiness.mjs` enforces
  through `pnpm agent:check`.

## Requirements

| Id     | Requirement                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RRS-01 | `develop-from-source.md` has a `## Initialize a workspace from the checkout` section after the clone and gate steps, with the `node apps/vestra-cli/bin/vestra.mjs init --dry-run ...` block (workspace id, name, placement, JSON output) and no absolute placeholder path.         |
| RRS-02 | The section states that `--dry-run` is read-only and returns the canonical ordered plan, that the apply repeats the command without `--dry-run`, that the identical apply is a no-op, and that `bootstrap`, `sync`, and `workspace reconcile` are intentionally not advertised yet. |
| RRS-03 | One sentence covers the probe scaffold: `--probe-engine` with the eight engines, the `.verchestra/probes/<engine>` target, the shared preview and apply, and a link to `https://github.com/accd/verchestra/blob/main/docs/data-probe-contract.md`.                                  |
| RRS-04 | `workflows/cross-environment-handoff.md` carries the README's `sequenceDiagram` in a fenced `mermaid` block after the numbered list, introduced by one sentence that keeps the "`init` is the part composed into the CLI today" qualification.                                      |
| RRS-05 | Both guides keep their `title` and `description` frontmatter, so `apps/site/tests/unit/documentation-contract.test.mjs` still passes; the handoff page keeps the h1 `Cross-environment handoff` that `site.spec.ts` pins.                                                           |
| RRS-06 | The built handoff route renders a `.mermaid-diagram` with `role="img"` containing an `svg`, and no `pre[data-language="mermaid"]` remains, on Chromium, Firefox, and WebKit.                                                                                                        |
| RRS-07 | Every runnable gate stays green: site `test:unit`, `build`, `check:built`, the e2e suite on three browsers, `gate:quick`, `agent:check`, and `tests/architecture/*.test.mjs`. `astro check` and Lighthouse are recorded as CI-only on the authoring machine.                        |

## Out of scope

- The README itself (`docs/readme-rewrite`, #694).
- Any change to the Mermaid renderer in `StarlightHead.astro`, including its
  "Architecture diagram" aria-label, which this page inherits.
- `install-and-run.md` and the `npx verchestra init` path; this change covers
  the source-checkout path only.
- The projected `docs/data-probe-contract.md` route: hand-written guides link
  to the GitHub copy by rule.
