# Live Doctor Probes Tasks

| Task | Deliverable | Requirement IDs | Verification | Status |
| --- | --- | --- | --- | --- |
| T0 | Specification, design, task plan, handoff | LDP-01–LDP-07 | `pnpm agent:check` | Complete |
| T1 | Async-capable application probe port and awaited sentinel bracket, including async public-regression campaign execution | LDP-01, LDP-02, LDP-05, LDP-07 | unit + security + regression + `pnpm gate:quick` | Complete |
| T2 | Existing-dependency live observers for sandbox, runtime SQLite, secret presence, and driver | LDP-03, LDP-05–LDP-07 | integration + security + `pnpm gate:security` | In progress |
| T3 | Policy, connector, and probe live observers after dependency approval | LDP-04–LDP-07 | integration + architecture + security | Blocked on explicit dependency approval |
| T4 | Provisioned-machine T75 evidence and independent verification | LDP-03–LDP-07 | T75 matrix evidence | Pending |

Each task has one atomic commit. No task may weaken, skip, or delete a
pre-existing assertion to obtain a passing gate.
