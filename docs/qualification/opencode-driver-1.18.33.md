# OpenCode Driver Boundary Requalification

**Maintenance scope:** dependency refresh after T77 (Dependabot PR #400)
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `opencode-ai@1.18.33`, `@opencode-ai/sdk@1.18.33`

## Qualification boundary

This report supersedes `docs/qualification/opencode-driver-1.18.18.md` without
changing the Driver architecture or advancing the product roadmap. OpenCode
remains behind the Driver port and owns no Verchestra policy, workflow,
artifact, Approval, or durable state. The supported floor remains `1.17.18`;
this report records the exact version installed and qualified by the repository.

Dependabot PR #400 proposed `1.18.23`. By the time it was requalified, `1.18.33`
was the latest `1.18.x` release, so the group moves straight to `1.18.33` and
`1.18.23` is never recorded as a qualified pin.

## Upstream review

The upstream range `v1.18.18...v1.18.33` (402 commits, reviewed as
`v1.18.18...v1.18.23` and `v1.18.23...v1.18.33`) was checked for changes
touching cancellation, event streams, permissions, session persistence,
abort and shutdown, and the SDK surface.

- **SDK surface.** Across the whole range the published `@opencode-ai/sdk`
  changes only in two places. The `global.upgrade` operation now requires its
  `target` body field, and the provider option `chunkTimeout` accepts `false`,
  with both timeout descriptions now documenting a 300000 ms default. The
  driver calls neither. Event, session, abort, and permission operations are
  byte-identical to `1.18.18`.
- **Permissions.** `opencode run` now forwards `permission.asked` events from
  child sessions created by the run's own session, and without `--auto` it
  rejects them. The run-json fallback never passes `--auto`, so subagent
  permissions that previously went unanswered now fail closed. Server
  configuration is now passed through a v2-to-v1 compatibility lowering step. It
  leaves the V1 `permission` and `share` keys untouched and rejects V2
  `permissions` blocks. The driver sends only V1 `share: "disabled"` and
  `permission: { "*": "ask" }`.
- **Cancellation and abort.** An SSE read timeout no longer produces an
  unhandled rejection when cancelling the stream reader. Nothing in the range
  changes session abort or server shutdown.
- **Event stream.** Upstream now defaults provider header and inter-chunk
  timeouts to five minutes, so a stalled provider stream is aborted rather
  than held open. Upstream also added retryable network and provider-capacity
  error variants, continuation after an `unknown` finish reason, surfaced
  subagent tool errors, and zeroing of non-finite model costs. None of these
  changes the event envelope the driver accepts. An aborted stream surfaces
  through the existing provider-failure normalization contract.
- **Session persistence.** The v1 database projector no longer resets the
  context epoch when a session moves between workspaces. Workspace listing is
  gated behind the experimental workspaces flag. Legacy Drizzle migration
  history without a `name` column is now recovered by timestamp, and a timestamp
  that matches no known migration fails loudly. The driver does not move
  sessions or use workspaces, and it keeps no OpenCode state across runs.

## Proven behavior

- Both OpenCode packages and their lockfile entries resolve to one exact
  `1.18.33` version, asserted by the dependency-policy test.
- The repo-local version probe reports the installed `1.18.33` package without
  model inference; unsupported drift remains unavailable.
- The server binds only to `127.0.0.1`, disables sharing, and asks permission
  for every operation.
- Only explicitly named tools reach the prompt; built-in tools that bypass the
  Verchestra effect bridge remain rejected.
- Permission, model identity, content, usage, cost, provider failure,
  cancellation, redaction, and session-privacy contracts remain unchanged.

## Evidence

The qualification is accepted only after `pnpm qualify:opencode` (with
`VES_REQUIRE_PINNED_PROVIDERS=1`), `pnpm test:qualification`, `pnpm gate:quick`,
and `pnpm gate:full` pass on the exact implementation revision. The boundary
uses the deterministic fake host and SDK factory; no real model or paid endpoint
is contacted.
