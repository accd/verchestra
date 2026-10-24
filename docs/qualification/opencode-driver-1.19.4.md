# OpenCode Driver Boundary Requalification

**Maintenance scope:** dependency refresh after T77 (Dependabot PR #581; the
successor that #549 deferred to #563)
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `opencode-ai@1.19.4`, `@opencode-ai/sdk@1.19.4`

## Qualification boundary

This report supersedes `docs/qualification/opencode-driver-1.18.33.md` as the
record of the qualified package versions, without changing the Driver
architecture or advancing the product roadmap. OpenCode remains behind the
Driver port and owns no Verchestra policy, workflow, artifact, Approval, or
durable state. The supported floor remains `1.17.18`; this report records the
exact version installed and qualified by the repository.
`docs/qualification/opencode-driver-cancel-order.md` remains the evidence for
what a cancel does; it observed no installed OpenCode and is unaffected.

Dependabot first proposed `1.18.35` (#549, deferred by the owner on 2026-10-22
to #563) and then `1.19.3` (#581). At requalification time npm's `latest` was
`1.19.4`, published on 2026-10-22, five commits above `1.19.3`; it upgrades the
bundled Bun runtime to 1.4.4, which carries upstream security fixes. The owner
chose `1.19.4`, so neither `1.18.35` nor `1.19.3` is ever recorded as a
qualified pin.

## Upstream review

The upstream range `v1.18.33...v1.19.4` (100 commits, 298 files, the complete
compare listing) was checked for changes touching cancellation, event streams,
permissions, session persistence and identity, abort and shutdown, and the SDK
surface. Most of the range is outside the runtime: 69 files in `stats`, 48 in
`console`, 42 in `web`, with documentation, CI, and release chores.

- **SDK surface.** The published `@opencode-ai/sdk@1.19.4` differs from
  `1.18.33` in two files only: `package.json` (the version) and
  `dist/v2/gen/types.gen.d.ts`, which adds an optional `reasoning_options`
  array to a provider model's configuration and rewords the `autoupdate`
  description. Every runtime file of the package is byte-identical, so the v2
  client the driver loads behaves as in `1.18.33` for `provider.list`,
  `session.create`, `session.prompt`, `session.abort`, `session.delete`,
  `event.subscribe`, and `permission.reply`. `Config.share` still accepts
  `"disabled"`.
- **Sharing.** Upstream discontinued session sharing (#55718). The share
  operation always fails, session creation never shares automatically, and the
  share service is removed. The `share` configuration key stays in the schema,
  so the driver's `share: "disabled"` is still accepted, and `opencode run
  --share` is hidden and only prints a notice. The driver never shared; now no
  path in OpenCode can.
- **Permissions.** No file that asks for, replies to, or evaluates a permission
  changed in the range. The driver still sends the V1 `permission: { "*": "ask" }`
  and per-session `ask` rules, and replies `once` or `reject`.
- **Cancellation, abort and shutdown.** Nothing in the range changes session
  abort, the event bus, or server shutdown. The server's pty connect route now
  validates the request origin and consumes its connect ticket before it
  upgrades; the driver opens no pty.
- **Event stream.** The event envelope is unchanged. The provider-side changes
  are: Copilot accepts interleaved `reasoning_opaque` values, xAI tool-result
  images are limited to PNG, JPEG, and WebP, the OpenAI `ultrafast` service tier
  is accepted, reasoning variants are built from configured
  `reasoning_options`, and `gitlab-ai-provider` and `@ai-sdk/xai` move forward.
  None changes what the driver accepts; a provider failure still surfaces
  through the existing provider-failure normalization contract.
- **Session identity.** Requests to the model provider now also carry
  `x-opencode-session-id`, and `x-opencode-parent-session-id` for a child
  session. The same OpenCode session identifier was already sent as
  `X-Session-Id` and `x-session-affinity`, so the provider learns nothing new.
  The driver's redaction and session-identity contract is unchanged.
- **Updates.** An update check no longer installs anything. Before, a patch
  release could be installed by OpenCode itself; now only `/update` or
  `opencode upgrade` install, and `opencode upgrade --major` is the only path
  to OpenCode 2. Update discovery reads npm's `latest` for `opencode-ai`. The
  driver runs `opencode serve` from the lockfile-pinned package, so the
  qualified binary cannot change under it.
- **Runtime.** The bundled Bun moves to 1.4.4, with upstream security fixes in
  Brotli, TLS, HTTP/1.1 to HTTP/3, WebSocket, and `fetch`, and root
  certificates updated to NSS 3.131.1. macOS binaries are signed with a
  Developer ID and re-signed ad hoc after a local compile; Linux musl native
  packages are installed for cross builds.

## Proven behavior

- Both OpenCode packages and their lockfile entries resolve to one exact
  `1.19.4` version, asserted by the dependency-policy test; the lockfile change
  moves only the two packages and their platform binaries.
- The repo-local version probe reports the installed `1.19.4` package without
  model inference; under the exact-pin gate a newer (`1.20.0`) or unsupported
  (`1.16.0`) version is refused, and unsupported drift remains unavailable.
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
