# OpenCode/Qwen Driver Boundary Requalification

**Maintenance scope:** dependency refresh after T68  
**Status:** Qualified for the existing T05 contract  
**Qualified packages:** `opencode-ai@1.18.9`, `@opencode-ai/sdk@1.18.9`

## Qualification boundary

This report supersedes `docs/qualification/opencode-driver-1.18.7.md`, which in
turn superseded the package-version identity in the original T05 report.
Architecture is unchanged and the roadmap does not advance: OpenCode remains
behind the Driver port and owns no Verchestra policy, workflow, artifact,
Approval, or durable state. T68 remains complete and T69 remains the next
product task.

The supported floor stays 1.17.18 in the spike and in
`packages/drivers/src/opencode-driver.ts`, so a 1.17 host is still accepted.
What moves is the version this repository installs and qualifies against.

## Why this arrived as one pull request

The 1.18.7 requalification added an `opencode-driver` group to
`.github/dependabot.yml` because Dependabot had split the same unit into two
pull requests (#30 and #31). The 1.18.9 proposal arrived as a single grouped
pull request (#45) moving both packages, which is the grouping rule working as
intended.

## Proven behavior

- Both OpenCode packages and their lockfile entries resolve to one exact
  1.18.9 version, asserted by
  `tests/agent-readiness/dependency-policy.test.mjs`.
- The repo-local 1.18.9 version probe succeeds without model inference, and a
  1.17.18 host is still accepted by the unchanged floor.
- The server binds only to `127.0.0.1`, disables sharing, and asks permission
  for every operation.
- Only explicitly named tools reach the prompt; built-in tools that would
  bypass the Verchestra effect bridge are rejected.
- `permission.asked` is normalized and answered only through the controller
  authorization callback, for both allow and deny.
- Model identity, content, usage, cache and reasoning tokens, cost, provider
  failure, malformed envelopes, and idle close retain their stable Verchestra
  representation.
- Cancellation still calls `session.abort` before server shutdown.
- Ambient corporate credentials are not inherited, sensitive values are
  redacted, and session identity is discarded.
- The `run --format json` fallback keeps `--pure`, stdin-driven prompts, and no
  `--auto`, `--yolo`, `--dangerously-skip-permissions`, `--continue`, or
  `--share`.

## Evidence

`corepack pnpm qualify:opencode` — 17 tests, 0 failures, 0 skipped.
`pnpm gate:security` PASS across format:check, lint, typecheck, build,
test:unit, test:architecture, test:qualification, test:security, and
test:fault. The boundary outcomes use the deterministic fake host and SDK
factory in `spikes/opencode-driver/test/`; no real model, corporate endpoint,
or paid provider was contacted.
