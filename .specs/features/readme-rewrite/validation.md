# README Rewrite Validation

Recorded on 2026-10-29 from the worktree branch `docs/readme-rewrite`, cut
from `origin/main` at `d2f6de855089e1496a6d9a95c01c54975da1120e`, on Windows 11
with Node 24.14.0 and pnpm 10.34.5 (`corepack pnpm`).

## Requirement evidence

| Id    | Evidence                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-01 | `node --test tests/agent-readiness/beta-tester-docs.test.mjs tests/agent-readiness/npx-package-name.test.mjs tests/architecture/agent-instructions.test.mjs`: 21 pass, 0 fail. The `## Beta testers` section and the `### Exit codes` table are carried verbatim. |
| RR-02 | `pnpm --filter @verchestra/site test:unit`: 64 pass, 0 fail, including "the README capability table mirrors the typed matrix exactly" and "the README status matrix agrees with the capability matrix".                                                       |
| RR-03 | `pnpm --filter @verchestra/site build`: complete, 135 pages; the README passes `validateLlmHeadings`, `extractTitle`/`extractDescription` and the machine-local-path check in `compileLlmFull`. `check:built`: `{"pages":135,"compressedJavaScript":1116,"compressedTransfer":245608,"internalLinks":"valid","metadata":"valid"}`. |
| RR-04 | `pnpm agent:check`: PASS.                                                                                                                                                                                                                                     |
| RR-05 | Four fenced `mermaid` blocks (flowchart LR, sequenceDiagram, flowchart LR with two subgraphs, flowchart BT); every label quoted, no init directive, no line starting with `\|`. Rendering is confirmed on the pull request's rich diff (step 3 of the handoff).  |
| RR-06 | `docs/quick-start.md` sections 2 and 3 (prose only; the bash/powershell pairing test in `beta-tester-docs.test.mjs:150-167` stays green), `docs/data-probe-contract.md` "Scaffolding the probe", `docs/contributing-with-agents.md` "Bootstrap from a clean clone", `CONTRIBUTING.md` "Website changes". |
| RR-07 | Headings with wit: "The problem: a chat is not a delivery system", "Install and run: no clone, no build, no credential"; captions: "Six stops, one contract", "Secrets have a home. They stay in it. The receiver earns its own.", "This is the decoder ring." Every status keeps its canonical hedge. No emoji, no exclamation mark. |
| RR-08 | README value bullet and legend match `site/status-truth` (#692): "SQLite is live-qualified…", "**available** means runnable today from the published npm package".                                                                                             |

## Gates

| Gate                                                                                                          | Result                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| README pin tests (three files)                                                                                | 21 pass, 0 fail                                                                          |
| `pnpm --filter @verchestra/site test:unit`                                                                    | 64 pass, 0 fail                                                                          |
| `pnpm agent:check`                                                                                            | PASS                                                                                     |
| `pnpm --filter @verchestra/site build` + `check:built`                                                        | PASS, 135 pages                                                                          |
| `pnpm gate:quick`                                                                                             | PASS (format, lint, complexity, typecheck, unit, agent-readiness, census)                |
| `git diff --check`                                                                                            | clean                                                                                    |

## Size

README: 470 lines → 262 lines (12 sections, 4 diagrams, 3 tables).
