# Pi runtime 1.4.0 qualification tasks

| Task | Deliverable | Verification | Status |
| --- | --- | --- | --- |
| T1 | Move both packages to `1.4.0` with `pnpm add -E -w -D`, keeping the lockfile to what 1.4.0 changes | `pnpm install --frozen-lockfile`; lockfile diff; dependency-policy test | Complete locally |
| T2 | Move the probe pin, the spike identity and the drift neighbours; add the malformed-arguments spike case | `pnpm qualify:pi`; Pi contract and integration suites; cross-driver suites; control run | Complete locally |
| T3 | Compare the published packages and the loaded module graph; record the report, the matrix row and the handoff | `pnpm gate:quick`; `pnpm agent:check`; exact-head GitHub checks; fleet `gate=full` | Complete locally; external CI pending |

## Delivery rule

Merge only the PR head whose required checks pass, by rebase through the
documented maintainer bypass, and verify the merge by content.
