# Claude Code 2.1.282 fleet pin and PR #433 scan hygiene tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Move the four fleet workflows, their shape test, and the platform matrix to `2.1.282` | `apps/site/tests/unit/pages-workflow.test.mjs`; workflow shape tests | Complete locally |
| T2 | Requalify T03 at `2.1.282`, make the mediated flag probe honest on older builds, and write the report | `VES_REQUIRE_PINNED_PROVIDERS=1 corepack pnpm qualify:claude` | Complete locally |
| T3 | Replace the bridge path regex and the gate-argument regex with linear checks and prove equivalence | `tests/unit/mcp-bridge-logical-path.test.mjs`; `tests/contract/task-request.test.mjs` | Complete locally |
| T4 | Remove the credential digest and ambient temp directory from the mediated fake; fix git resolution in the tool fixture | `pnpm qualify:claude`; worktree tool integration and security suites | Complete locally |
| T5 | Gates and PR #433 checks | `pnpm gate:quick`, `gate:build`, `gate:security`, `agent:check`; Quality, Site, CodeQL, SonarCloud | Local gates pass; external CI pending |
