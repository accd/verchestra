# OpenCode/Qwen Driver Boundary Requalification

**Maintenance scope:** dependency refresh after T68  
**Status:** Qualified for the existing T05 contract  
**Qualified packages:** `opencode-ai@1.18.7`, `@opencode-ai/sdk@1.18.7`

## Qualification boundary

This report supersedes the package-version identity recorded by the original
T05 qualification without changing its architecture or advancing the product
roadmap. OpenCode remains behind the Driver port and owns no Verchestra policy,
workflow, artifact, Approval, or durable state. T68 remains complete and T69
remains the next product task.

The supported floor is deliberately **not** raised. `minimumVersion` stays at
1.17.18 in both the spike and `packages/drivers/src/opencode-driver.ts`, so a
1.17 host is still accepted. Narrowing what a user's host may be is a product
decision that belongs to its own change, not to a dependency refresh. What
moves here is the version this repository installs and qualifies against.

## Proven behavior

- Both OpenCode packages and their lockfile entries resolve to one exact
  1.18.7 version, asserted by
  `tests/agent-readiness/dependency-policy.test.mjs`.
- The repo-local 1.18.7 version probe succeeds without model inference, and a
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

The coordinated dependency change is accepted only when `pnpm qualify:opencode`,
`pnpm test:qualification`, and `pnpm gate:full` pass. The seventeen OpenCode
boundary outcomes use the deterministic fake host and SDK factory in
`spikes/opencode-driver/test/`; no real model, corporate endpoint, or paid
provider was contacted.

Dependabot proposed the two packages as separate pull requests (#30 and #31),
which would have installed a split 1.18.7 / 1.17.18 pair with no valid
qualification identity. They are superseded by this coordinated change, and
`.github/dependabot.yml` now groups `opencode-ai` with `@opencode-ai/*` so
future OpenCode updates arrive as a single reviewable unit — the same policy
already applied to the Pi runtime.
