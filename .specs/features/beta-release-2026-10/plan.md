# Beta release 2026-10: an external tester can install, run, and report

## Problem

An external tester who runs `npx verchestra` today (npm `latest` is `0.0.0-qualification.8`) cannot
reach a first governed task, or say why not, without the maintainer:

- Every setup refusal reads alike in the terminal. The CLI prints `<code>: <recovery>` and drops the
  envelope's safe details (`apps/vestra-cli/src/cli.ts:286`), so `VES_TASK_NOT_CONFIGURED` never names
  its requirement. A missing `task-gates.json` names neither its path nor its shape
  (`apps/vestra-cli/src/task/task-gates.ts:64`), while the billing refusal already prints both. A
  request model outside the price table is refused without the accepted models, which is where the
  only real pilot run (#406, P1 attempt 2) stopped.
- `vestra <command> --help` is an argument error, the recovery text sends an `npx` user to a
  repository-relative `docs/` path, and an unexpected failure loses the `VES_` code of its cause.
- On a Node below 24.14.0 the launcher fails without a reason: the package declares the engine and
  nothing checks it. On a stalled network `npx verchestra` waits on the runtime's internal timeouts
  with no message, because no fetch carries a bound (`packages/distribution/src/tuf-update-client.ts:493-515`).
  A published build's `--version` says "source build, no verified release artifact" and names no
  commit, so a report cannot name the build.
- The quick-start gives Workspace state paths for macOS only; the bug form requires contributor fields
  (acceptance criteria, handoff) and labels every report `status: ready`; README, launcher README and
  site cite three different versions; the CHANGELOG stops at the first release while the publication
  ledger records eight; the site lists T75-T77 as planned although T77 is complete and the 1.0
  decision is a signed hold.

A task run against a repository whose content the tester does not control exposes the tester's
machine:

- On Windows, `git` and `taskkill` start by bare name with the repository or worktree as working
  directory (`workspace-scanner.ts:61`, `safe-init.ts:206`, `task-worktree.ts:185,194`,
  `doctor-composition.ts:159`, `process-tree-terminator.ts:15`), while provider and gate executables
  are already absolute.
- A model-written path whose segment ends in a dot (`.git.`, `config.json.`) passes the Git-metadata
  and protected-path comparisons in `packages/domain/src/primitives/task-path.ts`, and Win32 opens
  `.git` or `config.json`.
- `git commit --no-verify` skips pre-commit and commit-msg only. Post-checkout and post-commit hooks
  from a configured `core.hooksPath` (husky's `.husky`, for one) run during worktree creation and the
  gate commit, and the model writes those files.
- The quick-start says a gate "runs in the isolated task worktree" (`docs/quick-start.md:175-176`),
  which reads as a sandbox; a gate runs model-written code with the user's privileges, network and
  home directory.

Two published claims exceed the evidence: the probe-host ADR and threat model (#569), and the
timestamp refresh, where no test fails if the component-expiry rules are removed and two runs can
sign the same version (#568). Eight Dependabot alerts are open: five are fixed in `main` and wait for
a re-scan, three sit in the site's tooling chain (zod through lighthouse, postcss-selector-parser
through expressive-code, katex through mermaid). The platform fleet runs only when someone dispatches
it, and the maintainer's Windows integration run shows 22 symlink `EPERM` failures that look like
regressions.

Who pays: the first wave of external testers, and the owner, who is the only triage channel.
Evidence: the read-only audit of 2026-10-24 against `81d7fd2`; `.specs/features/live-task-pilot/validation.md`;
`git tag` and `gh release list` both empty; `docs/qualification/tuf-publication-ledger.json`
sequences 1-8.

When this ships, a tester on macOS, Linux or Windows installs a pinned build that names its
revision, repairs a refused setup from the terminal text alone, files a bug through a short form, and
reads scope and security claims that match the code. Repository content can no longer start a
binary or a hook or reach a protected path through a Win32 alias, and a refresh refuses a version
that collides with what is live.

## Flow

This reuses the public-error envelope and its safe details, the billing refusal's stderr
explanation, the launcher's `diagnosticCodeOf` and host refusal, `findExecutable`'s absolute-PATH
rule, the task-path comparison folding, the candidate build's esbuild `define`, and the existing
README-to-site drift tests; no module is added.

1. `npx verchestra@<pinned version>` -> the published bin shim in `apps/vestra-launcher` (exists) - refuses a Node below 24.14.0 before it imports the bootstrap, then hands argv to `runBootstrap`
2. `runBootstrap` (exists) -> `HttpsDistributionSource` in `packages/distribution` (exists) - every metadata read and every 1 MiB target range is bounded in time (door 2); a timeout reaches the launcher's stderr line as its diagnostic code
3. `runCli` in `apps/vestra-cli` (exists) - `--version` reads the revision that `scripts/t76-build-candidate.mjs` (exists) compiles into a sealed build (door 1); `<command> --help` renders the command manifest's options; a refusal renders code, safe details and recovery
4. `apps/vestra-cli/src/task` (exists) - the gate-allowlist and model refusals explain their fix on stderr, reading the price table in `packages/application` (exists)
5. git and taskkill call sites in `packages/platform-node`, `packages/workspace`, `packages/self-test` and `apps/vestra-cli` (exist) - start the executable by absolute path; every git command of the task path carries hooks disabled
6. `task-path.ts` in `packages/domain` (exists) - comparison folding also drops a segment's trailing dots; the worktree tool, the MCP bridge tools, the Git worktree adapter and the coordination plan (exist) read it unchanged
7. out: terminal lines and `--output json` envelopes; README, quick-start, SECURITY, SUPPORT, CHANGELOG and site pages; the tester issue form; Dependabot and pnpm settings; CI workflows; and `scripts/t76-refresh-timestamp.mjs` (exists) refusing a version at or below the live one

## Impact

| Front | What changes |
| --- | --- |
| domain | existing term: Git metadata and protected path - matched a path in any letter case; now also with trailing dots dropped from each segment. Who branches on it: `#logicalTarget` in `worktree-tool-adapter.ts`, `mcp-bridge-tools.ts`, `taskPathsOverlap` in `coordination-plan.ts`, `gate-commit.ts`. The admission rule `isTaskPath` and both task-request schemas stay as they are |
| CLI text | the human error line gains the safe details between code and recovery. Who reads it: e2e tests that pin stderr lines; nothing parses it, since `--output json` exists for that |
| CLI contract | `version` data under `--output json` gains `revision` (door 1) |
| launcher | a Node below 24.14.0 exits 64 with `VES_VESTRA_HOST_UNSUPPORTED` where it used to fail somewhere inside the bootstrap |
| status surfaces | the site capability matrix (`apps/site/src/data/product.ts`) and the README matrix: the T75-T77 row stops saying planned, and a governed-task row appears. These are chain-advance status surfaces; no qualification report changes |
| dependencies | site and tooling only: the `lighthouse` override 13.4.1 -> 13.5.0, `mermaid` -> 12.2.0, `@expressive-code/*` -> 0.44.3. No dependency of `packages/*`, `apps/vestra-cli` or `apps/vestra-launcher` moves. AGENTS.md requires explicit approval for an upgrade; approving this plan is that approval |
| CI | `platform-matrix.yml` gains a nightly schedule; it was dispatch-only by stated design, and its runners are free minutes on this public repository |
| stored data | nothing to migrate: no schema, ledger, state-root or database format changes |

## Relations

None - no stored-data shape change.

## Surface

Only command signatures this adds or changes. The statuses are process exit codes.

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `vestra --version` | `--output human` or `json` | human, sealed build: `Verchestra <version> (revision <12 hex>)`; JSON `data`: `product`, `semanticVersion`, `releaseDigest`, `revision` | exit 0 |
| `vestra <command> --help` | the command's words, `--output human` or `json` | usage and the command's declared options | exit 0; no such command: exit 2 |
| launcher on a Node below 24.14.0 | any argv | one stderr line `VES_VESTRA_HOST_UNSUPPORTED: ...` | exit 64 |
| launcher on a stalled release source | any argv | one stderr line carrying `(VES_TUF_SOURCE_TIMEOUT)` | source answers HTTP 200 or 206 within the bound: continues; otherwise exit 70 |
| `scripts/t76-refresh-timestamp.mjs` | live base URL, `--metadata-version` | a refusal before signing | exit 1 with a `VES_T76_REFRESH_*` code |

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1. `version` JSON key | `"revision": "<40 lowercase hex>"` in a sealed build, `"revision": null` from source; human suffix `(revision <first 12 hex>)` | `releaseId` (`release:verchestra:<version>:<12 hex>`): repeats `semanticVersion` and truncates the commit a triager needs. Filling `releaseDigest`: circular, since that digest covers a manifest holding the launcher's own digest (`apps/vestra-cli/src/release-manifest.ts`) |
| 2. Diagnostic code and bound | `VES_TUF_SOURCE_TIMEOUT`, raised when one metadata read or one range read exceeds 30 000 ms (`AbortSignal.timeout(30_000)`) | Reusing `VES_TUF_SOURCE_HTTP`: indistinguishable from a served-content failure, the confusion that cost #387 a misdiagnosis. An idle-only timer: needs a streaming reader per 1 MiB range, while a 30 s total bound already admits any link above about 35 KB/s |

- Nothing else in this change is hard to reverse: the folding rule, the hooks setting, the error-line
  format, the issue form, the docs, the Dependabot and pnpm settings and the CI schedule each revert
  with a commit.

## Criteria

### S1: A refused setup names its fix in the terminal (P1)

The terminal line alone tells the tester what is missing and where it goes.

**Acceptance Criteria**

1. WHEN a command fails with a public error whose envelope carries safe details and the output is human THEN the CLI SHALL write one stderr line `<code> (<key>=<value>, ...): <recovery>` with the keys in code-point order, for example `VES_TASK_NOT_CONFIGURED (requirement=gate-allowlist): ...`
2. WHILE `--output json` is selected the CLI SHALL emit the error envelope with the same fields and values as before this change
3. IF the Workspace has no readable `task-gates.json` THEN `vestra task plan` and `vestra task start` SHALL write to stderr the absolute path they read and a JSON template holding `"schemaVersion": 1` and a `"commands"` object, before refusing with `VES_TASK_NOT_CONFIGURED` (`requirement=gate-allowlist`)
4. IF a task request names a model that is neither priced nor offered on a subscription for its driver THEN `vestra task plan` SHALL write to stderr the models that driver accepts, the `codex` list containing `gpt-5.5`, and keep its existing refusal code
5. IF a failure that is not a public error but carries a bare `VES_` code reaches the CLI boundary THEN the human `VES_CLI_INTERNAL` line SHALL include that code as `cause=<code>` among its details, and the JSON envelope SHALL stay unchanged
6. The CLI SHALL name no repository-relative `docs/` path in any public error recovery text; each names an absolute `https://github.com/accd/verchestra/blob/main/docs/` URL

**Independent test:** in a fresh Workspace with no `task-gates.json`, `vestra task plan --request docs/examples/task-request.json` prints the expected path, the template and `requirement=gate-allowlist`.

### S2: A command lists its own options (P2)

`--help` after any command answers instead of refusing.

**Acceptance Criteria**

7. WHEN `vestra <command> --help` is run THEN the CLI SHALL print to stdout `Usage: vestra <command> [options]` and one line per option the command's manifest declares, with its allowed values when declared, and exit 0
8. WHEN `vestra <command> --help --output json` is run THEN the CLI SHALL return `data` holding `command` and `options`, each option with `name`, `kind`, and `values` when declared, and exit 0
9. IF the words before `--help` name no installed command THEN the CLI SHALL refuse with `VES_CLI_ARGUMENT_INVALID` and exit 2

**Independent test:** `vestra task plan --help` lists `--request` and exits 0.

### S3: The launcher's first run fails with a reason (P1)

A wrong Node or a stalled network ends in one line that says so.

**Acceptance Criteria**

10. IF the ambient Node is below 24.14.0 THEN the published bin SHALL print one stderr line beginning `VES_VESTRA_HOST_UNSUPPORTED:` that names `24.14.0`, and exit 64, before it imports the bootstrap or opens a network connection
11. IF a metadata read or a target range read has not completed within 30 000 ms THEN the distribution source SHALL abort it and fail with `VES_TUF_SOURCE_TIMEOUT`, and the launcher's stderr line SHALL carry `(VES_TUF_SOURCE_TIMEOUT)` and exit 70
12. IF a metadata response with no content length streams past its verified byte bound THEN the source SHALL fail with `VES_TUF_SOURCE_LIMIT` before the response body ends

**Independent test:** under Node 22, the bin prints the host line and exits 64; against a fake source that never answers, the launcher fails with the timeout code.

### S4: A published build names its revision (P1)

A bug report can name the exact build.

**Acceptance Criteria**

13. WHILE running a sealed release the CLI SHALL answer `vestra --version` with `Verchestra <semanticVersion> (revision <first 12 hex of the candidate revision>)`, and never with the text `source build`
14. WHILE running a sealed release `vestra --version --output json` SHALL return `data.revision` equal to the 40-hex candidate revision
15. WHILE running from source `vestra --version --output json` SHALL return `data.revision` as `null` and the human line SHALL keep `(source build, no verified release artifact)`

**Independent test:** a candidate built at a known revision prints that revision's first 12 hex characters.

### S5: Repository content cannot start a program or a hook, or alias a protected path (P0)

Untrusted repository content stays data.

**Acceptance Criteria**

16. The product source SHALL start every `git` child process through an executable path resolved only from absolute `PATH` entries (`git.exe` on Windows), never through the bare name `git`
17. WHILE on win32 the product SHALL start `taskkill` as `<SystemRoot>\System32\taskkill.exe`
18. WHEN a worktree write or an MCP bridge read names a path whose segment is `.git` followed by one or more dots THEN the system SHALL treat it as Git metadata, refusing the write with `VES_TOOL_PROTECTED_PATH` and the read with `VES_BRIDGE_PATH_PROTECTED`
19. WHEN a worktree write names a path that differs from a protected path only by trailing dots on its segments, such as `config.json.` against `config.json` THEN the system SHALL refuse it with `VES_TOOL_PROTECTED_PATH`
20. The task-path admission rule SHALL accept exactly the strings the path patterns of `schemas/task-request/1.schema.json` accept, and neither task-request schema SHALL change
21. WHEN the task path runs git in a repository whose `core.hooksPath` names a versioned directory THEN no hook from that directory SHALL run during worktree creation, gate commit or worktree removal
22. The task path SHALL run every git command with `core.fsmonitor=false`

**Independent test:** a fixture repository with `core.hooksPath=.githooks` and post-checkout, post-commit and reference-transaction hooks that write a sentinel completes a task with no sentinel written.

### S6: The timestamp refresh refuses an expired component and a colliding version (P1)

Closes #568.

**Acceptance Criteria**

23. IF any component is expired at refresh time THEN the timestamp refresh SHALL refuse to sign
24. The timestamp refresh SHALL set the signed timestamp's expiry no later than the earliest component expiry
25. The publish and refresh workflows SHALL share one `concurrency` group with `cancel-in-progress: false`
26. IF the timestamp served at the live base URL has a version at or above the requested one THEN the refresh SHALL refuse with a `VES_T76_REFRESH_*` code before signing
27. IF the live timestamp cannot be read THEN the refresh SHALL refuse with a `VES_T76_REFRESH_*` code before signing

**Independent test:** removing either expiry rule from `tuf-publication.ts` fails a test; a fake live endpoint serving version N makes a refresh to N refuse.

### S7: Security claims state what is not contained (P1)

Covers #569's documentation path and the gate's privilege boundary.

**Acceptance Criteria**

28. The system SHALL state in `docs/quick-start.md` and in `SECURITY.md` that gates run model-written code with the user's privileges, network and home directory, that the task worktree is not a sandbox, and that an untrusted repository belongs in a disposable VM or container or under a dedicated OS user
29. The system SHALL state in AD-037 and in the probe host's ADR and threat model each limit #569 names: a worker can leave a detached descendant running, the grant binds the entry file and not the executable, arguments or environment, and admission checks consistency, not authenticity
30. IF a module reachable from `apps/vestra-cli` or `apps/vestra-launcher` imports `@verchestra/extension-host` THEN the architecture suite SHALL fail with a message naming #569

**Independent test:** adding an `@verchestra/extension-host` import to `apps/vestra-cli/src/main.ts` fails `pnpm test:architecture`.

### S8: A tester can set up, scope and report without the maintainer (P1)

The documents a tester reads first agree with each other and with the code.

**Acceptance Criteria**

31. The system SHALL carry in `README.md` a "Beta testers" section that gives the pinned `npx verchestra@<latest published version>` command, labels `init`, `self-test`, `doctor` and `secret` beta and `task` experimental, lists what to attach to a bug, and links the not-a-sandbox statement
32. The system SHALL name in every `npx verchestra@` command of `README.md`, `docs/quick-start.md`, `apps/vestra-launcher/README.md` and the site's install page the version of the latest sequence in `docs/qualification/tuf-publication-ledger.json`
33. The system SHALL give in `docs/quick-start.md` the Workspace state directory for macOS (`~/Library/Application Support/Verchestra/state`), Linux (`$XDG_STATE_HOME/verchestra`, else `~/.local/state/verchestra`) and Windows (`%LOCALAPPDATA%\Verchestra\state`), and say that the Workspace ID is in `.verchestra/workspace.yaml`
34. The system SHALL ship `docs/examples/task-request.json` as a Task Request v1 that `schemas/task-request/1.schema.json` and `normalizeTaskRequest` accept
35. The system SHALL carry in `docs/quick-start.md` a PowerShell form of each setup command block and say where native `claude.exe` and `codex.exe` come from
36. WHILE on win32 the Codex login hint SHALL read `$env:CODEX_HOME='<directory>'; codex login`
37. The system SHALL state in `README.md` and `docs/quick-start.md` that `npx` needs Node 24.14.0 or later, and neither SHALL say Node is no prerequisite
38. The system SHALL state in `docs/quick-start.md` that `vestra doctor` is not a setup check and that `BLOCKED` is its expected verdict on a machine set up only for `task`
39. The system SHALL ship `.github/ISSUE_TEMPLATE/tester_bug_report.yml` requiring exactly the `vestra --version --output json` output, OS and architecture, Node version, the command run, and its `--output json` envelope, applying the `bug` label and no `status:` label
40. The system SHALL list in `SUPPORT.md` what to attach: `vestra --version --output json`, the failing command rerun with `--output json`, `vestra task status --output json` and `vestra doctor --output json`
41. The system SHALL carry in `CHANGELOG.md` one section per ledger sequence 1-8 naming that sequence's version and its `releaseId` where the ledger records one
42. The system SHALL show in the site capability matrix and the README status matrix the platform matrix and release candidate (T75-T76) as qualified, the 1.0 decision as a signed hold, and a governed-task row as experimental
43. The system SHALL link the site's install page to the quick-start section that delivers a governed task

**Independent test:** a reader with only the README and the quick-start reaches `vestra task plan` on Windows using the PowerShell blocks and the state-directory table.

### S9: The open alerts close without moving product dependencies (P2)

Dependency hygiene limited to the site and tooling chain.

**Acceptance Criteria**

44. The lockfile SHALL resolve no `zod@3.25.76`, `postcss-selector-parser@6.1.5` or `katex@0.16.47`
45. The change SHALL move no dependency version of `packages/*`, `apps/vestra-cli` or `apps/vestra-launcher`
46. The system SHALL make `.github/dependabot.yml` ignore `@cedar-policy/cedar-wasm` minor and patch updates and `json-schema-to-typescript` major updates, each asserted by `tests/agent-readiness/dependency-policy.test.mjs`
47. The system SHALL set `minimumReleaseAge: 4320` in `pnpm-workspace.yaml` and `cooldown` `default-days: 3` for the npm ecosystem in `.github/dependabot.yml`

**Independent test:** `pnpm install --frozen-lockfile` and `pnpm site:test` pass, and a lockfile search for the three versions finds none.

### S10: CI shows a platform regression without a dispatch (P2)

The fleet runs on its own, and a Windows host without symlink rights reads as a setup problem.

**Acceptance Criteria**

48. The system SHALL run `.github/workflows/platform-matrix.yml` on a daily `schedule` against `main` with gate profile `full`, in addition to `workflow_dispatch`
49. IF creating a directory symlink fails with `EPERM` on Windows THEN the MCP bridge fixture SHALL create a junction instead
50. IF creating a file symlink fails with `EPERM` on Windows THEN each affected test SHALL fail with a message naming Windows Developer Mode

**Independent test:** `pnpm test:integration` on a Windows host without Developer Mode fails only with the Developer Mode message.

## Out of scope

| Excluded | Why |
| --- | --- |
| Linux single-session journey e2e on pull-request CI (audit TST-002) | M; it changes what may be claimed about Linux, so `task` stays partial there; post-beta unless the owner pulls it in |
| Code fixes for #569 (descendant escape, bound launch environment, authenticated admission) | nothing composes the probe host; criterion 30 blocks composition until they land |
| #570 probe-host mutants, schema version and zeroization | same reason as #569; post-beta |
| `doctor` probes for `claude`, `codex`, PowerShell, gates and passphrase | M; criterion 38 documents the limit |
| A support-bundle command | the attach list of criterion 40 answers the beta's need |
| Refusing Windows reserved device names (`con`, `nul`, `com1`) in task paths | no containment escape: a device is not a file outside the worktree; post-beta issue |
| Renaming the version to `0.1.0-beta.1` | one-way across npm, ledger and TUF; the signed hold keeps `0.0.0-qualification` |
| npm provenance or trusted publishing | M; post-beta |
| Cedar 4.14, Pi 1.x and json-schema-to-typescript 16 | qualification successors tracked in #563 |
| The P2 audit backlog (DX-011, DX-014, DX-021 to DX-023, SEC-007 to SEC-011, ARQ-003 to ARQ-008, TST-005 to TST-007) | filed as post-beta issues |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Artifact set for this feature | `plan.md`, `checks.md`, `verification.md`, plus the schema-checked `handoff.md` created when building starts; each slice is one ordered task committed on its own | `.specs/AGENTS.md` lists its artifacts "as applicable" and requires atomic, ordered, independently verifiable tasks; a slice is that unit | n |
| Verification profile | `standard` | `.specs/AGENTS.md` requires a discrimination sensor before completion, which `light` does not run | n |
| Freeze before pilot attempt 3 | slices that touch the task path land on `main` before attempt 3 reports; what waits is the publication of `.9` | attempt 3 runs the published `.8` whatever `main` holds, so a commit cannot change what it tests | n |
| Where the trailing-dot rule lives | in the comparison folding of `task-path.ts`, not in `isTaskPath` | `tests/unit/task-path.test.mjs:210` pins `isTaskPath` to the schema patterns; narrowing the schemas changes the contract of every request file | n |
| #569 path | documentation plus the architecture rule, no code | jury verdict D2; #569's acceptance admits a precise statement of the limits | n |
| Live timestamp unreachable at refresh | refuse | fail closed matches every other publication guard; the operator retries | n |
| Dependabot `ignore` and security updates | alerts still open for an ignored package; whether `ignore` also stops a security-update pull request is not verified | GitHub's documentation was not checked for this case; #563's advisory trigger covers it either way | n |
| `task` label in the beta | experimental | the only real run ended FAILED; criterion 31 changes in one line once a pilot reaches human review | n |
| Self-test Git fixtures | inside criterion 16 | one rule for every git start is cheaper to prove than a list of exceptions | n |

**Open questions:** three stay open; none blocks building, two block go-live. The owner approved
this plan on 2026-10-24 and adopted criterion 47.

| # | Kind | Question | Until answered |
| --- | --- | --- | --- |
| 1 | blocks go-live | Does pilot #406 attempt 3 on `.8` reach human review? | `task` stays experimental in criteria 31 and 42, and the macOS invite leaves `task` out |
| 2 | blocks go-live | The owner publishes `.9` (npm 2FA, R2 upload, ledger sequence 9) and pushes the tags, the GitHub Release and the `beta` dist-tag | criterion 32 keeps every install command on `.8`; the pin moves in the change that records `.9` |
| 3 | open | Is the freeze before attempt 3 a publication freeze (the default above) or a commit freeze on the task path? | S1 criteria 3-4 and S5 are built now under the default |

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| command `vestra --version` | output format and verbosity | AC 13, 14, 15 |
| command `vestra --version` | exit codes | existing - exit 0 |
| command `vestra <command> --help` | output format | AC 7, 8 |
| command `vestra <command> --help` | flags and defaults | AC 8 - `--output` keeps its human default |
| command `vestra <command> --help` | exit codes | AC 7, 9 |
| command `vestra <command> --help` | fails halfway | n/a - it prints and has no effect |
| every refusing `vestra` command | output format and verbosity | AC 1, 2, 5 |
| `vestra task plan` and `vestra task start` | fails halfway | existing - they refuse before any effect, and the recovery says nothing was changed |
| launcher `npx verchestra` | output format | AC 10, 11 |
| launcher `npx verchestra` | exit codes | AC 10 (64), AC 11 (70) |
| launcher `npx verchestra` | flags and defaults | n/a - argv passes through unchanged |
| launcher `npx verchestra` | fails halfway | existing - activation stages before it switches; a timeout leaves the previous activation in place (AD-036) |
| script `t76-refresh-timestamp.mjs` | exit codes | AC 26, 27 |
| script `t76-refresh-timestamp.mjs` | fails halfway | existing - it refuses before signing and uploads nothing |
| document README "Beta testers" | structure, depth, next step | AC 31 |
| document quick-start | structure and what the reader does next | AC 33, 35, 37, 38 |
| documents SECURITY.md and AD-037 | depth of the limits | AC 28, 29 |
| document SUPPORT.md | what the reader does next | AC 40 |
| document CHANGELOG.md | structure | AC 41 |
| issue form for testers | required fields and labels | AC 39 |
| site status and install pages | structure | AC 42, 43 |
| collection Dependabot ignore list | grouping and naming | existing - one entry per package with a `why:` comment, as #588 set |

## Sources

- #406 (supervised live pilot), #563 (qualification successors), #568 (TUF refresh), #569 (probe-host claims) - the issues this closes or depends on
- The beta-path plan and read-only audit reviewed with the owner on 2026-10-24 - source of the audit IDs: S1 DX-018, DX-002, DX-020, ARQ-001; S2 DX-019; S3 DX-006, SEC-005; S4 DX-016; S5 SEC-001, SEC-002, SEC-003; S7 SEC-004; S8 DX-001, DX-003 to DX-010, DX-012, DX-013, DX-015, DX-017; S9 the F2 alerts and SEC-006; S10 TST-003, TST-004
