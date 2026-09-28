---
schema: verchestra-feature-handoff/v1
feature: os-secret-backend
issue: 379
status: verification
branch: feat/os-secret-backend
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T7
nextTask: "T8 — independent review of AD-034 and the darwin qualification report; then the owner binds anthropic-api-key on a provisioned macOS machine and records a full doctor --deep verdict"
lastGate: "pnpm gate:quick PASS (unit 2194/2194, agent-readiness 252/252, 0 skipped, 0 todo)"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Issue #379: a production OS credential backend so that deep doctor's
secret-presence check can pass on a provisioned macOS machine, and so the
governed task command (#405) has a credential source. Requirements OSB-01 to
OSB-13 in `spec.md`; decision AD-034 in `.specs/STATE.md`; threats in
`threat-model.md`.

# Completed Evidence

- Separate readable-credential contract (`OS_CREDENTIAL_CONTROLS`,
  `QualifiedOsCredentialAdapter`). The key-material contract is unchanged and
  still requires `non-exportable`.
- `DarwinKeychainBackend` over `/usr/bin/security`: attribute-only presence,
  `-g` reads, stdin-only hex writes within the derived 1416-byte budget,
  delete-then-add rotation, explicit keychain-file checks, and bounded spawns.
- `docs/qualification/os-secret-backend-darwin.md`, bound by digest to
  `DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION`.
- `@verchestra/platform-node/secrets` subpath; `readWorkspaceIdentity`.
- `vestra secret set|status|delete --name <logical> [--keychain <path>]`;
  `doctor --keychain <path>`; deep doctor observes `anthropic-api-key`
  presence through a `{ has }` closure.
- Tests and the discrimination sensor are listed in `validation.md`.

# Owner actions

1. In an initialized Workspace on macOS, run
   `vestra secret set --name anthropic-api-key` and, for Codex,
   `vestra secret set --name openai-api-key` (the value is read from stdin, or
   typed without echo). Check with `vestra secret status --name <name>`.
2. Run `vestra doctor --deep` from that Workspace and record the verdict. The
   secret-presence check should report `pass`. Other checks still need their
   own provisioning.

# Next Exact Action

Submit `feat/os-secret-backend` for independent review. The reviewer ratifies
or amends AD-034, in particular the explicit `--keychain` flag instead of an
environment variable, and the 1416-byte value limit.

# Blockers

- Linux and Windows credential backends are out of scope and report
  `VES_SECRET_STORE_UNQUALIFIED` until each has its own qualification.
