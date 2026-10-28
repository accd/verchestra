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
    `--arg --no-warnings` passes a flag to the worker's executable. The parser
    reads `--output`, `--help` and `--version` before any command option, so
    none of them can be a worker argument: `--arg --help` prints the command's
    help and approves nothing, and `--arg --version` is refused as the global
    flag (Verifier round 1, F2).
  - **`check` rows.** `check` reports six rows: `lock`, `extension`,
    `approval`, `admission`, `entry`, `launch`. The `launch` row measures the
    approved launch over the locked entry digest, so an edited entry fails only
    `entry`, and a changed executable fails only `launch`.

## Verifier round 1

The independent Verifier proved C1-C34 on Linux and Windows at `12f01d01` and
returned FAIL on one finding outside the checks. Dispositions:

- **F1 (high).** Two existing pinned command lists still named 14 commands:
  the `--help` snapshot in `tests/e2e/cli-launchers-e2e.test.mjs` and
  `SEALED_COMMANDS` in `tests/build/sealed-launcher-closure.test.mjs`. Both now
  name the five `extension` commands; the help snapshot is the CLI's own
  output, whose command column widened to fit `extension approve`. Neither
  suite is part of `gate:quick`, which is why the builder's run missed them.
- **F2 (low).** The parser reads `--output`, `--help` and `--version` before
  any command option, so a repeatable option does not take those three as
  values. The plan's Impact row, the parser comment and the decision above now
  say so. Every outcome fails safe.
- **F3 (low).** `CHANGELOG.md` now says `--expires` may name any time after now,
  at most 365 days ahead, which is what C10 and the code enforce.
- **F4 (process).** `e33b3516` rewrote the approved `approve` Surface row in
  place, adding `--confirm-stdin` and the credential flags, instead of adding
  a row. The confirmation was already required by AC 4-5, Flow hop 3 and the
  AD-040 confirmation assumption, and signing by door 3; the row is not
  rewritten again, and the history stays as it is.
- **F5, F6 (info).** No change: door 4 replaces the #569 guard and its file
  header still names #569; the plan does not require a README entry.

## SonarCloud follow-up

SonarCloud's quality gate failed on #679's new code on two conditions:
`new_coverage` 77.2 % (below 80 %) and `new_duplicated_lines_density` 4.4 %
(above 3 %). The follow-up branch `sonar/679-extension-follow-up` starts at
#679's head, `985f3b8f`, and changes no behaviour. Every existing assertion
is unchanged, and the extension, CLI surface, launcher, sealed closure,
architecture and task suites pass as they are.

### Duplication

SonarCloud named duplicated blocks in three places. Each one is gone:

- **The command dispatch.** `extension-command.ts:147-168` repeated
  `task-command.ts:67-88`: the handler lookup, the io with the home directory
  and keychain path, and the error mapping. Both now call
  `executeTaskFamilyCommand` in `apps/vestra-cli/src/task/task-dispatch.ts`.
  Each family passes its own handlers, its own "is not installed" message and
  its own error mapper.
- **The extension error definitions.** `extension-errors.ts:11-43` repeated
  `:49-81`, and `:94-129` repeated `task-errors.ts:61-96`. The thirteen
  definitions are now built by a typed `extensionDefinition` factory. It
  fixes `component: "extension"`, `documentationVersion: "1"` and a default
  of `safeDetails: {}`, and it keeps each code a literal, so `extensionError`
  still takes only an extension code. `init-errors.ts` already uses the same
  pattern. `tests/unit/extension-errors.test.mjs` pins every definition to the
  values slice 1 published, key order included (`JSON.stringify` equality).
- **The release manifest options.** The blocks across
  `release-manifest.ts:108-270` were option declarations spelled out per
  command. `keychain`, `confirm-stdin`, `run-id` and `approval-ref` are now
  declared once, as are the option lists of the three `secret` commands and of
  `task start`, `status` and `cancel`. The manifest's `JSON.stringify` output
  is byte-identical before and after, and the manifest is still deeply frozen.
  The option lists stay pinned by `tests/contract/cli-surface.test.mjs`.
  `release-manifest.ts` gains no import, so the doctor's read-only graph is
  unchanged.

No local tool reproduces SonarCloud's duplication measure. The next analysis
of the follow-up PR confirms the new density.

### Coverage

SonarCloud imports LCOV only from the `unit`, `contract` and `security`
scopes. The extension commands were proven mostly by
`tests/e2e/extension-cli-e2e.test.mjs`, which spawns the CLI, so most of
their coverage did not count. The follow-up adds tests that run the commands
in process:

- `tests/contract/extension-command.test.mjs` runs `add`, `approve`, `list`,
  `revoke` and `check` through `executeExtensionCommand`, and `main`'s
  dispatch through `main()`. It uses the e2e fixture's Workspace, set up with
  the real `vestra init`, and the fake keychain answers in the test process.
  On Windows, `approve` and `check` assert `VES_PROBE_HOST_PLATFORM_UNSUPPORTED`
  instead of skipping (AC 13). On POSIX they run in full: AC 4-11, each failing
  `check` row, and a lock that is not JSON.
- `tests/unit/skill-lock-file-refusals.test.mjs` covers door 1's refusals: a
  `.verchestra` that is missing, a file, or a link; a lock that is a
  directory, a link, or not JSON. It also covers the staged transaction:
  commit only over the planned lock, a kept generation, and rollback.
- `tests/unit/extension-approval-listing.test.mjs` covers door 3 and AC 8:
  `list` in code-unit order with every state, an approvals path that is no
  directory, no pinned anchor, and revoking an approval that does not verify.
- `tests/unit/extension-origin.test.mjs` covers the origin the lock records:
  userinfo is removed, and a local path is refused.
- `tests/unit/extension-errors.test.mjs` covers each path of the error mapper.

Linux new-code coverage was measured under WSL 2 on Ubuntu 24.04, Node
24.14.0. It counts lines changed since `d069bf92` (the merge base of #679),
covered lines plus covered conditions, the way SonarCloud counts them. The
input is `test:unit` and `test:contract` with `VES_COVERAGE=1`, merged by
`scripts/merge-coverage.mjs`. The security scope was not run, so these are
lower bounds. The "before" column reproduces SonarCloud's per-file figures to
within a point; `main.ts` differs by one line.

| File | Before (`985f3b8f`) | After |
| --- | --- | --- |
| `extension/extension-add.ts` | 31.2 % | 99.4 % |
| `extension/extension-approve.ts` | 41.7 % | 99.2 % |
| `extension/extension-workspace.ts` | 50.9 % | 100 % |
| `extension/extension-check.ts` | 65.2 % | 96.8 % |
| `extension/extension-command.ts` | 67.4 % | 99.5 % |
| `extension/extension-approval-store.ts` | 84.8 % | 96.6 % |
| `extension/skill-lock-file.ts` | 92.8 % | 99.2 % |
| `extension/extension-errors.ts` | 91.0 % | 100 % |
| `extension/extension-seal.ts` | 96.0 % | 99.0 % |
| `main.ts` | 6.7 % | 100 % |
| `task/task-dispatch.ts` (new) | - | 98.3 % |
| All product sources changed since `d069bf92` | 76.8 % | 98.4 % |

SonarCloud reported 77.2 % for the last row; the difference is the security
scope.

### Issues

- **Fixed: S6582**, `skill-lock-file.ts:116`. The `.verchestra` check uses an
  optional chain.
- **Fixed: S7503**, `extension-seal.ts:72`. The verify-only signer returns
  `Promise.reject(...)` instead of being an `async` function with no `await`.
  `EvidenceSigner.sign` only asks for a promise, and a call still rejects with
  the same error.
- **Left: S9382**, `extension-workspace.ts:50`. `requireNoLink` must walk the
  path from the Workspace root down and stop at the first link or non-directory.
  Concurrent `lstat`s would reach components through a link before the link
  is seen, which is exactly what the walk refuses.
- **Left: S9382**, `extension-approval-store.ts:286`. `list` evaluates each
  approval in code-unit order and stops at the first one whose read fails.
  Concurrent evaluation would keep reading after a failure, and would report
  whichever failure settled first instead of the first in order.
- **Left: S3776**, `governed-skill-registry.ts:301`. The cognitive complexity
  predates this feature. SonarCloud flagged it only because #679 changed the
  signature line.

### Gates

Windows 11 Pro, x64, Node 24.14.0:

- `corepack pnpm gate:quick` passes. format:check, lint, typecheck and
  complexity pass; complexity reports 169 baselined keys and nothing new
  above 10. Unit: 3226 passed. Agent-readiness: 413 passed. Census: 14 passed.
- `corepack pnpm test:contract`: 991 passed, 0 failed.
- `node --test tests/architecture/*.test.mjs`: 146 passed.
- `tests/e2e/extension-cli-e2e.test.mjs`, `tests/e2e/cli-launchers-e2e.test.mjs`
  and `tests/e2e/task-check-e2e.test.mjs`: 62 passed, 0 failed.
- `corepack pnpm agent:check` passes.

Linux, Ubuntu 24.04 under WSL 2, Node 24.14.0:

- `test:unit` and `test:contract` pass with `VES_COVERAGE=1`; they are the
  coverage run.
- In one run, 292 passed, 0 failed and 0 skipped across:
  - `tests/e2e/extension-cli-e2e.test.mjs`
  - `tests/contract/cli-surface.test.mjs`
  - `tests/e2e/cli-launchers-e2e.test.mjs`
  - `tests/build/sealed-launcher-closure.test.mjs`
  - `tests/architecture/*.test.mjs`
  - `tests/contract/task-command-platform.test.mjs`
  - `tests/unit/task-cli-composition.test.mjs`
  - the new tests
- `tests/e2e/task-check-e2e.test.mjs` and `tests/e2e/task-cli-e2e.test.mjs`:
  73 passed, 0 failed.

`pnpm install --frozen-lockfile` left `pnpm-lock.yaml` unchanged on both
hosts. Not run: `gate:full`, the security scope, and macOS, which CI covers.
