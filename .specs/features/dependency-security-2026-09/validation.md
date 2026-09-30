# September 2026 Dependency Security Batch Validation

| Requirement                            | Evidence                                                                                                                                 | Result        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| DSB-01 zero open alerts                | The Dependabot alerts API listed 0 open after #416 (alerts 1–44 fixed). #45 and #46 came from mermaid 12 and are fixed by T8             | PASS after T8 |
| DSB-02 `pnpm audit` clean              | "No known vulnerabilities found" on the T8 branch                                                                                        | PASS          |
| DSB-03 exact overrides, frozen install | `pnpm-workspace.yaml` overrides are exact versions; `pnpm install --frozen-lockfile` passes                                              | PASS          |
| DSB-04 grouped proposals               | `tests/agent-readiness/dependency-policy.test.mjs` asserts the `site-framework` and `security-fixes` groups                              | PASS          |
| DSB-05 driver pins move together       | OpenCode 1.18.33 and Pi 0.87.1: pin, spike oracle and a new report move in one commit each; the qualification suites pass with 0 skipped | PASS          |
| DSB-06 no open batch PR                | #400, #404, #409–#419 merged; #401–#403 superseded; #410 closed                                                                          | PASS          |
| DSB-07 nothing weakened                | No assertion, Lighthouse threshold, workflow permission or qualification boundary was relaxed                                            | PASS          |

`lodash-es` exception: `chevrotain` 11.1.2 pins `lodash-es` to exactly 4.17.23, and
no newer 11.1.x exists, while mermaid 12 pins `chevrotain ~11.1.2`. The exact
override to the patched 4.18.1, a minor release within lodash's semver line, is
the only fix available. Site quality e2e covers diagram rendering.
