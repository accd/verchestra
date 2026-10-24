# Beta release 2026-10 checks

Profile: standard
Plan: `.specs/features/beta-release-2026-10/plan.md`

57 checks in 10 slices · 2 one-way doors · 3 open questions, none blocking the build (two block go-live)

`<base>` below is the `main` revision the build branch starts from, recorded under `## Handoff`
when building starts. Every new test named here is written from its check, before the code that
satisfies it.

## Checks

Grouped by the plan's slices; numbering runs across the whole feature.

### S1 - A refused setup names its fix in the terminal · 9 files · 124 KB · ~31k

**C1** - A human-mode refusal whose envelope carries safe details prints exactly one stderr line `<code> (<key>=<value>, ...): <recovery>`, keys in code-point order (AC 1)
Proof: `node --test --test-name-pattern "human refusal line carries the safe details in key order" tests/contract/cli-surface.test.mjs`

**C2** - Under `--output json` the refusal envelope has the same fields and values the public error registry produces for that code and those details (AC 2)
Proof: `node --test --test-name-pattern "json refusal envelope is unchanged by the human detail line" tests/contract/cli-surface.test.mjs`

**C3** - With no `task-gates.json`, `vestra task plan` writes the absolute expected path and a JSON template holding `"schemaVersion": 1` and `"commands"` to stderr, then refuses `VES_TASK_NOT_CONFIGURED` with `requirement=gate-allowlist` (AC 3)
Proof: `node --test --test-name-pattern "a missing gate allowlist is explained with its path and template on plan" tests/unit/task-cli-composition.test.mjs`

**C4** - With no `task-gates.json`, `vestra task start` writes the same path and template to stderr before the same refusal (AC 3)
Proof: `node --test --test-name-pattern "a missing gate allowlist is explained with its path and template on start" tests/unit/task-cli-composition.test.mjs`

**C5** - A request model with neither a price nor a subscription entry makes `vestra task plan` write the driver's accepted models to stderr - the `codex` list contains `gpt-5.5`, the `claude-code` list contains every priced `claude-` model - and keep its refusal code (AC 4)
Proof: `node --test --test-name-pattern "an unpriced model refusal lists the accepted models" tests/unit/task-cli-composition.test.mjs`

**C6** - A non-public failure carrying a bare `VES_` code prints `VES_CLI_INTERNAL (cause=<code>, incident=cli-unexpected-failure): <recovery>`; one without a `VES_` code prints no `cause`; the JSON envelope is the registry's in both cases (AC 5)
Proof: `node --test --test-name-pattern "an internal failure names the VES code of its cause" tests/contract/cli-surface.test.mjs`

**C7** - No recovery text in any public error registry the CLI composes names a repository-relative `docs/` path; each names `https://github.com/accd/verchestra/blob/main/docs/`, table-driven over every definition (AC 6)
Proof: `node --test --test-name-pattern "no recovery text names a repository-relative docs path" tests/contract/cli-surface.test.mjs`

### S2 - A command lists its own options · 3 files · 37 KB · ~9k

**C8** - `vestra <command> --help` prints `Usage: vestra <command> [options]` and one line per declared option, with its allowed values when declared, and exits 0, table-driven over all 13 installed commands (AC 7)
Proof: `node --test --test-name-pattern "every command answers --help with its declared options" tests/contract/cli-surface.test.mjs`

**C9** - `vestra <command> --help --output json` returns `data` with `command` and `options` (each `name`, `kind`, and `values` when declared) and exits 0 (AC 8)
Proof: `node --test --test-name-pattern "command help in json lists the declared options" tests/contract/cli-surface.test.mjs`

**C10** - `vestra no-such-command --help` refuses `VES_CLI_ARGUMENT_INVALID` and exits 2 (AC 9)
Proof: `node --test --test-name-pattern "help for an uninstalled command is an argument error" tests/contract/cli-surface.test.mjs`

### S3 - The launcher's first run fails with a reason · 9 files · 68 KB · ~17k

**C11** - The Node guard refuses `20.0.0`, `22.12.0` and `24.13.9`, admits `24.14.0`, `24.15.1` and `25.0.0`, and its refusal is one line starting `VES_VESTRA_HOST_UNSUPPORTED:` that names `24.14.0`, with exit 64 (AC 10)
Proof: `node --test --test-name-pattern "the Node guard refuses below 24.14.0 with exit 64" tests/unit/vestra-launcher-host-selection.test.mjs`

**C12** - The packed bin runs the Node guard before it loads the bootstrap: it holds no static import of `bootstrap.js` and reaches it only after the guard admits the version (AC 10)
Proof: `node --test --test-name-pattern "the bin checks Node before importing the bootstrap" tests/build/vestra-launcher-package.test.mjs`

**C13** - A metadata read and a range read that never complete are aborted and fail with `VES_TUF_SOURCE_TIMEOUT` (bound injected at 50 ms) (AC 11)
Proof: `node --test --test-name-pattern "a stalled read fails with VES_TUF_SOURCE_TIMEOUT" tests/e2e/tuf-source-adapters.test.mjs`

**C14** - The source's default bound is 30 000 ms per read; a metadata read answering HTTP 200 and a range read answering HTTP 206 inside the bound return their bytes, each fetch carrying an abort signal (AC 11, door 2)
Proof: `node --test --test-name-pattern "reads carry a 30000 ms abort signal and succeed within it" tests/e2e/tuf-source-adapters.test.mjs`

**C15** - An activation failing with `VES_TUF_SOURCE_TIMEOUT` makes the launcher print one stderr line carrying `(VES_TUF_SOURCE_TIMEOUT)` and exit 70 (AC 11)
Proof: `node --test --test-name-pattern "a source timeout surfaces in the launcher line with exit 70" tests/unit/vestra-launcher-bootstrap.test.mjs`

**C16** - A metadata response with no content length that streams without end fails `VES_TUF_SOURCE_LIMIT` once it passes its bound, while the body is still open (AC 12)
Proof: `node --test --test-name-pattern "an unbounded metadata body fails before it ends" tests/e2e/tuf-source-adapters.test.mjs`

### S4 - A published build names its revision · 5 files · 84 KB · ~21k

**C17** - A sealed CLI built at revision R answers `vestra --version` with `Verchestra <version> (revision <first 12 hex of R>)` and contains no `source build` text (AC 13)
Proof: `node --test --test-name-pattern "a sealed build names its revision in --version" tests/build/sealed-launcher-closure.test.mjs`

**C18** - The same sealed CLI answers `vestra --version --output json` with `data.revision` equal to R, 40 lowercase hex (AC 14, door 1)
Proof: `node --test --test-name-pattern "a sealed build reports its revision in version JSON" tests/build/sealed-launcher-closure.test.mjs`

**C19** - From source, `vestra --version --output json` returns `data.revision` as `null` and the human line keeps `(source build, no verified release artifact)` (AC 15, door 1)
Proof: `node --test --test-name-pattern "a source build reports a null revision" tests/e2e/cli-launchers-e2e.test.mjs`

### S5 - Repository content cannot start a program or a hook, or alias a protected path · 14 files · 145 KB · ~36k

**C20** - No production source under `packages/*/src` or `apps/*/src` starts a child process by the bare name `git` or `taskkill`, table-driven over every `execFile`, `execFileSync`, `spawn` and `spawnSync` call site (AC 16, 17)
Proof: `node --test --test-name-pattern "no child process starts git or taskkill by bare name" tests/architecture/absolute-child-executables.test.mjs`

**C21** - The git resolver skips relative `PATH` entries, returns the first absolute entry holding `git` (`git.exe` on win32), and reports git absent when only relative entries hold it (AC 16)
Proof: `node --test --test-name-pattern "the git resolver takes only absolute PATH entries" tests/unit/git-executable.test.mjs`

**C22** - On win32 the process-tree terminator's executable is `<SystemRoot>\System32\taskkill.exe` for the `SystemRoot` it is given (AC 17)
Proof: `node --test --test-name-pattern "taskkill resolves under SystemRoot" tests/integration/process-tree-terminator.test.mjs`

**C23** - `namesGitMetadata` is true for `.git.`, `.git..`, `src/.git.` and `.GIT.`, and false for `.github`, `git.` and `.gitignore` (AC 18)
Proof: `node --test --test-name-pattern "a trailing-dot alias of .git is Git metadata" tests/unit/task-path.test.mjs`

**C24** - The worktree tool refuses writes to `.git.` and `src/.git./config` with `VES_TOOL_PROTECTED_PATH` and leaves the worktree unchanged (AC 18)
Proof: `node --test --test-name-pattern "a trailing-dot alias of .git is refused" tests/security/worktree-tool-security.test.mjs`

**C25** - The MCP bridge refuses a read of `.git./config` with `VES_BRIDGE_PATH_PROTECTED` (AC 18)
Proof: `node --test --test-name-pattern "a trailing-dot alias of .git is not readable" tests/security/mcp-tool-bridge-security.test.mjs`

**C26** - `isProtectedTaskPath` is true for `config.json.` against `config.json` and for `secrets./key` against `secrets`, and the worktree tool refuses a write to `config.json.` with `VES_TOOL_PROTECTED_PATH` (AC 19)
Proof: `node --test --test-name-pattern "a trailing-dot alias of a protected path is protected" tests/unit/task-path.test.mjs`
Proof: `node --test --test-name-pattern "a trailing-dot alias of a protected path is refused" tests/security/worktree-tool-security.test.mjs`

**C27** - `isTaskPath` still accepts exactly what the schema path patterns accept, and both task-request schemas are byte-identical to `<base>` (AC 20)
Proof: `node --test --test-name-pattern "the grammar accepts exactly what the task request schema accepts for every path field" tests/unit/task-path.test.mjs`
Proof: `git diff --exit-code <base> -- schemas/task-request/1.schema.json schemas/task-request/2.schema.json`

**C28** - In a repository with `core.hooksPath=.githooks` whose post-checkout, post-commit and reference-transaction hooks each write a sentinel, worktree creation, gate commit and worktree removal leave no sentinel (AC 21)
Proof: `node --test --test-name-pattern "a versioned hooks path runs no hook on worktree create and remove" tests/integration/task-worktree-git.test.mjs`
Proof: `node --test --test-name-pattern "a versioned hooks path runs no hook on the gate commit" tests/integration/gate-commit-adapters.test.mjs`

**C29** - Every argument vector the task path's git runners build carries `-c core.fsmonitor=false` and the hooks-disabling setting, on every platform (AC 21, 22)
Proof: `node --test --test-name-pattern "every task-path git command disables hooks and fsmonitor" tests/integration/task-worktree-git-environment.test.mjs`

### S6 - The timestamp refresh refuses an expired component and a colliding version · 8 files · 150 KB · ~38k

**C30** - A refresh with one component expired at refresh time refuses to sign, and the test fails when the component-expiry check is removed (AC 23)
Proof: `node --test --test-name-pattern "a refresh refuses an expired component" tests/build/tuf-publication.test.mjs`

**C31** - A refresh whose components expire at different times signs a timestamp expiring no later than the earliest of them, and the test fails when the earliest-expiry choice is removed (AC 24)
Proof: `node --test --test-name-pattern "the refreshed timestamp expires no later than the earliest component" tests/build/tuf-publication.test.mjs`

**C32** - `t76-publish-release.yml` and `t76-refresh-timestamp.yml` declare the same `concurrency.group` with `cancel-in-progress: false` (AC 25)
Proof: `node --test --test-name-pattern "publish and refresh share one non-cancelling concurrency group" tests/agent-readiness/t76-refresh-workflow.test.mjs`

**C33** - A live endpoint serving timestamp version N makes `scripts/t76-refresh-timestamp.mjs` requesting N, and requesting N-1, exit 1 with a `VES_T76_REFRESH_` code before any signed file is written (AC 26)
Proof: `node --test --test-name-pattern "a refresh at or below the live timestamp version refuses before signing" tests/build/t76-timestamp-refresh.test.mjs`

**C34** - A live timestamp that cannot be read - connection refused, HTTP 404, unparsable JSON - makes `scripts/t76-refresh-timestamp.mjs` exit 1 with a `VES_T76_REFRESH_` code before any signed file is written (AC 27)
Proof: `node --test --test-name-pattern "an unreadable live timestamp refuses before signing" tests/build/t76-timestamp-refresh.test.mjs`

### S7 - Security claims state what is not contained · 6 files · 60 KB · ~15k

**C35** - `docs/quick-start.md` and `SECURITY.md` each state that a gate runs model-written code with the user's privileges, network and home directory, that the worktree is not a sandbox, and that an untrusted repository belongs in a disposable VM or container or under a dedicated OS user (AC 28)
Proof: `node --test --test-name-pattern "quick-start and SECURITY state that a gate is not a sandbox" tests/agent-readiness/beta-tester-docs.test.mjs`

**C36** - AD-037 in `.specs/STATE.md`, `.specs/features/out-of-process-probe-host/adr.md` and its `threat-model.md` each state the three #569 limits - a detached descendant can outlive its worker, the grant binds the entry file only, admission checks consistency and not authenticity - table-driven over 3 limits by 3 documents (AC 29)
Proof: `node --test --test-name-pattern "the probe-host documents state the three #569 limits" tests/agent-readiness/beta-tester-docs.test.mjs`

**C37** - The architecture suite fails, naming #569, when any module reachable from `apps/vestra-cli/src` or `apps/vestra-launcher/src` imports `@verchestra/extension-host`, and passes on the tree at `<base>` (AC 30)
Proof: `node --test --test-name-pattern "no CLI or launcher module reaches extension-host until #569" tests/architecture/extension-host-composition.test.mjs`

### S8 - A tester can set up, scope and report without the maintainer · 15 files · 144 KB · ~36k

**C38** - The README "Beta testers" section gives the pinned `npx verchestra@<latest ledger version>` command, labels `init`, `self-test`, `doctor` and `secret` beta and `task` experimental, lists what to attach to a bug, and links the not-a-sandbox statement (AC 31)
Proof: `node --test --test-name-pattern "the README Beta testers section scopes every command family" tests/agent-readiness/beta-tester-docs.test.mjs`

**C39** - Every `npx verchestra@` command in `README.md`, `docs/quick-start.md`, `apps/vestra-launcher/README.md` and the site's install page names the version of the latest sequence in `docs/qualification/tuf-publication-ledger.json` (AC 32)
Proof: `node --test --test-name-pattern "every pinned npx command names the latest ledger version" tests/agent-readiness/beta-tester-docs.test.mjs`

**C40** - The quick-start's state-directory table matches `resolveStateRoot` for macOS, Linux with and without `XDG_STATE_HOME`, and Windows, and names `.verchestra/workspace.yaml` as where the Workspace ID is (AC 33)
Proof: `node --test --test-name-pattern "the quick-start gives the state directory for every supported OS" tests/agent-readiness/beta-tester-docs.test.mjs`

**C41** - `docs/examples/task-request.json` is accepted by `schemas/task-request/1.schema.json` and by `normalizeTaskRequest` (AC 34)
Proof: `node --test --test-name-pattern "the v1 example request validates" tests/e2e/task-request-examples-e2e.test.mjs`

**C42** - Every quick-start setup block written in bash has a PowerShell form, and the quick-start says where native `claude.exe` and `codex.exe` come from (AC 35)
Proof: `node --test --test-name-pattern "every quick-start setup block has a PowerShell form" tests/agent-readiness/beta-tester-docs.test.mjs`

**C43** - On win32 the Codex login hint is `$env:CODEX_HOME='<directory>'; codex login` with any `'` in the directory doubled; on darwin and linux it stays `CODEX_HOME='<directory>' codex login` (AC 36)
Proof: `node --test --test-name-pattern "the Codex login hint uses PowerShell syntax on win32" tests/integration/codex-identity.test.mjs`

**C44** - `README.md` and `docs/quick-start.md` state that `npx` needs Node 24.14.0 or later, and neither says Node is not a prerequisite (AC 37)
Proof: `node --test --test-name-pattern "the docs state the Node 24.14.0 floor for npx" tests/agent-readiness/beta-tester-docs.test.mjs`

**C45** - The quick-start states that `vestra doctor` is not a setup check and that `BLOCKED` is its expected verdict on a machine set up only for `task` (AC 38)
Proof: `node --test --test-name-pattern "the quick-start says doctor is not a setup check" tests/agent-readiness/beta-tester-docs.test.mjs`

**C46** - `.github/ISSUE_TEMPLATE/tester_bug_report.yml` requires exactly five fields - version JSON, OS and architecture, Node version, command run, `--output json` envelope - applies the `bug` label, and applies no `status:` label (AC 39)
Proof: `node --test --test-name-pattern "the tester bug form requires exactly the five fields" tests/agent-readiness/beta-tester-docs.test.mjs`

**C47** - `SUPPORT.md` lists `vestra --version --output json`, the failing command rerun with `--output json`, `vestra task status --output json` and `vestra doctor --output json` (AC 40)
Proof: `node --test --test-name-pattern "SUPPORT lists what to attach" tests/agent-readiness/beta-tester-docs.test.mjs`

**C48** - `CHANGELOG.md` has one section per ledger sequence 1-8 naming its version and, where the ledger records one, its `releaseId`, table-driven over the ledger (AC 41)
Proof: `node --test --test-name-pattern "the CHANGELOG has a section per published sequence" tests/agent-readiness/beta-tester-docs.test.mjs`

**C49** - The site capability matrix shows the platform matrix and release candidate (T75-T76) as `qualified`, the 1.0 decision as a signed hold, and a governed-task row as `experimental`, and the README status matrix states the same three (AC 42)
Proof: `node --test --test-name-pattern "the capability matrix shows T75-T77 done and the governed task experimental" apps/site/tests/unit/product-contract.test.mjs`
Proof: `node --test --test-name-pattern "the README status matrix agrees with the capability matrix" apps/site/tests/unit/repository-content.test.mjs`

**C50** - The site's install page links the quick-start section that delivers a governed task (AC 43)
Proof: `node --test --test-name-pattern "the install page links the governed-task quick-start" apps/site/tests/unit/documentation-contract.test.mjs`

### S9 - The open alerts close without moving product dependencies · 5 files + lockfile · 14 KB · ~3k

The lockfile is regenerated by pnpm and searched, never read whole, so its 338 KB is not in the estimate.

**C51** - `pnpm-lock.yaml` resolves none of `zod@3.25.76`, `postcss-selector-parser@6.1.5` and `katex@0.16.47` (AC 44)
Proof: `node --test --test-name-pattern "the lockfile resolves none of the three alerted site versions" tests/agent-readiness/dependency-policy.test.mjs`

**C52** - No manifest of `packages/*`, `apps/vestra-cli` or `apps/vestra-launcher` differs from `<base>`, and the frozen install still resolves (AC 45)
Proof: `git diff --exit-code <base> -- "packages/*/package.json" apps/vestra-cli/package.json apps/vestra-launcher/package.json`
Proof: `pnpm install --frozen-lockfile`

**C53** - `.github/dependabot.yml` ignores `@cedar-policy/cedar-wasm` minor and patch updates and `json-schema-to-typescript` major updates (AC 46)
Proof: `node --test --test-name-pattern "Dependabot ignores the exact-pinned cedar and json-schema-to-typescript updates" tests/agent-readiness/dependency-policy.test.mjs`

**C54** - `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` and the npm entry of `.github/dependabot.yml` sets `cooldown` `default-days: 3` (AC 47)
Proof: `node --test --test-name-pattern "new versions wait three days before install and before a Dependabot proposal" tests/agent-readiness/dependency-policy.test.mjs`
Proof: `pnpm install --frozen-lockfile`

### S10 - CI shows a platform regression without a dispatch · 3 files · 32 KB · ~8k

**C55** - `platform-matrix.yml` keeps `workflow_dispatch`, adds a daily `schedule`, and a scheduled run selects gate profile `full` against `main` (AC 48)
Proof: `node --test --test-name-pattern "the fleet runs nightly on main with the full gate" tests/agent-readiness/platform-matrix-workflow.test.mjs`

**C56** - When creating a directory symlink fails with `EPERM`, the MCP bridge fixture creates a junction at the same place to the same target (AC 49)
Proof: `node --test --test-name-pattern "a directory link falls back to a junction on EPERM" tests/integration/mcp-bridge-fixture.test.mjs`

**C57** - When creating a file symlink fails with `EPERM`, the fixture throws an error whose message names Windows Developer Mode (AC 50)
Proof: `node --test --test-name-pattern "a file link EPERM names Windows Developer Mode" tests/integration/mcp-bridge-fixture.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| `vestra --version` statuses (1) | exit 0 C17 · C18 · C19 | - |
| `vestra <command> --help` statuses (2) | exit 0 C8 · exit 2 C10 | - |
| launcher on an old Node statuses (1) | exit 64 C11 | - |
| launcher on a stalled source statuses (3) | HTTP 200 continues C14 · HTTP 206 continues C14 · exit 70 C15 | - |
| `scripts/t76-refresh-timestamp.mjs` statuses (1) | exit 1 with a `VES_T76_REFRESH_` code C33 · C34 | - |
| Landing doors (2) | door 1 `revision` key C18 · C19 · door 2 code and 30 000 ms bound C13 · C14 | - |
| installed commands answering `--help` (13) | C8, table-driven over all 13 | - |
| Node version edges (6) | `20.0.0` C11 · `22.12.0` C11 · `24.13.9` C11 · `24.14.0` C11 · `24.15.1` C11 · `25.0.0` C11 | - |
| stalled read kinds (2) | metadata C13 · target range C13 | - |
| gate-allowlist commands (2) | `task plan` C3 · `task start` C4 | - |
| drivers listing accepted models (2) | `codex` C5 · `claude-code` C5 | - |
| internal-failure causes (2) | with a `VES_` code C6 · without one C6 | - |
| child-process start sites of git or taskkill (7 places) | workspace scanner C20 · safe init C20 · task-path `runGit` C20 · task-path `runGitBytes` C20 · doctor git probe C20 · self-test Git fixtures C20 · process-tree terminator C20, C22 | - |
| Git-metadata aliases (7) | `.git.` C23, C24 · `.git..` C23 · `src/.git.` C23, C24 · `.GIT.` C23 · `.github` C23 · `git.` C23 · `.gitignore` C23 | - |
| protected-path aliases (2) | `config.json.` C26 · `secrets./key` C26 | - |
| alias refusal surfaces (2) | worktree write C24, C26 · bridge read C25 | - |
| task-request schemas (2) | v1 C27 · v2 C27 | - |
| git phases with hooks (3) | worktree create C28 · gate commit C28 · worktree remove C28 | - |
| hook kinds (3) | post-checkout C28 · post-commit C28 · reference-transaction C28 | - |
| live timestamp relation (2) | equal C33 · below C33 | - |
| live timestamp read failures (3) | connection refused C34 · HTTP 404 C34 · unparsable JSON C34 | - |
| expiry rules (2) | component expired C30 · earliest expiry C31 | - |
| not-a-sandbox documents (2) | `docs/quick-start.md` C35 · `SECURITY.md` C35 | - |
| #569 limits by document (9) | C36, table-driven over all 9: 3 limits by 3 documents | - |
| beta labels (5) | `init` C38 · `self-test` C38 · `doctor` C38 · `secret` C38 · `task` C38 | - |
| pinned-install documents (4) | README C39 · quick-start C39 · launcher README C39 · site install page C39 | - |
| state directories (4) | macOS C40 · Linux with `XDG_STATE_HOME` C40 · Linux without it C40 · Windows C40 | - |
| Codex login hint platforms (3) | win32 C43 · darwin C43 · linux C43 | - |
| bug form fields (5) | version JSON C46 · OS and architecture C46 · Node version C46 · command C46 · envelope C46 | - |
| attach commands (4) | `--version` C47 · failing command C47 · `task status` C47 · `doctor` C47 | - |
| ledger sequences (8) | C48, table-driven over all 8 ledger sequences | - |
| capability rows (3) | T75-T76 qualified C49 · 1.0 signed hold C49 · governed task experimental C49 | - |
| alerted versions (3) | `zod@3.25.76` C51 · `postcss-selector-parser@6.1.5` C51 · `katex@0.16.47` C51 | - |
| Dependabot ignore entries (2) | `@cedar-policy/cedar-wasm` C53 · `json-schema-to-typescript` C53 | - |
| release-age settings (2) | pnpm `minimumReleaseAge` C54 · Dependabot `cooldown` C54 | - |
| symlink kinds on `EPERM` (2) | directory C56 · file C57 | - |
| startup config: revision identity (2 assemblies) | sealed build C17, C18 · source run C19 | - |

- Claims naming an exit code or a refusal code cross the boundary that produces it: C1, C3, C4, C6,
  C8, C10, C11, C15, C24, C25, C26, C33, C34 run the CLI, the launcher, the tool, the bridge or the
  script, not a helper behind them
- C12 and C20 are structural proofs over source; C11, C21 and C22 prove the behaviour behind them
- No other check claims more than the cases its proof exercises

## Test policy

`tests/AGENTS.md` answers both questions for every layer this change touches: the level by kind
(`unit` for pure behaviour, `contract` for interfaces, `integration` for component boundaries,
`e2e` for journeys, `security` for authority and data controls) and the coverage ("a happy path
plus each specified edge or failure path"). The checks above follow it, so no extra rows apply.

Evidence:

- `packages/domain/src/primitives/task-path.ts`: comparison folding decides three predicates
  (`namesGitMetadata`, `isProtectedTaskPath`, `taskPathsOverlap`) -> decides; proven at its own
  layer (C23, C26) and across both boundaries that read it (C24, C25, C26)
- `apps/vestra-cli/src/cli.ts` error rendering: branches on JSON vs human, details vs none, public vs
  internal -> decides; proven at the CLI boundary (C1, C2, C6)
- closest analogue: the case-variant rule in the same file, already proven at unit level and
  end to end (`tests/e2e/task-path-case-variant-e2e.test.mjs`)

## Swept

- validation: C11, C23, C26, C27
- failure modes: C13, C16, C34
- idempotency: C33 - rerunning a refresh for a version already live refuses instead of signing it again
- authorization: C20, C28 - only the user's own git runs, and no repository-configured hook runs
- concurrency: C32, C33
- data lifecycle: n/a - this change creates, migrates and deletes no stored data
- dependency failure: C13, C15, C34
- state transitions: n/a - no state machine changes; a failed activation leaves the previous one in place (AD-036)
- observability: C1, C6, C17, C18

## Handoff

The estimate exceeds the budget, so the build waits for the mechanism.

- S1-S5 = 114k, in `apps/vestra-cli`, `apps/vestra-launcher`, `packages/distribution`, `packages/domain`, `packages/platform-node`, `packages/workspace` and `packages/self-test` (the product runtime); S6 enters the publication scripts and workflows at 152k, over the 150k budget -> proposed cut after S5
- S6-S10 = 100k, in publication, docs, site, dependency settings and CI
- The estimate counts `apps/vestra-cli/src/cli.ts` once per slice that touches it (S1, S2, S4), because each slice rereads it
- S9 edits `.github/dependabot.yml` and `tests/agent-readiness/dependency-policy.test.mjs`, which PR #588 also edits; S9 starts after #588 merges (merged 2026-10-24T14:11:39Z)
- Mechanism: one builder for all 10 slices, compaction accepted - the owner's choice on 2026-10-24
- `<base>`: `a5a9b105b5d92d5de652b54082aa3b5e30ecf01f` (`main` after #589 reverted #583's unqualified Cedar 4.14.0, which had failed the policy suites); the branch was rebased onto it

- **Boundary:** C1-C10 closed at `237a199` and `9e7a294`; C11-C16 at `32424b8`; C17-C19 at `545b2e3`; C20-C29 at `547f674`; C30-C34 at `9e3152d`; C35-C37 at `ffb6c29`; C38-C50 at `957fd08`; C51-C54 at `7381d9e`; C55-C57 at `37eaa7c`. `7550097` keeps the canonical-JSON census exact for S1 and S4.
- **Settled mid-build:** #583 (Cedar 4.14.0 as generated) turned `main` red; the owner chose to revert it (#589, `a5a9b10`), and Cedar 4.14 joined #563. SEC-001's premise did not reproduce on Node 24.14 (libuv 1.51): a bare `git` does not reach the working directory by itself, but with a relative PATH entry (`.`) it ran a planted `git.exe` (reproduced), which C21 covers; its severity is P1, not P0. The versioned-hooks run (SEC-003) reproduced through the adapters before the fix. `task start` reaches the gate allowlist only after a credential read no fixture may do, so C4 proves the shared loader plus the call site's stderr argument. C25's bridge-level test runs on POSIX hosts (Windows takes its mediation path); a unit test covers the same alias on every host. Tests that pinned what the approved plan changes now pin the new behaviour with the same guarantee: the `sync --help` row of the argument-error table, the git argument vector, the bare `"git"`/`"taskkill"` spellings in four architecture and security tests, the bin's static import, the version JSON, and two Codex identity tests that assumed a POSIX shell on every host. C39 reads concrete versions only (the launcher README's `verchestra@<earlier version>` is a placeholder); C48 requires at least the eight sequences, so a ninth publication must add its section. The quick-start's `.7` pin moved to `.8`. S6 was committed before S5.
- **Abandoned:** none
- **Boundary (verification rounds):** round 1 FAILED at `8f0096f` (52/57; the C4 mutant survived); `73f8d8c` reads the gate allowlist with the run's own settings so C4 runs `task start` itself, and `970d46f` closes C25, C33, C34, C47 and criterion 50 in `git-context-source`. Round 2 FAILED at `970d46f` (57/57, one criterion-50 member); `85e6c1b` routes the last direct links through `tests/helpers/windows-links.mjs` and adds the alias to the named-pipe refusal table. Round 3 PASSED at `85e6c1b`: 57/57, every coverage member proven, every injected fault killed (`verification.md`).
- **Settled in verification:** `task start` and `task resume` now read the gate allowlist before the Windows prerequisites and any credential (SSI-73 already orders the run's own settings first); the task command fixture models a configured Workspace. Lessons L-014 to L-018 record the gaps.
