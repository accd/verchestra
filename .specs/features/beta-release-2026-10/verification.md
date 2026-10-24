# Beta release 2026-10 verification

**Verdict**: PASS
**Profile**: standard
**Diff range**: a5a9b105b5d92d5de652b54082aa3b5e30ecf01f..85e6c1b895518784ecbbce5fd8e3569f84a0093a
**Round**: 3 - scoped
**Verifier**: independent sub-agent (author != verifier)

Round 3 re-verifies one fix commit, `85e6c1b` (fix diff `970d46f..85e6c1b`). The commit touches
three test files:

- `tests/security/worktree-tool-security.test.mjs`: its file link and directory link now go through `tests/helpers/windows-links.mjs`.
- `tests/e2e/task-cli-e2e.test.mjs`: the state-root escape test now uses `linkDirectory`.
- `tests/security/windows-pipe-bridge-security.test.mjs`: the named-pipe refusal table gains `.git./config` and `.git.`.

Following `verify.md`, all 57 proofs re-ran in full at `85e6c1b`. Re-judged here:

- the criterion-50 coverage row and its Test policy verdict;
- C25 with the new pipe rows;
- C24 and C26, whose proof file the fix touched.

Faults were re-injected on every surface the fix touched. Everything else carries from `970d46f`
(round 2) or `8f0096f` (round 1) and says so.

Host: Windows 11, Node 24.14.0, no Windows Developer Mode. Two host limitations:

- Symbolic links fail with `EPERM`.
- The OS temporary directory is inside the user's home directory.

Result: 57 of 57 checks proven. Every coverage member has a proof. Every Test policy row is met.
Every fault in rounds 2 and 3 was killed. Round 1's surviving F5 was re-injected unchanged in round
2 and was killed.

Proof invocations, verified at 85e6c1b:

- **B1**: the same batched command as rounds 1 and 2, against the same 56 names and 27 files. Exit 0: `# tests 56`, `# pass 56`, `# fail 0`, `# skipped 0`. The `ok N` lines are identical to round 2 (`diff` empty). Before the run, a search found every name exactly once in the tree.
- **B2**: the 3 site names. Exit 0, 3 of 3 `ok`.
- **G1**: `git diff --exit-code a5a9b10 -- schemas/task-request/1.schema.json schemas/task-request/2.schema.json`, exit 0.
- **G2**: `git diff --exit-code a5a9b10 -- "packages/*/package.json" apps/vestra-cli/package.json apps/vestra-launcher/package.json`, exit 0.
- **I1**: `corepack pnpm install --frozen-lockfile`, exit 0.

## Binding sources

Carried from 8f0096f. No binding source: this is profile `standard`, so step 1 runs only under
`ui`, and `plan.md` marks no source as binding.

## Checks

Each row says where its verdict comes from. Every proof re-ran green at 85e6c1b (B1, B2, G1, G2,
I1). A "carried" row is one whose proof file and product code the 85e6c1b diff does not touch, so
its citation is unchanged.

| Check | Claim | Proof run | Evidence | Result |
| --- | --- | --- | --- | --- |
| C1 | human refusal line carries safe details in key order | B1 `ok 26` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:448` - `assert.deepEqual(result.streams.stderr, ["VES_TEST_DETAILED (alpha=gate-allowlist, count=2, zeta=z): Provision it and retry.\n"])` | PASS |
| C2 | JSON envelope unchanged | B1 `ok 27` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:459` - `assert.deepEqual(JSON.parse(result.streams.stdout[0]).error, JSON.parse(JSON.stringify(envelope)))` | PASS |
| C3 | `task plan` explains the missing allowlist, then refuses | B1 `ok 49` (carried from 970d46f) | `tests/unit/task-cli-composition.test.mjs:203` removes the allowlist; `:205` runs `planTask`; `:191` code `VES_TASK_NOT_CONFIGURED`; `:192` `{ requirement: "gate-allowlist" }`; `:194` the path; `:196-197` the template | PASS |
| C4 | `task start` writes the same path and template before the same refusal | B1 `ok 50` (carried from 970d46f) | `tests/unit/task-cli-composition.test.mjs:219` runs `runTask` on an `EXECUTION_AUTHORIZED` run, with the assertions at `:191-197`; `:221` the state is unchanged. Product: `apps/vestra-cli/src/task/task-run.ts:278`. R2-F1 is killed. | PASS |
| C5 | unpriced-model refusal lists accepted models | B1 `ok 51` (carried from 970d46f) | `tests/unit/task-cli-composition.test.mjs:229-230` code and reason; `:234` `gpt-5.5`; `:236` priced `claude-` models | PASS |
| C6 | internal failure names its VES cause | B1 `ok 28` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:466-469,471,473-478,483-486` | PASS |
| C7 | no repository-relative `docs/` path in recoveries | B1 `ok 29` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:510,512`; all 12 registries | PASS |
| C8 | per-command `--help`, 13 commands, exit 0 | B1 `ok 30` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:536,539,543,544-548` | PASS |
| C9 | `--help --output json` data | B1 `ok 31` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:556,558-565` | PASS |
| C10 | uninstalled command `--help` exit 2 | B1 `ok 32` (carried from 8f0096f) | `tests/contract/cli-surface.test.mjs:571,573` | PASS |
| C11 | Node guard edges, exit 64 | B1 `ok 56` (carried from 8f0096f) | `tests/unit/vestra-launcher-host-selection.test.mjs:111,114-116,120-122` | PASS |
| C12 | bin checks Node before importing bootstrap | B1 `ok 25` (carried from 8f0096f) | `tests/build/vestra-launcher-package.test.mjs:188,191` | PASS |
| C13 | stalled reads fail `VES_TUF_SOURCE_TIMEOUT` | B1 `ok 35` (carried from 8f0096f) | `tests/e2e/tuf-source-adapters.test.mjs:283-288` | PASS |
| C14 | 30 000 ms default; 200 and 206 succeed | B1 `ok 36` (carried from 8f0096f) | `tests/e2e/tuf-source-adapters.test.mjs:310-316` (`bounds` deepEqual `[30_000, 30_000]` at `:314`) | PASS |
| C15 | timeout in the launcher line, exit 70 | B1 `ok 55` (carried from 8f0096f) | `tests/unit/vestra-launcher-bootstrap.test.mjs:148-150` | PASS |
| C16 | unbounded metadata body fails before it ends | B1 `ok 37` (carried from 8f0096f) | `tests/e2e/tuf-source-adapters.test.mjs:331-332` | PASS |
| C17 | sealed `--version` names revision | B1 `ok 19` (carried from 8f0096f) | `tests/build/sealed-launcher-closure.test.mjs:616-617` | PASS |
| C18 | sealed version JSON revision | B1 `ok 20` (carried from 8f0096f) | `tests/build/sealed-launcher-closure.test.mjs:626-627` | PASS |
| C19 | source build revision null | B1 `ok 33` (carried from 8f0096f) | `tests/e2e/cli-launchers-e2e.test.mjs:161,170` | PASS |
| C20 | no bare git or taskkill start | B1 `ok 17` (carried from 8f0096f) | `tests/architecture/absolute-child-executables.test.mjs:61` | PASS |
| C21 | git resolver takes only absolute PATH entries | B1 `ok 48` (carried from 8f0096f) | `tests/unit/git-executable.test.mjs:32-34` | PASS |
| C22 | taskkill under SystemRoot | B1 `ok 42` (carried from 8f0096f) | `tests/integration/process-tree-terminator.test.mjs:80` | PASS |
| C23 | `namesGitMetadata` trailing-dot aliases | B1 `ok 53` (carried from 8f0096f) | `tests/unit/task-path.test.mjs:265,267` | PASS |
| C24 | worktree tool refuses `.git.` aliases, worktree unchanged | B1 `ok 46` (verified at 85e6c1b, citation refreshed) | `tests/security/worktree-tool-security.test.mjs:149-153` `adapter.invoke` rejects `{ code: "VES_TOOL_PROTECTED_PATH" }` (`:151`) for `.git.` and `src/.git./config`; `:155` `git status --porcelain --ignored` equals `""` | PASS |
| C25 | MCP bridge refuses read of `.git./config` | B1 `ok 45`; test:security `win32: the read tools refuse over the named pipe ...` passing (verified at 85e6c1b) | `tests/security/mcp-tool-bridge-security.test.mjs:159` - `assert.rejects(view.readFile(path), { code: "VES_BRIDGE_PATH_PROTECTED" }, path)` on every host. The new rows run the bridge round trip over the Windows named pipe on this host: `tests/security/windows-pipe-bridge-security.test.mjs:459-460` (`read_file` `.git./config` and `.git.`, expecting `VES_BRIDGE_PATH_PROTECTED`), asserted at `:480`. That is `assert.equal(text(result), "denied: " + code, label)`, with `:478` `isError` true. R3-F3 is killed. | PASS |
| C26 | trailing-dot alias of a protected path is protected and refused | B1 `ok 54`, `ok 47` (verified at 85e6c1b, citation refreshed) | `tests/unit/task-path.test.mjs:271-272`; `tests/security/worktree-tool-security.test.mjs:162-166` rejects `{ code: "VES_TOOL_PROTECTED_PATH" }` (`:165`); `:169` the worktree is unchanged | PASS |
| C27 | grammar equals schema patterns; schemas byte-identical | B1 `ok 52`; G1 exit 0 (re-run at 85e6c1b) | `tests/unit/task-path.test.mjs:216,219` | PASS |
| C28 | versioned hooks run on no create, commit or remove | B1 `ok 44`, `ok 39` (carried from 8f0096f) | `tests/integration/task-worktree-git.test.mjs:88,102`; `tests/integration/gate-commit-adapters.test.mjs:302` | PASS |
| C29 | git argv carries hooks-off and fsmonitor-off | B1 `ok 43` (carried from 8f0096f) | `tests/integration/task-worktree-git-environment.test.mjs:282-283` | PASS |
| C30 | refresh refuses an expired component | B1 `ok 23` (carried from 8f0096f) | `tests/build/tuf-publication.test.mjs:282-285` | PASS |
| C31 | timestamp expires no later than earliest component | B1 `ok 24` (carried from 8f0096f) | `tests/build/tuf-publication.test.mjs:298-299,303-307` | PASS |
| C32 | publish and refresh share a non-cancelling concurrency group | B1 `ok 16` (carried from 8f0096f) | `tests/agent-readiness/t76-refresh-workflow.test.mjs:232-234` | PASS |
| C33 | refresh at or below the live version: exit 1, code, before signing | B1 `ok 21` (carried from 970d46f) | `tests/build/t76-timestamp-refresh.test.mjs:642-647` function (code `:173`, no output `:179`); `:648-657` script process: `:655` exitCode equals 1; `:656` stderr has `VES_T76_REFRESH_LIVE_VERSION_COLLISION`; `:657` no output directory | PASS |
| C34 | unreadable live timestamp: exit 1, code, before signing | B1 `ok 22` (carried from 970d46f) | `tests/build/t76-timestamp-refresh.test.mjs:669-670` function; `:671-674` script process, exit 1 plus `VES_T76_REFRESH_LIVE_UNREADABLE` plus no output | PASS |
| C35 | not-a-sandbox statements | B1 `ok 1` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:25,27` | PASS |
| C36 | #569 limits, 3 by 3 | B1 `ok 2` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:53,56,58` | PASS |
| C37 | extension-host composition rule | B1 `ok 18` (carried from 8f0096f) | `tests/architecture/extension-host-composition.test.mjs:72,83-87` | PASS |
| C38 | README Beta testers section | B1 `ok 3` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:75,83-89` | PASS |
| C39 | pinned npx commands | B1 `ok 4` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:106,109` | PASS |
| C40 | state directory per OS | B1 `ok 5` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:128-136` | PASS |
| C41 | v1 example validates | B1 `ok 34` (carried from 8f0096f) | `tests/e2e/task-request-examples-e2e.test.mjs:97-98` | PASS |
| C42 | PowerShell forms | B1 `ok 6` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:147-155` | PASS |
| C43 | Codex login hint per platform | B1 `ok 38` (carried from 8f0096f) | `tests/integration/codex-identity.test.mjs:321-330` | PASS |
| C44 | Node floor stated | B1 `ok 7` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:161-162` | PASS |
| C45 | doctor is not a setup check | B1 `ok 8` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:169-170` | PASS |
| C46 | tester bug form | B1 `ok 9` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:177-180` | PASS |
| C47 | SUPPORT lists the 4 attach items | B1 `ok 10` (carried from 970d46f) | `tests/agent-readiness/beta-tester-docs.test.mjs:188-194`, with the failing-command member as the full line at `:190` (`SUPPORT.md:24`) | PASS |
| C48 | CHANGELOG per ledger sequence | B1 `ok 11` (carried from 8f0096f) | `tests/agent-readiness/beta-tester-docs.test.mjs:199,202,206` | PASS |
| C49 | capability and README matrices | B2 `ok 2`, `ok 3` (carried from 8f0096f) | `apps/site/tests/unit/product-contract.test.mjs:104-107`; `apps/site/tests/unit/repository-content.test.mjs:208-209` | PASS |
| C50 | install page links the quick-start | B2 `ok 1` (carried from 8f0096f) | `apps/site/tests/unit/documentation-contract.test.mjs:86-87` | PASS |
| C51 | no alerted version in the lockfile | B1 `ok 12` (carried from 8f0096f) | `tests/agent-readiness/dependency-policy.test.mjs:136` | PASS |
| C52 | no product manifest moved; frozen install resolves | G2 and I1 exit 0 (re-run at 85e6c1b) | no manifest or lockfile in either fix diff; the round-1 lockfile recompute stands (0 of 178 moved) | PASS |
| C53 | Dependabot ignores | B1 `ok 13` (carried from 8f0096f) | `tests/agent-readiness/dependency-policy.test.mjs:144-151` | PASS |
| C54 | release-age settings | B1 `ok 14`; I1 (carried from 8f0096f) | `tests/agent-readiness/dependency-policy.test.mjs:155,161` | PASS |
| C55 | fleet nightly on main, full gate | B1 `ok 15` (carried from 8f0096f) | `tests/agent-readiness/platform-matrix-workflow.test.mjs:193-198` | PASS |
| C56 | directory link falls back to a junction on EPERM | B1 `ok 40` (carried from 970d46f) | `tests/integration/mcp-bridge-fixture.test.mjs:17-20,22-27`, exercising `tests/helpers/windows-links.mjs:9-16`. R3-F2 kills it again. | PASS |
| C57 | file link EPERM names Windows Developer Mode | B1 `ok 41` (carried from 970d46f) | `tests/integration/mcp-bridge-fixture.test.mjs:36-37`, exercising `tests/helpers/windows-links.mjs:18-28` | PASS |

## Coverage

Rows whose authority the 85e6c1b diff touched are verified at 85e6c1b. All other rows carry from
the round that last recomputed them.

| Set (size) | Recomputed from | Member -> proof | Unproven |
| --- | --- | --- | --- |
| tests failing on a Windows file-symlink EPERM: criterion 50, "each affected test" (23 file-link members on this host), verified at 85e6c1b | each scope run on this host without Developer Mode at 85e6c1b. test:integration: 1274 tests, 1251 pass, 23 fail. test:security: 1363 tests, 1361 pass, 2 fail. test:e2e: 316 of 316 pass. test:fault: 310 of 310 pass. | Integration: 22 failures, 17 in `driver-execution-adapter.test.mjs` and 5 in `git-context-source.test.mjs` (`:61`, `:81`, `:99`, `:111`, `:123`). Each ends with "creating a file symbolic link was refused (EPERM): turn on Windows Developer Mode, ...". Security: `tests/security/worktree-tool-security.test.mjs:42` fails with the same message (its link at `:45` uses `linkFile`). The remaining failures are not members: the 23rd integration failure is a load timing flake (see Gate); `task-suspension-security.test.mjs:39` is the temp-directory host limitation. The directory-link tests no longer fail: `worktree-tool-security.test.mjs:32` (`linkDirectory` at `:35`) and `tests/e2e/task-cli-e2e.test.mjs:889` (`linkDirectory` at `:897`) pass through a junction. | - |
| alias refusal surfaces (2), verified at 85e6c1b | criterion 18 | worktree write: C24, C26 (`worktree-tool-security.test.mjs:149-155,162-169`). Bridge read: the view on every host (`mcp-tool-bridge-security.test.mjs:159`) and the full `read_file` round trip over the Windows pipe on this host (`windows-pipe-bridge-security.test.mjs:459-460`, asserted at `:480`; R3-F3 killed) | - |
| Git-metadata aliases (7), verified at 85e6c1b | criterion 18 | all 7 at unit level (C23); `.git.` and `src/.git./config` at the tool (C24); `.git.` and `.git./config` at the bridge view and over the pipe (C25) | - |
| symlink kinds on EPERM in the shared link helper (2), carried from 970d46f | `tests/helpers/windows-links.mjs` | directory: C56; file: C57 | - |
| refresh script statuses (1), carried from 970d46f | plan Surface | exit 1 with the code on the script process: C33 `:655-656`, C34 `:672-673` | - |
| live timestamp relation (2), carried from 970d46f | criterion 26 | equal and below: C33 | - |
| live timestamp read failures (3), carried from 970d46f | criterion 27 | C34 | - |
| gate-allowlist commands (2), carried from 970d46f | `task-plan.ts:308`, `task-run.ts:278` | `task plan` C3; `task start` C4 | - |
| attach commands (4), carried from 970d46f | criterion 40 | C47 | - |
| `vestra --version` statuses (1), carried from 8f0096f | plan Surface | exit 0: C17, C18, C19 | - |
| `<command> --help` statuses (2), carried from 8f0096f | plan Surface | exit 0 C8; exit 2 C10 | - |
| `<command> --help` output modes (2), carried from 8f0096f | plan Surface | C8, C9 | - |
| launcher on old Node statuses (1), carried from 8f0096f | plan Surface | exit 64 C11 | - |
| launcher on stalled source statuses (3), carried from 8f0096f | plan Surface | 200 and 206 C14; exit 70 C15 | - |
| Landing doors (2), carried from 8f0096f | plan Landing | door 1 C17, C18, C19; door 2 C13, C14, plus `node-activation-closure.ts:142-147` | - |
| installed commands answering `--help` (13), carried from 8f0096f | `release-manifest.ts` | C8, C9 | - |
| Node version edges (6), carried from 8f0096f | criterion 10 | C11 | - |
| stalled read kinds (2), carried from 8f0096f | `tuf-update-client.ts:559,582` | C13 | - |
| drivers listing accepted models (2), carried from 8f0096f | `task-plan.ts` | C5 | - |
| internal-failure causes (2), carried from 8f0096f | `cli.ts` | C6 | - |
| public error registries (12), carried from 8f0096f | the code | C7 | - |
| git and taskkill start sites (7), carried from 8f0096f | code search (round 1) | C20, C21, C22 | - |
| protected-path aliases (2), carried from 8f0096f | criterion 19 | C26 | - |
| task-request schemas (2), carried from 8f0096f | `schemas/task-request/` | C27 (G1 re-run) | - |
| git phases with hooks (3), carried from 8f0096f | criterion 21 | C28 | - |
| hook kinds (3), carried from 8f0096f | fixture | C28 | - |
| expiry rules (2), carried from 8f0096f | `tuf-publication.ts:809,825` | C30, C31 | - |
| not-a-sandbox documents (2), carried from 8f0096f | criterion 28 | C35 | - |
| #569 limits by document (9), carried from 8f0096f | criterion 29 | C36 | - |
| beta labels (5), carried from 8f0096f | criterion 31 | C38 | - |
| pinned-install documents (4), carried from 8f0096f | grep of the 4 files | C39 | - |
| state directories (4), carried from 8f0096f | `resolveStateRoot` | C40 | - |
| Codex login hint platforms (3), carried from 8f0096f | `task-codex-identity.ts` | C43 | - |
| bug form fields (5), carried from 8f0096f | criterion 39 | C46 | - |
| ledger sequences (8), carried from 8f0096f | ledger | C48 | - |
| capability rows (3), carried from 8f0096f | criterion 42 | C49 | - |
| alerted versions (3), carried from 8f0096f | criterion 44 | C51 | - |
| product dependency versions (16 package manifests, 2 app manifests), carried from 8f0096f; G2 and I1 re-run | G2 plus the lockfile recompute (0 of 178 moved) | C52 | - |
| Dependabot ignore entries (2), carried from 8f0096f | criterion 46 | C53 | - |
| release-age settings (2), carried from 8f0096f | criterion 47 | C54 | - |
| startup config: revision identity (2 assemblies), carried from 8f0096f | `t76-build-candidate.mjs:520,383`; `release-manifest.ts:43,50` | C17, C18; C19 | - |

## Test policy rows

checks.md defers to `tests/AGENTS.md`. The row that was unmet in round 2 is re-judged at 85e6c1b.

| Row | Files it classifies | Required proof | Expectation met |
| --- | --- | --- | --- |
| Coverage: a happy path plus each specified edge or failure path (verified at 85e6c1b) | `SUPPORT.md`, every test that creates a file symbolic link (criterion 50) | each listed member asserted; each affected test names Developer Mode | yes - all 23 file-link failures on this host name Windows Developer Mode, and C47 asserts all 4 members |
| `task-path.ts` folding: own layer plus both boundaries (verified at 85e6c1b) | `task-path.ts`, `mcp-bridge-tools.ts`, `worktree-tool-adapter.ts` | C23, C26; C24, C26; C25 | yes - the bridge read is now also asserted over the Windows pipe |
| `cli.ts` error rendering at the CLI boundary (carried from 8f0096f) | `apps/vestra-cli/src/cli.ts` | C1, C2, C6 | yes |
| Level by kind: proven at the boundary that produces the status or refusal (carried from 970d46f) | `task-run.ts`, `scripts/t76-refresh-timestamp.mjs` | `runTask`; the script process | yes |
| Temporary-directory hygiene (verified at 85e6c1b) | every scope run through `scripts/test-scope.mjs` | an empty private temporary directory at the end | yes - every scope ended with its private temporary directory empty |

## Faults injected

Verified at 85e6c1b, in a fresh scratch `git worktree add --detach <scratchpad>/wt3 85e6c1b` after
`corepack pnpm install --frozen-lockfile --offline` (exit 0). The baseline of the 5 target tests
in the scratch was as expected on this host:

- 4 `ok`: the state-root escape test, C56, the pipe refusal table, and the directory-link test.
- The file-link test failed with "creating a file symbolic link was refused (EPERM): turn on Windows Developer Mode, ...", which is the outcome criterion 50 requires on this host.

Each fault was reverted with `git checkout -- <file>` in the scratch. The worktree and its leftover
directory were removed. The real tree's porcelain before and after was the same single line,
`?? .specs/features/beta-release-2026-10/verification.md` (`cmp` equal). No stash was used.

| Mutation | Location | Proof run | Killed |
| --- | --- | --- | --- |
| R3-F1: the worktree-tool file link calls `symlink` directly again | `tests/security/worktree-tool-security.test.mjs:45` | the criterion-50 sensor, a run of the test at `:42`. Baseline failure: the Developer Mode message. Under the mutation: a bare `EPERM: operation not permitted, symlink ...`, so a regression of the member is visible. | yes |
| R3-F2: `linkDirectory` loses its junction fallback (EPERM rethrown) | `tests/helpers/windows-links.mjs:13` | C56 `not ok` (`mcp-bridge-fixture.test.mjs:17-20`); the directory-link test `worktree-tool-security.test.mjs:32` and the e2e test `task-cli-e2e.test.mjs:889` turn from `ok` into a bare EPERM | yes |
| R3-F3: trailing-dot folding removed (identity map) | `packages/domain/src/primitives/task-path.ts:49` | the pipe refusal table `windows-pipe-bridge-security.test.mjs:449`: `read_file {"path":".git./config"}` expected `denied: VES_BRIDGE_PATH_PROTECTED`, actual `denied: VES_BRIDGE_SCOPE_DENIED` (`:480`) | yes |
| R2-F1 to R2-F5 (carried from 970d46f): `task start` swallows the refusal (C4); the script exits 0 (C33, C34); folding removed at the view (C25); the SUPPORT line cut (C47); file-link EPERM bare (C57) | `task-run.ts:278`, `t76-refresh-timestamp.mjs:499`, `task-path.ts:49`, `SUPPORT.md:24`, `windows-links.mjs:22` | each proof `not ok` at 970d46f; the 85e6c1b diff touches none of these lines or proofs | yes |
| Round-1 F1 to F4 (carried from 8f0096f): folding strips one dot (C23); hooks setting removed (C28, C29); live comparison `>=` to `>` (C33); earliest-expiry choice removed (C31) | `task-path.ts:43`, `task-worktree.ts:169`, `t76-refresh-timestamp.mjs:163`, `tuf-publication.ts:825` | each proof `not ok` at 8f0096f; untouched since | yes |
| Round-1 F5 (`task start` swallows the refusal), superseded | `task-run.ts` | it survived against the round-1 proof at 8f0096f. The same mutation, re-injected at 970d46f as R2-F1, is killed by the rewritten C4 proof. | yes - as R2-F1 |

## Gate

Verified at 85e6c1b:

- B1 - 56 passed, 0 failed, 0 skipped. B2 - 3 passed, 0 failed. G1, G2 and I1 each exit 0.
- `corepack pnpm gate:quick` - PASS: format, lint, complexity and typecheck pass. `test:unit` 3024 passed, 0 failed; `test:agent-readiness` 373 passed, 0 failed; `test:census` 13 passed, 0 failed.
- `corepack pnpm test:integration` - 1274 tests, 1251 passed, 23 failed:
  - 22 are the criterion-50 file-link members, each naming Windows Developer Mode.
  - 1 is `tests/integration/windows-pipe-transport-relay.test.mjs:124`, a 10 s connection timing assertion. It ran while my scratch worktree install and fault runs loaded the machine. Re-run alone, it passes (`ok 1`, `# fail 0`). Neither the test nor `packages/platform-node/src/windows-pipe-transport.ts` is touched by the feature (`git diff --quiet a5a9b10 85e6c1b`).
- `corepack pnpm test:security` - 1363 tests, 1361 passed, 2 failed:
  - `worktree-tool-security.test.mjs:42` - the Developer Mode message, a criterion-50 member.
  - `task-suspension-security.test.mjs:39` - host limitation: the temp directory is inside home. The feature does not touch it (checked in round 2).
- `corepack pnpm test:e2e` - 316 passed, 0 failed.
- `corepack pnpm test:fault` - 310 passed, 0 failed.
- No scope reported temporary-directory leftovers. The real tree's porcelain is unchanged: only the untracked `verification.md`.

## Ranked gaps

None.

Notes, not counted as gaps:

- Carried from 8f0096f: C16's `pulls < 64` bound is loose (`tests/e2e/tuf-source-adapters.test.mjs:332`). C52's proof is manifest-level; the lockfile recompute found 0 of 178 product entries moved. C39 is vacuous for the launcher README and the site install page, which hold no concrete pin.
- Carried from 8f0096f: the lockfile regeneration moved `ws` 8.21.3 to 8.22.0 in the root importer's `@earendil-works/pi-agent-core` and `pi-ai` peer set. `packages/drivers/src/pi-driver.ts:18,67` loads that driver runtime dynamically. This is outside criterion 45 as written, but worth an owner look under the driver-runtime (DSB-05) rule.
- `tests/integration/windows-pipe-transport-relay.test.mjs:124` is sensitive to machine load: 10 s, under parallel scratch-worktree activity. It is pre-existing and outside this feature.
