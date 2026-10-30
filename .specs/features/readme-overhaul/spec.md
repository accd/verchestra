# README overhaul: a short, scannable front page

## Problem

The root `README.md` was 262 lines with every section expanded. It read long,
its pitch competed with a promise table, a flow diagram and a status banner,
it exposed internal jargon (task numbers, issue numbers, `bindingDigest`) up
front, and it had no logo, navigation or collapsed reference.

## Requirements

| ID | Requirement |
| --- | --- |
| RDM-01 | The first screen states what Verchestra is in one sentence, shows the mark, at most four badges and a navigation row. |
| RDM-02 | The beta status (`0.0.0-qualification`, not 1.0, the signed hold) is visible above the fold. |
| RDM-03 | "Why" is three numbered problems, each with a linked fix, instead of the promise table. |
| RDM-04 | Install is two commands; first-run internals, the task sequence diagram, the capability matrix, exit codes, credentials, limits, coordinated runs and the trust diagram are collapsed in `<details>`. |
| RDM-05 | Every README assertion keeps passing unchanged (below). No test, generated file, `product.ts` or dependency changes. |
| RDM-06 | Content stays English-only and states nothing the qualification evidence does not support. |

## Constraints held by existing tests

- `tests/agent-readiness/beta-tester-docs.test.mjs`: the `## Beta testers` section, the pinned version, the five command-family rows, the sandbox and what-to-attach links, "Node 24.14.0 or later", `task check` before `task plan`, the Beta feedback link, `### Exit codes` with the nine rows.
- `apps/site/tests/unit/product-contract.test.mjs` and `repository-content.test.mjs`: the thirteen capability rows equal `apps/site/src/data/product.ts`; `0.0.0-qualification` is present.
- `scripts/agent-readiness.mjs`: the exact license sentence and resolvable relative links.
- `tests/agent-readiness/npx-package-name.test.mjs`: no `npx vestra`.
- `apps/site/src/lib/llm-content.ts`: a Markdown H1, a prose description paragraph before any badge line, no heading jumps.

## References reviewed

`othneildrew/Best-README-Template` (every section and its five roadmap items),
the project-applicable tools of `abhisheknaiidu/awesome-github-profile-readme`,
`mattpocock/skills` (problem-first "Why", short install) and
`tech-leads-club/agent-skills` (centered hero, progressive disclosure).
Multi-language READMEs are out: the repository is English-only and
`tests/architecture/agent-instructions.test.mjs` forbids `README.*.md`.
