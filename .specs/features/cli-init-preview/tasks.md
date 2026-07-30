# Tasks

| Task | Status | Evidence |
| --- | --- | --- |
| T1 — Slice A public contract | Complete | PR #82 / `ec46625`; `tests/contract/cli-surface.test.mjs` asserts the installed manifest advertises only `init` and its explicit options. |
| T2 — Read-only production preview | Complete | PR #82 / `ec46625`; `apps/vestra-cli/src/main.ts` composes `buildCanonicalInitFiles` with `SafeInitService.preview()` and does not apply a dry-run. |
| T3 — Read-only launcher evidence | Complete | `tests/e2e/cli-launchers-e2e.test.mjs` creates a disposable real Git repository and proves a dry-run leaves its byte snapshot unchanged. |
| T4 — Slice B persistent init | Complete | PR #83 / `9fe9404`; launcher E2E proves `preview()` then `apply()` on the same service instance, seven initial candidates, and `changed: 0` on the identical repeat. |
| T5 — Qualified local-alpha documentation | Complete | PR #103 / `e2d3a25`; `README.md` documents the source-checkout preview and apply paths and names the intentionally absent commands. |
| T6 — Independent evidence and human review | Verification | Re-run the documented command in a disposable real Git repository, compare it with the canonical requirements above, then obtain independent and human review. |

`pnpm gate:quick`, `pnpm gate:build`, `pnpm gate:security`, and `pnpm gate:release`
remain the required gates for the applicable implementation slices. This
artifact-only reconciliation runs `pnpm agent:check` plus the focused CLI
contract and launcher evidence before review.
