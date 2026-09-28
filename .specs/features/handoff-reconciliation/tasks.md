# Handoff reconciliation tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Capture `pnpm agent:context` before the change | Output recorded in the branch report | Complete |
| T2 | Audit each listed handoff against its report and commits | `validation.md` reconciliation table | Complete |
| T3 | Rewrite the frontmatter and next actions truthfully, keeping superseded text as history | `pnpm agent:check` (`parseHandoff`) | Complete |
| T4 | Mark `.specs/STATE.md` historical handoff entries as superseded | `pnpm agent:check`, `pnpm test:agent-readiness` | Complete |
| T5 | Capture `pnpm agent:context` after the change and run the gates | `pnpm agent:context`, `pnpm agent:check`, `pnpm gate:quick`, `pnpm gate:security` | Complete locally; independent review pending |
