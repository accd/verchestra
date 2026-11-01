# README overhaul: tasks

| Task | What | Requirements | Proof |
| --- | --- | --- | --- |
| T1 | Rewrite `README.md`: hero, Why, How it works with the drivers table, Quick start, governed task, Beta testers, Status with the collapsed matrix, What it is not, collapsed Reference, Contributing, Community, License | RDM-01 to RDM-06 | `beta-tester-docs`, `npx-package-name`, `regex-linearity`, the site unit tests, `agent:check` links and license |
| T2 | Record a real `self-test --profile smoke` run as `docs/assets/self-test.gif` with the reproducible `docs/assets/self-test.tape` (vhs), and show it under Quick start | RDM-01, RDM-06 | The recorded run ends in `self_test.verdict: PASS` with empty `failure_codes`; `agent:check` resolves the image link |
| T3 | Replace the small mark at the top of `README.md` with a light and dark banner (`docs/assets/banner-light.png`, `docs/assets/banner-dark.png`) rendered from `docs/assets/banner.html` in the site's colors and type, chosen by `prefers-color-scheme` | RDM-01 | Both renders reviewed; `agent:check` resolves the image links; the README title and description tests pass unchanged |
