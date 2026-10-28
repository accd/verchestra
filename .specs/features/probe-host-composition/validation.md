# Probe host composition, slice 1 validation

## Current verdict

**Builder self-report: every proof passes on both platforms run.** This is
not a verification. An independent Verifier over `d069bf92..HEAD` is still
due (see `handoff.md`). This is not a release claim and does not alter the
signed 1.0.0 hold.

Platforms run:

- **Linux:** Ubuntu 24.04.4 LTS under WSL 2, x86_64, Node 24.14.0. Every
  case runs in full, including `approve` and `check`.
- **Windows:** Windows 11 Pro, x64, Node 24.14.0. A case that needs
  `approve` or `check` asserts their refusal, `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`
  with exit 5 and nothing recorded, instead of skipping (XP-04).
- **macOS:** not run on this host. CI's macOS runners cover it.

Each proof was run exactly as `checks.md` writes it:
`node --test --test-name-pattern "<name>" <file>`, one run per proof, with at
least one test passing and none failing.

## Check evidence

| Check | Proof (test name in file) | Linux | Windows |
| --- | --- | --- | --- |
| C1 | `add registers the worker in a signed lock` (E) | pass | pass |
| C2 | `a lock the store writes verifies against the pinned anchor` (L) | pass | pass |
| C3 | `the init placeholder becomes generation 1` (L) | pass | pass |
| C4 | `the previous generation is kept for rollback` (L) | pass | pass |
| C5 | `add refuses an entry outside the Workspace or behind a link` (E) | pass | pass (directory link as a junction; the file link case is POSIX only) |
| C6 | `an edited lock fails its signature` (L) | pass | pass |
| C7 | `lock signatures use the existing approval purpose` (L) | pass | pass |
| C8 | `the Workspace key still unlocks for task commands` (E) | pass | pass (after `add`; `approve` asserted refused) |
| C9 | `approve records the confirmed launch` (E) | pass | pass (refusal asserted) |
| C10 | `approve defaults to 30 days and refuses more than 365` (E) | pass | pass (the 365-day bound asserted; the default asserted refused) |
| C11 | `approve writes nothing unless the launch digest is typed back` (E) | pass | pass (refusal asserted) |
| C12 | `approve refuses a second approval for the same ref` (E) | pass | pass (refusal asserted) |
| C13 | `approve refuses environment the worker would refuse` (E) | pass | pass (refusal asserted) |
| C14 | `list reports each approval state in order` (E) | pass | pass (empty list asserted; `approve` asserted refused) |
| C15 | `revoke ends an approval` (E) | pass | pass (refusal asserted) |
| C16 | `revoke refuses an unknown or revoked approval` (E) | pass | pass (unknown case in full; revoked case asserted refused) |
| C17 | `approval and revocation records have their declared shape` (A) | pass | pass |
| C18 | `lookup returns only a verified, unexpired, unrevoked approval` (A) | pass | pass |
| C19 | `two concurrent approvals for one ref leave one record` (A) | pass | pass |
| C20 | `check passes an admissible worker` (E) | pass | pass (refusal asserted) |
| C21 | `check names each failing prerequisite` (E) | pass | pass (refusal asserted for each of the 5 cases) |
| C22 | `only a grant-required admission passes` (K) | pass | pass |
| C23 | `approve and check refuse on win32` (K); `approve and check refuse on Windows` (E) | pass, pass (on POSIX the E case asserts both commands succeed) | pass, pass |
| C24 | `no worker starts during the extension commands` (E) | pass | pass |
| C25 | `only the extension commands reach admission` (G); `the walk flags spawning imports and other modules` (G) | pass, pass | pass, pass |
| C26 | `the extension commands are declared and documented` (E) | pass | pass |
| C27 | `missing flags exit 2` (E) | pass | pass |
| C28 | `outside a Workspace the commands refuse` (E) | pass | pass (`check` exits 5 with the platform code) |
| C29 | `signing commands refuse without the passphrase` (E) | pass | pass (`add` in full; `approve` asserted refused) |
| C30 | `envelopes carry their declared fields` (E) | pass | pass (`add` and `list` in full; `approve` and `check` asserted refused) |
| C31 | `extension-host is an exported CLI dependency` (G) | pass | pass |
| C32 | `check fails an expired approval` (E) | pass | pass (refusal asserted) |
| C33 | `resolve refuses a lock without TLC` in `tests/unit/governed-skill-registry.test.mjs` | pass | pass |
| C34 | `an extension-only lock passes updates and extension resolution` in `tests/unit/governed-skill-registry.test.mjs` | pass | pass |

Files: E `tests/e2e/extension-cli-e2e.test.mjs`, L
`tests/unit/skill-lock-file.test.mjs`, A
`tests/unit/extension-approval-store.test.mjs`, K
`tests/unit/extension-check.test.mjs`, G
`tests/architecture/extension-host-composition.test.mjs`.

## Sensors

Three mutations were run on Linux to confirm that the proofs catch a removed
check. Each mutation was reverted afterwards.

- Without the `assertProbeWorkerEnvironment` call in `approve`, C13 fails.
- With the revocation lookup in the approval store disabled, C18 fails.
- With the entry digest comparison in `check` disabled, C21 fails.

The C24 marker has its own positive control: the same worker, started directly
with the marker variable, writes it.

## Regression

- Linux, the probe-host and CLI suites:
  - `tests/integration/spawned-probe-worker.test.mjs`
  - `tests/security/probe-workspace-trust-security.test.mjs`
  - `tests/contract/probe-worker-framed-protocol.test.mjs`
  - `tests/contract/probe-worker-protocol.test.mjs`
  - `tests/fault-injection/probe-worker-faults.test.mjs`
  - `tests/e2e/out-of-process-probe-host-e2e.test.mjs`
  - `tests/contract/cli-surface.test.mjs`
  - `tests/contract/skill-update-lifecycle.test.mjs`
  - `tests/security/skill-executable-content-security.test.mjs`

  Result: 175 passed, 0 failed, 0 skipped. `SpawnedProbeWorker` keeps
  refusing the same environment through the exported rule.
- Windows, `node --test tests/architecture/*.test.mjs`: 146 passed, 0 failed.
- Windows, `corepack pnpm test:security`: 1396 passed and 2 failed. Both
  failures are known and happen only on Windows, at this base as well:
  - `a refused extra-usage statement is never echoed: not its token, e-mail address, or path`
  - `a symbolic-link final component is refused for write and delete`, which
    fails with `EPERM` when a file symbolic link is created without Developer
    Mode.

  Neither test touches this change.

## Gates (Windows)

- `corepack pnpm gate:quick` passes. Its stages are format:check, lint,
  complexity, typecheck, unit, agent-readiness, and census. The complexity
  ratchet lowered three `cli.ts` baselines.
- `corepack pnpm agent:check` passes.

## Decisions recorded while building

- **Door 6.** The owner chose option 1: TLC is required by `resolve`, not by
  lock validation. The rule keeps its place in the validation walk, ahead of
  the digest check, through a required-skill set that only `resolve` passes,
  so every existing registry test stays green unchanged. Proofs: C33, C34.
- **Registration, not qualification.** `add` passes the registry's
  `planUpdate` a `qualification.evidenceDigest`. That digest is the sha256 of
  the V2 canonical registration record `{skillId, extensionId, entryDigest,
  registeredAt}`. It records that a worker was registered, not that anything
  qualified it. The human approval of the exact launch stays the gate.
- **Bootstrap.** The registry refuses `init`'s placeholder as a current lock,
  because it has no generation. Generation 1 is therefore activated through
  `activate` with a plan that names the placeholder's raw-bytes digest.
  `planUpdate`'s generation rule is kept: the candidate must be generation 1.
- **Versions and licenses.** The harness version is `0.0.0`, the core of
  `0.0.0-qualification`, because the registry reads `x.y.z` only. It is used
  both as the registry's harness version and as each worker's minimum. The
  license allowlist is `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`,
  `MIT`.
- **Extension kind and origin.** The extension kind is `plugin`. `add` refuses
  a repository with no `origin`, or one whose origin is a local path. It
  removes userinfo from the origin URL before writing it to the tracked lock.
- **Revocations fail closed.** A revocation file that does not verify still
  blocks the lookup, and `list` reports that approval as `invalid`.
- **Not supported yet.** Re-approving a revoked reference is refused, and so
  is registering a skill id, extension id, or approval reference that the lock
  already holds. Both are follow-ups (plan Out of scope).
- **Builder choices that change no check:**
  - **Admission subpath.** The CLI imports admission through the new
    `@verchestra/extension-host/admission` export, so the worker and the
    supervisor modules are never loaded. The guard asserts this.
  - **Approval references.** An approval reference must match
    `^[a-z0-9][a-z0-9_-]{0,127}$`. It names a file, so it is lowercase and has
    no dot: one name per case-insensitive file system, and `<ref>.revoked.json`
    can never be another reference's approval.
  - **`--version` on `add`.** `extension add` declares `--version` (Surface).
    The parser therefore takes `--version` as the option of a command that
    declares it, and keeps it as the global flag everywhere else.
  - **`--arg` values.** A repeatable option takes the next token as given, so
    `--arg --no-warnings` passes a flag to the worker's executable.
  - **`check` rows.** `check` reports six rows: `lock`, `extension`,
    `approval`, `admission`, `entry`, `launch`. The `launch` row measures the
    approved launch over the locked entry digest, so an edited entry fails only
    `entry`, and a changed executable fails only `launch`.
