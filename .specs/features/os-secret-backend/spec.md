# OS Secret Backend Specification

**Issue:** #379 (blocks #18 L2; the credential source for #405)
**Decision:** AD-034 in `.specs/STATE.md`
**Status:** Implemented on `feat/os-secret-backend`; pending independent review

## Problem Statement

`vestra doctor --deep` computes `PASS` only when every check is present and
healthy. `doctor.secret-presence` was always `blocked`: the only production
adapter, `QualifiedOsSecretAdapter`, needed an OS-store bridge that nothing in
the product constructed. The upcoming governed task command (#405) also needs a
place to keep the Claude Code (`ANTHROPIC_API_KEY`) and Codex
(`OPENAI_API_KEY`) credentials. It must be able to read them and inject them
only into child processes, never into ambient environment variables.

## Goals

- A real, qualified macOS credential store, bound per Workspace, that a user
  provisions with `vestra secret set` and deep doctor observes without reading.
- No weakening of the key-material guarantee (`non-exportable`).
- Honest `not configured` on every platform without its own qualification.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Linux Secret Service and Windows CNG credential backends | Each needs its own platform qualification. Both report `VES_SECRET_STORE_UNQUALIFIED`. |
| Injecting the credential into a provider child | #405 consumes `adapter.read`. This slice provides the store. |
| Non-ASCII or binary credentials | Provider API keys are printable ASCII. The value policy refuses anything else. |
| Values above `MAX_CREDENTIAL_VALUE_BYTES` (1416) | The `security -i` line limit dictates this. An 8 KiB value cannot be written without the tool splitting the line. |

## Requirements

| ID | Requirement |
| --- | --- |
| OSB-01 | Readable credentials qualify against a separate contract (`OS_CREDENTIAL_CONTROLS`: `keychain`, `user-scope`, `workspace-namespace`, `not-in-argv`, `presence-without-value`). The key-material contract still requires `non-exportable`, and credential evidence cannot satisfy it. |
| OSB-02 | The darwin backend implements presence (`find-generic-password` without `-g`/`-w`: exit 0 present, 44 absent, else failure), read (`-g`, decoding both password record forms), store, and delete (0 removed, 44 absent). |
| OSB-03 | The value never appears in any argv, the child environment (an allowlist), an error, or command output. Writes pass it hex-encoded on stdin only. |
| OSB-04 | No `security -i` line exceeds 4095 bytes. `MAX_CREDENTIAL_VALUE_BYTES` is derived from the worst-case line. An oversize value is refused before any process is spawned and never reaches stderr. |
| OSB-05 | An explicit keychain path is canonical, absolute, a regular user-owned non-symlink file with the `kych` magic, and is re-proven before every operation, so `security` cannot fall back to the login keychain. |
| OSB-06 | A rotation deletes, then adds, and never uses `-U`, `-A`, or partition-list changes. A failure after the delete is `VES_SECRET_ROTATION_INCOMPLETE`. |
| OSB-07 | Every spawn is bounded (presence inside the doctor's 5 s probe budget). A timeout is `VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED`, including through the adapter. |
| OSB-08 | The darwin evidence digest equals the SHA-256 of `docs/qualification/os-secret-backend-darwin.md`, which names every claimed control. Only darwin constructs a credential store. |
| OSB-09 | `@verchestra/platform-node/secrets` exists, and neither its import closure nor the CLI credential composition's reaches `node:sqlite`, the runtime store, or the package root. `main.ts` loads the composition lazily. |
| OSB-10 | `readWorkspaceIdentity(controlRoot)` reads the identity `init` writes, returns `undefined` for an uninitialized root, and fails closed (`VES_INIT_IDENTITY_INVALID`) on anything else. |
| OSB-11 | `vestra secret set|status|delete --name <logical> [--keychain <path>]` validates the name against the binding pattern and requires an initialized Workspace. `set` reads stdin (hidden in a TTY; one trailing newline stripped from a pipe) and refuses empty, oversize, or non-printable values. `status` reports presence only. |
| OSB-12 | Deep doctor receives `workspaceId` and a `{ has }` closure for `anthropic-api-key`: `pass` when bound, `blocked` when unbound, unqualified, or without a Workspace, and `fail` when the store cannot answer. |
| OSB-13 | Gate suites never spawn `/usr/bin/security`. They use fake or spy runners. Every test that can reach a credential store, in process or through a child `vestra`, preloads a spawn guard that throws on the tool, and an architecture test enforces both rules. |
| OSB-14 | Real-keychain evidence is a standalone qualification suite (`pnpm qualify:keychain`, `spikes/os-secret-store`) that no gate runs. It uses only a disposable keychain file (random password, unlocked, no auto-lock), and a runner that refuses any call not naming that file. The file's own attribute dump proves which items remain, and the file is deleted in `finally`. It never touches the login keychain, the search list, or the default keychain, and asserts refusal on other platforms instead of skipping. Its result is **pending** an owner run on an unlocked session. |

## Assumptions

| Decision | Chosen default | Confirmed? |
| --- | --- | --- |
| Keychain selection for tests and dedicated keychains | Explicit `--keychain` flag, not an environment variable (AD-034) | Proposed; owner reviews |
| Maximum credential size | 1416 bytes, derived from the tool's line limit | Measured |
| Doctor's well-known credential | `anthropic-api-key` | Proposed; #405 consumes the same name |
