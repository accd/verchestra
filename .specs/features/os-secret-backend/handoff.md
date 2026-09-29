---
schema: verchestra-feature-handoff/v1
feature: os-secret-backend
issue: 379
status: verification
branch: feat/os-secret-backend
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T7
nextTask: "T8 — the owner runs corepack pnpm qualify:keychain on an unlocked macOS session and records the result in docs/qualification/os-secret-backend-darwin.md; independent review of AD-034"
lastGate: "pnpm gate:build PASS; pnpm gate:security PASS; pnpm gate:quick PASS; pnpm agent:check PASS (0 skipped, 0 todo; no gate spawns /usr/bin/security)"
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
- Gate suites use fake or spy runners only, and never spawn `/usr/bin/security`.
  This is enforced by `tests/architecture/no-keychain-spawn-in-tests.test.mjs`
  and the preloaded `tests/helpers/deny-keychain-spawn.mjs`.
- The real-keychain evidence is the standalone `pnpm qualify:keychain` suite
  (`spikes/os-secret-store`). It is **pending**: an automated session could
  not set up a disposable keychain while the login keychain was locked, and
  the coordinator stopped all `security` activity on this machine.
- Tests and the discrimination sensor are listed in `validation.md`.

# Owner actions

0. From an unlocked macOS desktop session, run `corepack pnpm qualify:keychain`
   once. It uses only disposable keychain files and never the login keychain.
   Record the result and the revision in
   `docs/qualification/os-secret-backend-darwin.md` ("Real-keychain evidence"),
   then update `DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION.digest`; the security
   test fails until it matches.
1. In an initialized Workspace on macOS, run
   `vestra secret set --name anthropic-api-key` and, for Codex,
   `vestra secret set --name openai-api-key` (the value is read from stdin, or
   typed without echo). Check with `vestra secret status --name <name>`.
2. Run `vestra doctor --deep` from that Workspace and record the verdict. The
   secret-presence check should report `pass`. Other checks still need their
   own provisioning.

# Next Exact Action

Owner action 0, then submit `feat/os-secret-backend` for independent review. The reviewer ratifies
or amends AD-034, in particular the explicit `--keychain` flag instead of an
environment variable, and the 1416-byte value limit.

# Blockers

- The real-keychain qualification run requires the owner on an unlocked macOS
  session; no automation may run it.
- Linux and Windows credential backends are out of scope and report
  `VES_SECRET_STORE_UNQUALIFIED` until each has its own qualification.
