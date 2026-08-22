# OpenCode Driver Boundary Requalification

**Maintenance scope:** dependency refresh after T73
**Status:** Candidate pending exact-head CI qualification
**Qualified packages:** `opencode-ai@1.18.18`, `@opencode-ai/sdk@1.18.18`

## Qualification boundary

This report supersedes `docs/qualification/opencode-driver-1.18.9.md` without
changing the Driver architecture or advancing the product roadmap. OpenCode
remains behind the Driver port and owns no Verchestra policy, workflow,
artifact, Approval, or durable state. The supported floor remains `1.17.18`;
this report records the exact version installed and qualified by the repository.

## Proven behavior

- Both OpenCode packages and their lockfile entries resolve to one exact
  `1.18.18` version, asserted by the dependency-policy test.
- The repo-local version probe reports the installed `1.18.18` package without
  model inference; unsupported drift remains unavailable.
- The server binds only to `127.0.0.1`, disables sharing, and asks permission
  for every operation.
- Only explicitly named tools reach the prompt; built-in tools that bypass the
  Verchestra effect bridge remain rejected.
- Permission, model identity, content, usage, cost, provider failure,
  cancellation, redaction, and session-privacy contracts remain unchanged.

## Evidence

The qualification is accepted only after `pnpm qualify:opencode`,
`pnpm test:qualification`, `pnpm gate:full`, `pnpm site:test`, and
`pnpm site:build` pass on the exact implementation revision. The boundary uses
the deterministic fake host and SDK factory; no real model or paid endpoint is
contacted.
