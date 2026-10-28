# Probe host composition, slice 1 verification

**Verdict**: PASS
**Profile**: light
**Diff range**: d069bf9291efaeeafbdc9dcea189fb56b8eafb0f..f60417de63f62adedf7b2b4f481e23bbf1edc8d6. The feature's own commits are `2a3dec38..f60417de`, rebased onto main `2a3dec38` on branch `feat/235-extension-commands-r3` (PR #681)
**Round**: 4 - scoped (a re-verification of the second rebase; rounds 1-3 are kept below as history)
**Verifier**: independent sub-agent (author != verifier), the same Verifier as rounds 1-3. The builder was the sub-agent "Build probe host slice 1"; the orchestrator made the round-2 fix, both rebases and the format commit `f60417de`. This Verifier wrote none of the code, tests, plan or commits.

The second rebase keeps both sides. Main's three S3776 commits (`1cbe42d0`, `1583bc41`, `2a3dec38`) pulled the per-skill loop of `#validateLock` out into helpers. Door 6's required-skill rule still sits after those per-skill asserts and before the digest check. The feature's change to the registry is line-for-line the same diff it was on the old base. `f60417de` only reflows one signature in `cli.ts`. At `f60417de`, all 34 checks pass on Linux and on Windows. On Linux, so do the registry suite, cli-argument-parsing, cli-surface, cli-launchers and sealed-launcher-closure, the full `test:e2e` and `test:build`, `typecheck`, `format:check` and `complexity:check`. Nothing is open.

## Round 4 scope

**Rebase integrity.** I checked it with a script that partitions the changed files, run against the repository's git objects:

| Group | Files | At `f60417de` |
| --- | --- | --- |
| Changed by main since the old base (`7b4d1085..2a3dec38`) | 41 | - |
| Changed by the feature on the old base (`7b4d1085..37fc2666`) | 45 | - |
| Changed by the feature on the new base (`2a3dec38..f60417de`) | 45, the same list | - |
| Main-only (in main's set, not the feature's) | 39 | byte-identical to `2a3dec38` |
| Feature-only (in the feature's set, not main's) | 43 | byte-identical to `37fc2666`, except `apps/vestra-cli/src/cli.ts` |
| Touched by both | `packages/agent-runtime/src/skills/governed-skill-registry.ts`, `complexity-baseline.json` | read below |
| Changed between `37fc2666` and `f60417de` but in neither set | 0 | - |

- **`apps/vestra-cli/src/cli.ts`.** The only change since `37fc2666` is `f60417de`, which joins the `findCommandManifest` signature onto one line (`apps/vestra-cli/src/cli.ts:223`; +1/-4). With all whitespace removed, both versions hash to the same sha256 (`3f4b7ccab0e9…`), so the tokens are identical. Round 3's parser review and its 982,037-input differential therefore still hold. Line numbers after :223 have moved up by 3: `parseCommandOptions` is now at :232, and the `assignOption` call at :243.
- **Unchanged since round 2:** `checks.md` and every file cited as check evidence (E, L, A, K, G, R).
- **The report.** The committed copy at `f60417de` is still the round-2 report. The working tree held my round-3 report, uncommitted and byte-identical to what I wrote.

**Re-run in full at `f60417de`.**
- Every C1-C34 proof on Linux and on Windows. The brief asked only for C33 and C34 on Windows; I ran the other 34 there too, as verify.md requires proofs to be re-run in full at a new HEAD.
- The registry suite on both platforms.
- On Linux: cli-argument-parsing, cli-surface, cli-launchers-e2e, sealed-launcher-closure, `test:e2e`, `test:build`, `typecheck`, `format:check` and `complexity:check`.

## Platforms (verified at f60417de)

| Platform | Host | Node | Tree |
| --- | --- | --- | --- |
| Linux | WSL 2 Ubuntu, `~/verchestra-569`. It was clean at `37fc2666`; I fetched `feat/235-extension-commands-r3` and checked out `f60417de` detached. `git status --short` is empty before and after | 24.14.0 | `pnpm install --frozen-lockfile`: done, and the tree stayed clean |
| Windows | Windows 11 Pro, `C:\My_AI_Projects\verchestra` on `feat/235-extension-commands-r3` at `f60417de`; untracked are `.claude/` and `.specs/features/database-registration/`, which appeared at 21:57 and which this Verifier did not create or read; this report is modified. The orchestrator ran `gate:quick` there at the same time; I did not | 24.14.0 | as checked out |
| macOS | not available on this host: no macOS column | - | - |

## Merged registry walk (packages/agent-runtime/src/skills/governed-skill-registry.ts at f60417de)

**Main's intent.** `1cbe42d0` extracted the per-skill loop body of `#validateLock` into four helpers, preserving behaviour:

| Helper | Line | What it does |
| --- | --- | --- |
| `assertLockEntryShape` | :345 | id, duplicate and version shape, then `assertLockEntrySource` |
| `assertLockEntrySource` | :357 | immutable commit, tree digest, array fields |
| `#assertSkillCompatible` | :330 | license, harness, schema, TLC version |
| `assertLockedContent` | :378 | content manifest, hidden executables, and `hasApprovedExtension` (:370) for executable content |

I compared them with the inlined code at the base and found them equivalent, statement for statement. The only rewritten condition is `hasApprovedExtension`, which is the De Morgan dual of the inlined `extensionRef === undefined || kind not in [tool, plugin] || approvalRef.length === 0`.

**Door 6 and C33/C34.** The merged walk is, in order:

1. the lock-level checks;
2. per skill: `assertLockEntryShape` (:314), `#assertSkillCompatible` (:315) and `assertLockedContent` for each content entry (:316);
3. the required-skill rule (:318-319, `[...required].some((id) => !ids.has(id))` throws `VES_SKILL_TLC_REQUIRED`);
4. the digest check (:320, `VES_SKILL_LOCK_TAMPERED`);
5. the lock signature (:322).

So the rule keeps the place door 6 and checks.md's "Abandoned" note require: after the per-skill checks and ahead of the digest. That ordering is what keeps the existing `lock rejects invalid missing TLC` case green unchanged. `resolve` passes `PROFILE_REQUIRED_SKILLS` (:176); `resolveExecutableExtension` (:237), `planUpdate` (:265-266) and `activate` (:287) pass `NO_REQUIRED_SKILLS`.

**The feature's delta is unchanged.** Its added and removed lines on the new base (`git diff 2a3dec38 f60417de`) equal those on the old base (`git diff 7b4d1085 37fc2666`) exactly. That covers the two constants, the `signature: unknown` widening, the five call sites, the `required` parameter and the rule.

**Tests.** The registry suite passes 24/24 on Linux and on Windows. It includes C33, C34 and every `lock rejects invalid …` case that exercises the extracted helpers: license, TLC version, harness version, skill schema, tree digest, duplicate, missing TLC.

**`complexity-baseline.json`.**
- **Main's entries are kept**, including `#validateLock` lowered from 40 to 14 and the removed `passport-registry.ts` entry.
- **The feature's delta is unchanged:** it removes `runCli` and sets `assertManifest` to 11, the same diff as on the old base. The key count goes from 135 at `2a3dec38` to 134.
- **`complexity:check` on Linux:** see Gate. It confirms that the merged `#validateLock`, with the rule's `some` call, is within its baseline of 14.

## Checks (proofs verified at f60417de; citations carried from ec219824, whose files are unchanged)

Each proof ran exactly as `checks.md` writes it, once per proof per platform. Every one of the 36 invocations, on each platform, exited 0 with `tests 1 / pass 1 / fail 0 / skipped 0`, and its `✔` line named the test. On Windows the POSIX-only cases assert the `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` refusal with exit 5 (`tests/e2e/extension-cli-e2e.test.mjs:158-164`). C33 and C34, the checks on the merged file, are listed first.

| Check | Proof (test name) | Linux | Windows | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| C33 | `resolve refuses a lock without TLC` | 1/1 | 1/1 | `tests/unit/governed-skill-registry.test.mjs:165-168` `assert.rejects(registry().resolve(profile({ grillEnabled: false, enabledSkillIds: ["tlc-spec-driven"] }), extensionOnlyLock()), (error) => error.code === "VES_SKILL_TLC_REQUIRED")` | PASS |
| C34 | `an extension-only lock passes updates and extension resolution` | 1/1 | 1/1 | `tests/unit/governed-skill-registry.test.mjs:196` `plan.candidateGeneration === 2`; R:197-201; R:202 `["stage", "commit"]`; R:208 | PASS |
| C1 | `add registers the worker in a signed lock` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:183`; E:194; E:198 | PASS |
| C2 | `a lock the store writes verifies against the pinned anchor` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:120`; L:121; L:123 | PASS |
| C3 | `the init placeholder becomes generation 1` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:142`; L:148 | PASS |
| C4 | `the previous generation is kept for rollback` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:174` | PASS |
| C5 | `add refuses an entry outside the Workspace or behind a link` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:245`; E:246 | PASS |
| C6 | `an edited lock fails its signature` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:202-205`; L:196 | PASS |
| C7 | `lock signatures use the existing approval purpose` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:223`; L:224; L:240 | PASS |
| C8 | `the Workspace key still unlocks for task commands` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:262`; E:272 | PASS |
| C9 | `approve records the confirmed launch` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:286`; E:299-304 | PASS |
| C10 | `approve defaults to 30 days and refuses more than 365` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:312`; E:318 | PASS |
| C11 | `approve writes nothing unless the launch digest is typed back` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:326`; E:329; E:327; E:330 | PASS |
| C12 | `approve refuses a second approval for the same ref` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:342`; E:343 | PASS |
| C13 | `approve refuses environment the worker would refuse` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:356`; E:365 | PASS |
| C14 | `list reports each approval state in order` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:374`; E:389-397 | PASS |
| C15 | `revoke ends an approval` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:413`; E:416-419; E:421-423 | PASS |
| C16 | `revoke refuses an unknown or revoked approval` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:430`; E:438 | PASS |
| C17 | `approval and revocation records have their declared shape` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:66`; A:68-77; A:84; A:87 | PASS |
| C18 | `lookup returns only a verified, unexpired, unrevoked approval` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:112`; A:113-115 | PASS |
| C19 | `two concurrent approvals for one ref leave one record` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:131-134` | PASS |
| C20 | `check passes an admissible worker` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:450` | PASS |
| C21 | `check names each failing prerequisite` | 1/1 | 1/1 (refusal ×5) | `tests/e2e/extension-cli-e2e.test.mjs:519`; E:522-526; E:527 | PASS |
| C22 | `only a grant-required admission passes` | 1/1 | 1/1 | `tests/unit/extension-check.test.mjs:52`; K:72-78; K:80-84 | PASS |
| C23 | `approve and check refuse on win32`; `approve and check refuse on Windows` | 1/1; 1/1 | 1/1; 1/1 | `tests/unit/extension-check.test.mjs:106-110`; E:161-162 | PASS |
| C24 | `no worker starts during the extension commands` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:560`; E:570 | PASS |
| C25 | `only the extension commands reach admission`; `the walk flags spawning imports and other modules` | 1/1; 1/1 | 1/1; 1/1 | `tests/architecture/extension-host-composition.test.mjs:151`; G:152; G:156; G:182 | PASS |
| C26 | `the extension commands are declared and documented` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:575`; E:579; E:582 | PASS |
| C27 | `missing flags exit 2` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:611` | PASS |
| C28 | `outside a Workspace the commands refuse` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:640`; E:642 | PASS |
| C29 | `signing commands refuse without the passphrase` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:649`; E:651; E:660; E:662 | PASS |
| C30 | `envelopes carry their declared fields` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:671`; E:684; E:695; E:707; E:710 | PASS |
| C31 | `extension-host is an exported CLI dependency` | 1/1 | 1/1 | `tests/architecture/extension-host-composition.test.mjs:200`; G:202 | PASS |
| C32 | `check fails an expired approval` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:721`; E:723-726 | PASS |

## Findings

- **Round 4:** none. There is no new finding, and neither rebase lost behaviour from either side.
- **Earlier rounds:** F1-F3 were closed and F4 accepted in round 2; F5, F6 and R2-1 carry forward. See "Round 3 history" and "Round 2 history" below.

## Carried from 37fc2666

- **Round 3's parser review and differential.** These carry forward because `cli.ts` is token-identical to `37fc2666`.
- **Builder deviations, level and sampling gaps, Swept existing.** Carried from round 1 through rounds 2 and 3. The rebase changed none of their cited files except the registry, which is re-read above. The registry's line numbers at `f60417de` are: the walk's rule at :318-319 (round 1 cited :361-362, before main's extraction), and `activate`'s stage/commit/rollback at :291-298, unchanged.
- **Coverage, Test policy, faults.** Profile `light`: no coverage recompute and no fault injection. checks.md has no Test policy section, and the plan has no binding source.

## Gate (verified at f60417de)

| Run | Linux | Windows |
| --- | --- | --- |
| The 36 proof invocations (C1-C34) | 36/36, each 1 test passed, 0 skipped | 36/36, each 1 test passed, 0 skipped |
| `node --test tests/unit/governed-skill-registry.test.mjs` | 24/24, including `lock rejects invalid missing TLC` | 24/24 |
| `node --test tests/unit/cli-argument-parsing.test.mjs` | 10/10 | not re-run |
| `node --test tests/contract/cli-surface.test.mjs` | 57/57 | not re-run |
| `node --test tests/e2e/cli-launchers-e2e.test.mjs` | 17/17 | not re-run |
| `node --test tests/build/sealed-launcher-closure.test.mjs` | 14/14 | not run |
| `corepack pnpm run test:e2e` | exit 0: 361 passed, 0 failed, 0 cancelled, 0 skipped | not run |
| `corepack pnpm run test:build` | exit 0: 186 passed, 0 failed, 0 cancelled, 0 skipped | not run |
| `corepack pnpm run typecheck` | exit 0 | not run |
| `corepack pnpm run format:check` | exit 0: "All matched files use Prettier code style!" | not run |
| `corepack pnpm run complexity:check` | exit 0: "PASS — 134 baselined hotspot keys, nothing above 10 unaccounted" | not run |
| `gate:quick` | not run as a whole; its format, complexity and typecheck stages ran individually, above | the orchestrator was running it; I did not |

## Not verified

- macOS: no host.
- On Linux, `lint`, the full `test:unit`, `test:agent-readiness` and `agent:check`. The orchestrator's Windows `gate:quick` covers the `gate:quick` stages. Round 3 ran agent-readiness and agent:check on Linux, and the feature's `.specs` files have not changed since.
- The rest of `gate:full`, `gate:build`, `gate:security` and `gate:release` (contract, integration, security, fault, mutation, qualification, build), and the load proofs. Main's three commits touch runtime, driver, workspace, memory, evidence and platform packages that this run exercised only through the e2e and build suites.
- Fault injection and the coverage recompute, which are not part of `light`.

## Round 3 history (verified at 37fc2666)

Round 3 was a scoped re-verification of the first rebase over `d069bf92..37fc2666`, profile `light`, and returned PASS. Its report follows unchanged, except that every heading is one level lower and this paragraph replaces its header lines. Rounds 2 and 1 are nested inside it.

The rebase keeps both sides. Main split `parseCliArguments` into `findCommandManifest`, `parseCommandOptions` and `optionValue`, and that split is intact. Slice 1's three parser rules are intact too: the `--version` flag is taken as an option only by a command that declares one, a command family answers `--help`, and repeatable options collect their values. A differential run over 982,037 generated argument lists (168,421 for the shipped manifest and 813,616 for main's test manifest) found no difference from the round-2 parser. Against main's parser, the only differences were on inputs that exercise slice 1's rules. At `37fc2666`, all 34 checks pass on Linux and on Windows. On Linux, so do main's new parser suite, cli-surface, cli-launchers and sealed-launcher-closure, the full `test:e2e` (361) and `test:build` (186), `complexity:check`, `typecheck`, `test:agent-readiness` and `agent:check`. Nothing is open.

### Round 3 scope

- **What the rebase changed.** `git diff --name-only 985f3b8f 37fc2666` lists 18 files, exactly the 18 that main changed in `d069bf92..7b4d1085`. `985f3b8f` is `ec219824` plus the round-2 report, the handoffs and the lesson L-019.
  - The 16 files only main changed are byte-identical to main (`git diff 7b4d1085 37fc2666` on them is empty).
  - Every file only the feature changed is byte-identical to `985f3b8f`, the state round 2 verified.
  - Only two files were touched by both sides: `apps/vestra-cli/src/cli.ts` (the orchestrator's hand resolution) and `complexity-baseline.json`.
- **Not touched by the rebase.** `checks.md` and every file cited as check evidence (E, L, A, K, G, R) are identical to `ec219824`. The committed round-2 report at `37fc2666` is byte-identical to the one this Verifier wrote.
- **Re-run in full at `37fc2666`.**
  - Every C1-C34 proof on Linux and on Windows. The brief asked only for C26-C29 on Windows; I also ran the other 32, as verify.md requires proofs to be re-run in full at a new HEAD.
  - Main's `tests/unit/cli-argument-parsing.test.mjs`, cli-surface, cli-launchers-e2e and sealed-launcher-closure.
  - `test:e2e`, `test:build`, `complexity:check`, `typecheck`, `test:agent-readiness` and `agent:check` on Linux. Main also changed `scripts/agent-readiness.mjs` and its handoff-field tests, and this feature changes handoffs, so the last two were worth running.

### Platforms (verified at 37fc2666)

| Platform | Host | Node | Tree |
| --- | --- | --- | --- |
| Linux | WSL 2 Ubuntu, `~/verchestra-569`. It was clean at `ec219824`; I fetched `feat/235-extension-commands-relanded` and checked out `37fc2666` detached. `git status --short` is empty before and after | 24.14.0 | `pnpm install --frozen-lockfile`: already up to date; main did not change `pnpm-lock.yaml` |
| Windows | Windows 11 Pro, `C:\My_AI_Projects\verchestra` on `feat/235-extension-commands-relanded` at `37fc2666`; only `.claude/` is untracked, plus this report modified. The orchestrator ran `gate:quick` there at the same time; I did not | 24.14.0 | as checked out |
| macOS | not available on this host: no macOS column | - | - |

### Merged parser (apps/vestra-cli/src/cli.ts at 37fc2666)

**Read against the plan's Impact row "CLI parser" (`.specs/features/probe-host-composition/plan.md:51`).**

- **Order.** `parseCliArguments` (`apps/vestra-cli/src/cli.ts:201`) still runs:
  1. `extractOutput` (:203)
  2. the global help and version shortcuts
  3. `findCommandManifest` (:206), which now returns `undefined` instead of throwing (:223-233)
  4. `refuseMixedVersion` (:207, defined at :158)
  5. `familyHelp` when no command matches (:208, defined at :166)
  6. command `--help` (:211)
  7. the JSON-support check
  8. `parseCommandOptions` (:215, defined at :235), which hands every option to `assignOption` (:246, defined at :183)
- **Repeatable options.** Slice 1's `optionValue(option, token, value)` (:174) keeps the repeatable exception. For every non-repeatable option it behaves exactly as main's `optionValue(token, option, value)`: an absent value or one starting with `--` is "Option value is missing", and a value outside `values` is "Option value is invalid".
- **Duplicates.** The duplicate check moved from main's loop into `assignOption`. It is unchanged except that repeatable options are exempt.
- **The `repeatable` comment** (:11-14) is unchanged from round 2.

The three Impact rules, the `--output`/`--help`/`--version` precedence, and `CliCommand.options` holding a string array are all present.

**Read against main's behaviour as `tests/unit/cli-argument-parsing.test.mjs` pins it.** It passed 10/10 on Linux and 10/10 on Windows. It pins:

| Behaviour main pins | Where |
| --- | --- |
| the longest command name wins | :43-52 |
| an empty option set | :54-60 |
| an uninstalled command refused with argument `deploy` and "Command is not installed" | :63; at HEAD `familyHelp` raises it for a first word that names no family |
| command help before the JSON check and option parsing | :72 |
| JSON refused for `doctor` | :77 |
| a positional argument refused | :85 |
| an unknown option, and a repeated one, refused as "unknown or duplicated" | :93 and :98 |
| a missing value refused, also before another flag | :110 |
| an invalid value refused | :119 |
| the first invalid token decides | :127 and :132 |

**Differential check (Windows, Node 24.14.0).** I ran three parsers on the same inputs and compared normalized outcomes (mode, output, command, help name, family) or refusals (code, argument, message):

- the merged `cli.ts` at `37fc2666`;
- the round-2 `cli.ts` from `ec219824`;
- main's `cli.ts` from `7b4d1085`.

The round-2 and main copies were loaded from the scratchpad with their imports pointed at this repository's unchanged `cli-errors.ts` and `@verchestra/domain`. The inputs were every token sequence up to length 4 or 5 over a fixed alphabet:

| Comparison | Inputs | Differ |
| --- | --- | --- |
| merged vs round 2, shipped manifest (length ≤ 4) | 168,421 | 0 |
| merged vs round 2, main's test manifest (length ≤ 5) | 813,616 | 0 |
| merged vs main, main's test manifest (length ≤ 5) | 813,616 | 0 |
| merged vs main, shipped manifest, inputs filtered to avoid slice 1's rules (length ≤ 4) | 107,435 | 3 |

The 3 differences are `--output json <extension|task|secret> --help`. These are slice 1's family-help rule: the filter only checked the first token, and here `--output json` comes before the family word. They are expected, not a lost behaviour.

**Conclusion.** Nothing from either side was lost. The merged parser is the round-2 parser placed in main's function structure.

**`complexity-baseline.json`.** Main's removals are kept, including `parseCliArguments` (21) and the site and script entries. Slice 1's removal of `runCli` and its `assertManifest` 11 are applied on top (`complexity-baseline.json:8-9`). `complexity:check` on Linux reports "PASS — 163 baselined hotspot keys, nothing above 10 unaccounted", so the merged `parseCliArguments`, `parseCommandOptions` and `findCommandManifest` are each at or under 10.

### Checks (proofs verified at 37fc2666; citations carried from ec219824, whose files are unchanged)

Each proof ran exactly as `checks.md` writes it, once per proof per platform. Every one of the 36 invocations, on each platform, exited 0 with `tests 1 / pass 1 / fail 0 / skipped 0`, and its `✔` line named the test. On Windows the POSIX-only cases assert the `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` refusal with exit 5 (`tests/e2e/extension-cli-e2e.test.mjs:158-164`). C26-C29, the checks closest to the parser, are listed first.

| Check | Proof (test name) | Linux | Windows | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| C26 | `the extension commands are declared and documented` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:575` manifest names; E:579 `^  ${name} ` in `vestra extension --help` (the family-help rule); E:582 JSON `commands` | PASS |
| C27 | `missing flags exit 2` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:611` `refused(vestra(fixture, argv), "VES_CLI_ARGUMENT_INVALID", 2, label)` over 6 cases | PASS |
| C28 | `outside a Workspace the commands refuse` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:640` `VES_INIT_WORKSPACE_MISSING`, 5; E:642 | PASS |
| C29 | `signing commands refuse without the passphrase` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:649` `VES_TASK_NOT_CONFIGURED`, 5; E:651; E:660; E:662 | PASS |
| C1 | `add registers the worker in a signed lock` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:183`; E:194; E:198 | PASS |
| C2 | `a lock the store writes verifies against the pinned anchor` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:120`; L:121; L:123 | PASS |
| C3 | `the init placeholder becomes generation 1` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:142`; L:148 | PASS |
| C4 | `the previous generation is kept for rollback` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:174` | PASS |
| C5 | `add refuses an entry outside the Workspace or behind a link` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:245`; E:246 | PASS |
| C6 | `an edited lock fails its signature` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:202-205`; L:196 | PASS |
| C7 | `lock signatures use the existing approval purpose` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:223`; L:224; L:240 | PASS |
| C8 | `the Workspace key still unlocks for task commands` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:262`; E:272 | PASS |
| C9 | `approve records the confirmed launch` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:286`; E:299-304 | PASS |
| C10 | `approve defaults to 30 days and refuses more than 365` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:312`; E:318 | PASS |
| C11 | `approve writes nothing unless the launch digest is typed back` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:326`; E:329; E:327; E:330 | PASS |
| C12 | `approve refuses a second approval for the same ref` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:342`; E:343 | PASS |
| C13 | `approve refuses environment the worker would refuse` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:356`; E:365 | PASS |
| C14 | `list reports each approval state in order` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:374`; E:389-397 | PASS |
| C15 | `revoke ends an approval` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:413`; E:416-419; E:421-423 | PASS |
| C16 | `revoke refuses an unknown or revoked approval` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:430`; E:438 | PASS |
| C17 | `approval and revocation records have their declared shape` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:66`; A:68-77; A:84; A:87 | PASS |
| C18 | `lookup returns only a verified, unexpired, unrevoked approval` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:112`; A:113-115 | PASS |
| C19 | `two concurrent approvals for one ref leave one record` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:131-134` | PASS |
| C20 | `check passes an admissible worker` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:450` | PASS |
| C21 | `check names each failing prerequisite` | 1/1 | 1/1 (refusal ×5) | `tests/e2e/extension-cli-e2e.test.mjs:519`; E:522-526; E:527 | PASS |
| C22 | `only a grant-required admission passes` | 1/1 | 1/1 | `tests/unit/extension-check.test.mjs:52`; K:72-78; K:80-84 | PASS |
| C23 | `approve and check refuse on win32`; `approve and check refuse on Windows` | 1/1; 1/1 | 1/1; 1/1 | `tests/unit/extension-check.test.mjs:106-110`; E:161-162 | PASS |
| C24 | `no worker starts during the extension commands` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:560`; E:570 | PASS |
| C25 | `only the extension commands reach admission`; `the walk flags spawning imports and other modules` | 1/1; 1/1 | 1/1; 1/1 | `tests/architecture/extension-host-composition.test.mjs:151`; G:152; G:156; G:182 | PASS |
| C30 | `envelopes carry their declared fields` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:671`; E:684; E:695; E:707; E:710 | PASS |
| C31 | `extension-host is an exported CLI dependency` | 1/1 | 1/1 | `tests/architecture/extension-host-composition.test.mjs:200`; G:202 | PASS |
| C32 | `check fails an expired approval` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:721`; E:723-726 | PASS |
| C33 | `resolve refuses a lock without TLC` | 1/1 | 1/1 | `tests/unit/governed-skill-registry.test.mjs:165-168` | PASS |
| C34 | `an extension-only lock passes updates and extension resolution` | 1/1 | 1/1 | `tests/unit/governed-skill-registry.test.mjs:196`; R:197-201; R:202; R:208 | PASS |

### Findings

- **Round 3:** none. There is no new finding, and the merge lost no behaviour from either side.
- **Earlier rounds:** F1-F3 were closed and F4 accepted in round 2; F5 and F6 carry forward (see "Round 2 history" below).
- **R2-1:** carried as informational. The parse probe at `37fc2666` gives the same five shipped-manifest outcomes as in round 2, and the synthetic both-options case still parses `--arg --version` as a value.
- **Lessons:** the orchestrator has recorded the lesson round 1 suggested, as L-019 in `.specs/LESSONS.md`, in commit `985f3b8f`.

### Carried from ec219824

- **Builder deviations, level and sampling gaps, Swept existing.** Carried from round 1 through round 2. The rebase changed none of their cited files except `cli.ts`, which is re-read above. Its line numbers moved again: the parser region is now at `apps/vestra-cli/src/cli.ts:158-249`.
- **Coverage, Test policy, faults.** Profile `light`: no coverage recompute and no fault injection. checks.md has no Test policy section, and the plan has no binding source.

### Gate (verified at 37fc2666)

| Run | Linux | Windows |
| --- | --- | --- |
| The 36 proof invocations (C1-C34) | 36/36, each 1 test passed, 0 skipped | 36/36, each 1 test passed, 0 skipped |
| `node --test tests/unit/cli-argument-parsing.test.mjs` | 10/10 | 10/10 |
| `node --test tests/contract/cli-surface.test.mjs` | 57/57 | not re-run (the orchestrator reports 57/57) |
| `node --test tests/e2e/cli-launchers-e2e.test.mjs` | 17/17 | not re-run (the orchestrator reports 17/17) |
| `node --test tests/build/sealed-launcher-closure.test.mjs` | 14/14 | not run |
| `corepack pnpm run test:e2e` | exit 0: 361 passed, 0 failed, 0 skipped | not run |
| `corepack pnpm run test:build` | exit 0: 186 passed, 0 failed, 0 skipped | not run |
| `corepack pnpm run complexity:check` | exit 0: PASS, 163 baselined keys | not re-run (the orchestrator reports PASS) |
| `corepack pnpm run typecheck` | exit 0 | not run |
| `corepack pnpm run test:agent-readiness` | exit 0: 428 passed, 0 failed, 0 skipped | not run |
| `corepack pnpm run agent:check` | exit 0: PASS | not run |
| `gate:quick` | not run as a whole; its complexity, typecheck and agent-readiness stages ran individually, above | the orchestrator was running it; I did not |

### Not verified

- macOS: no host.
- On Linux, the `format:check`, `lint` and `test:unit` stages of `gate:quick` as a whole; only `cli-argument-parsing` from `test:unit` ran. The orchestrator's Windows `gate:quick` covers them.
- The rest of `gate:full`, `gate:build`, `gate:security` and `gate:release` (contract, integration, security, fault, mutation, qualification, build), and the load proofs.
- Fault injection and the coverage recompute, which are not part of `light`.

### Round 2 history (verified at ec219824)

Round 2 was a scoped re-verification over `d069bf92..ec219824`, profile `light`, and returned PASS. Its report follows unchanged, except that every heading is one level lower and this paragraph replaces its header lines. Round 1's history is nested inside it.

Round 1's FAIL is closed. At `ec219824`, all 34 checks pass on Linux and on Windows. Every proof was re-run in full; each names a test that exists and ran, and each check has a located assertion. F1 is fixed: the two pinned command lists now name the five `extension` commands. Both affected suites pass, and so do the whole of `test:e2e` (361/361) and `test:build` (186/186) on Linux. F2 and F3 now match the code, and F4 is recorded as a process note. One new informational note, R2-1, needs no action.

#### Round 2 scope

- **Fix diff, `12f01d01..ec219824`: six files, one commit.**
  - `tests/e2e/cli-launchers-e2e.test.mjs` (+1/-1)
  - `tests/build/sealed-launcher-closure.test.mjs` (+6/-1)
  - `apps/vestra-cli/src/cli.ts` (+2, comment lines only)
  - `.specs/features/probe-host-composition/plan.md` (the Impact row "CLI parser")
  - `.specs/features/probe-host-composition/validation.md`
  - `CHANGELOG.md`
- **Round 1 verdicts that were not PASS:** the overall FAIL, driven by F1. F2 and F3 were low; F4 was a process note. F5 and F6 were informational, and they carry forward.
- **Unchanged by the fix.** None of these differ between `12f01d01` and `ec219824` (`git diff --quiet` exits 0):
  - every file cited as check evidence: `tests/e2e/extension-cli-e2e.test.mjs`, `tests/unit/skill-lock-file.test.mjs`, `tests/unit/extension-approval-store.test.mjs`, `tests/unit/extension-check.test.mjs`, `tests/architecture/extension-host-composition.test.mjs` and `tests/unit/governed-skill-registry.test.mjs`
  - everything under `apps/vestra-cli/src/extension/` and `packages/`

  The only product-code change is the two comment lines in `cli.ts`.
- **What was re-run.** Every proof, re-run in full at `ec219824` on both platforms, as the scoped-round rule requires. The two F1 suites in full: cli-launchers on both platforms, sealed-launcher on Linux. `test:e2e` and `test:build` in full on Linux. Their scripts collect every `*.test.mjs` under `tests/e2e` and `tests/build` (`scripts/test-scope.mjs`), and neither directory holds a load-proof suite, so nothing was skipped.

#### Platforms (verified at ec219824)

| Platform | Host | Node | Tree |
| --- | --- | --- | --- |
| Linux | WSL 2 Ubuntu, `~/verchestra-569`, detached at `ec219824`; `git status --short` is empty before and after | 24.14.0 | lockfile unchanged by the fix |
| Windows | Windows 11 Pro, `C:\My_AI_Projects\verchestra` at `ec219824`; untracked are only `.claude/` and this report. The orchestrator ran `gate:quick` in the same checkout at the same time; I did not | 24.14.0 | as checked out |
| macOS | not available on this host: no macOS column | - | - |

#### Checks (proofs verified at ec219824; citations carried from 12f01d01, whose files are unchanged)

Each of the 36 proof lines ran exactly as `checks.md` writes it, once per proof per platform. Every invocation exited 0 with `tests 1 / pass 1 / fail 0 / cancelled 0 / skipped 0 / todo 0`, and the one `✔` line it printed was the named test. On Windows the POSIX-only cases assert the `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` refusal with exit 5 (`tests/e2e/extension-cli-e2e.test.mjs:158-164`), as in round 1. Abbreviations are as in round 1: E, L, A, K, G and R.

| Check | Proof (test name) | Linux | Windows | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| C1 | `add registers the worker in a signed lock` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:183` deepEqual `{ lockDigest, generation: 1, skillId, extensionId, approvalRef }`; E:194; E:198 | PASS |
| C2 | `a lock the store writes verifies against the pinned anchor` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:120` `verifyLock(...) === true`; L:121; L:123 | PASS |
| C3 | `the init placeholder becomes generation 1` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:142` `kind "bootstrap"`; L:148 `generation 1` | PASS |
| C4 | `the previous generation is kept for rollback` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:174` `assert.deepEqual(kept, generationOne)` | PASS |
| C5 | `add refuses an entry outside the Workspace or behind a link` | 1/1 | 1/1 (junction) | `tests/e2e/extension-cli-e2e.test.mjs:245` `refused(..., "VES_EXTENSION_ENTRY_INVALID", 5)`; E:246 lock unchanged | PASS |
| C6 | `an edited lock fails its signature` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:202-205` `VES_SKILL_SIGNATURE_INVALID`; L:196 | PASS |
| C7 | `lock signatures use the existing approval purpose` | 1/1 | 1/1 | `tests/unit/skill-lock-file.test.mjs:223` predicate `skill-lock/v1`; L:224 `approval`; L:240 | PASS |
| C8 | `the Workspace key still unlocks for task commands` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:262` purposes; E:272 `task plan` status 0 | PASS |
| C9 | `approve records the confirmed launch` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:286` deepEqual data; E:299-304 | PASS |
| C10 | `approve defaults to 30 days and refuses more than 365` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:312` exit 2; E:318 `30 * DAY` | PASS |
| C11 | `approve writes nothing unless the launch digest is typed back` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:326` and E:329 `VES_TASK_CONFIRMATION_REQUIRED`, 5; E:327, E:330 | PASS |
| C12 | `approve refuses a second approval for the same ref` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:342` `VES_EXTENSION_APPROVAL_EXISTS`, 5; E:343 | PASS |
| C13 | `approve refuses environment the worker would refuse` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:356` `VES_PROBE_HOST_ENVIRONMENT_DENIED` over E:354; E:365 | PASS |
| C14 | `list reports each approval state in order` | 1/1 | 1/1 (empty list) | `tests/e2e/extension-cli-e2e.test.mjs:374` `{ approvals: [] }`; E:389-397 | PASS |
| C15 | `revoke ends an approval` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:413` revocation predicate; E:416-419; E:421-423 | PASS |
| C16 | `revoke refuses an unknown or revoked approval` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:430` `NOT_FOUND`, 5; E:438 `REVOKED`, 5 | PASS |
| C17 | `approval and revocation records have their declared shape` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:66` predicate `extension-approval/v1`; A:68-77; A:84; A:87 | PASS |
| C18 | `lookup returns only a verified, unexpired, unrevoked approval` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:112`; A:113-115 `undefined` ×3 | PASS |
| C19 | `two concurrent approvals for one ref leave one record` | 1/1 | 1/1 | `tests/unit/extension-approval-store.test.mjs:131-134` | PASS |
| C20 | `check passes an admissible worker` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:450` all six rows `pass` | PASS |
| C21 | `check names each failing prerequisite` | 1/1 | 1/1 (refusal ×5) | `tests/e2e/extension-cli-e2e.test.mjs:519` status 4; E:522-526; E:527 | PASS |
| C22 | `only a grant-required admission passes` | 1/1 | 1/1 | `tests/unit/extension-check.test.mjs:52`; K:72-78; K:80-84 | PASS |
| C23 | `approve and check refuse on win32`; `approve and check refuse on Windows` | 1/1; 1/1 | 1/1; 1/1 | `tests/unit/extension-check.test.mjs:106-110`; E:161-162 | PASS |
| C24 | `no worker starts during the extension commands` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:560` marker `ENOENT`; E:570 control | PASS |
| C25 | `only the extension commands reach admission`; `the walk flags spawning imports and other modules` | 1/1; 1/1 | 1/1; 1/1 | `tests/architecture/extension-host-composition.test.mjs:151`; G:152; G:156; G:182 | PASS |
| C26 | `the extension commands are declared and documented` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:575`; E:579; E:582 | PASS |
| C27 | `missing flags exit 2` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:611` `VES_CLI_ARGUMENT_INVALID`, 2 | PASS |
| C28 | `outside a Workspace the commands refuse` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:640`; E:642 | PASS |
| C29 | `signing commands refuse without the passphrase` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:649`; E:651; E:660; E:662 | PASS |
| C30 | `envelopes carry their declared fields` | 1/1 | 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:671`; E:684; E:695; E:707; E:710 | PASS |
| C31 | `extension-host is an exported CLI dependency` | 1/1 | 1/1 | `tests/architecture/extension-host-composition.test.mjs:200`; G:202 | PASS |
| C32 | `check fails an expired approval` | 1/1 | 1/1 (refusal) | `tests/e2e/extension-cli-e2e.test.mjs:721`; E:723-726 | PASS |
| C33 | `resolve refuses a lock without TLC` | 1/1 | 1/1 | `tests/unit/governed-skill-registry.test.mjs:165-168` `VES_SKILL_TLC_REQUIRED` | PASS |
| C34 | `an extension-only lock passes updates and extension resolution` | 1/1 | 1/1 | `tests/unit/governed-skill-registry.test.mjs:196`; R:197-201; R:202; R:208 | PASS |

#### Round 1 findings, re-judged at ec219824

| Finding | Round 1 | Change in ec219824 | Evidence at ec219824 | Round 2 |
| --- | --- | --- | --- | --- |
| F1 | high, blocking | Both pinned command lists name the five `extension` commands | **cli-launchers.** The `--help` snapshot is the literal at `tests/e2e/cli-launchers-e2e.test.mjs:45`, asserted by `tests/e2e/cli-launchers-e2e.test.mjs:64` `assert.equal(result.stdout, expectedStdout)`. I checked it independently of the run, by parsing both revisions of the literal: the 14 old rows are unchanged apart from the column width; exactly the five extension rows were appended; all 19 rows equal `installedReleaseManifest`'s names and summaries in order, padded to the 17-character name width; the header and trailer are unchanged. It is a literal, not computed when the test runs, so the test is not a tautology. **Sealed launcher.** `SEALED_COMMANDS` (`tests/build/sealed-launcher-closure.test.mjs:79-99`) is asserted at `tests/build/sealed-launcher-closure.test.mjs:299-302`. **Runs.** cli-launchers 17/17 on Linux and 17/17 on Windows; sealed-launcher-closure 14/14 on Linux; `test:e2e` 361/361 and `test:build` 186/186 on Linux | closed |
| F2 | low | The plan's Impact row (`.specs/features/probe-host-composition/plan.md:51`), the `repeatable` comment (`apps/vestra-cli/src/cli.ts:11-14`) and validation.md now say that `--output`, `--help` and `--version` are read before any command option | The parse order in `apps/vestra-cli/src/cli.ts` is `extractOutput` at :203, then `refuseMixedVersion` at :212, then the `--help` check at :216, then the option walk at :223. A parse probe at HEAD with the shipped manifest gave: `--arg --help` returns command help; `--arg --version` is refused with `VES_CLI_ARGUMENT_INVALID` (`--version`); `--arg --output json` leaves `--arg` with no value and is refused; `--arg --no-warnings` returns `arg: ["--no-warnings"]`. The new wording matches the code for every shipped command (see R2-1) | closed |
| F3 | low | `CHANGELOG.md:17` now reads "unless `--expires` names another time after now, at most 365 days ahead" | `apps/vestra-cli/src/extension/extension-command.ts:81-82` refuses `instant <= now || instant > now + MAXIMUM_APPROVAL_DAYS * DAY_MS`, so the accepted range is after now, up to 365 days. C10 proves the bound and the 30-day default | closed |
| F4 | low, process | Recorded under "## Verifier round 1" in `.specs/features/probe-host-composition/validation.md:162`; the approved row is not rewritten again | A history note for the human reviewer; there is nothing in the code to verify | accepted as recorded |
| F5 | info | none | carried from `12f01d01`: door 4 supersedes the #569 guard, and the guard's file header still names #569 | carried |
| F6 | info | none | carried from `12f01d01`: the plan requires only help generated from the manifest | carried |

#### New in round 2

- **R2-1 (info, no action needed).** The new `repeatable` comment (`apps/vestra-cli/src/cli.ts:13-14`) is phrased generally: `--version` "can never be such a value". That holds only while no command declares both a `version` option and a repeatable option. A probe with a synthetic manifest declaring both parsed `probe both --arg --version` as `arg: ["--version"]`. In the shipped manifest, only `extension add` declares `version` (`apps/vestra-cli/src/release-manifest.ts:254`) and only `extension approve` has repeatable options (`apps/vestra-cli/src/release-manifest.ts:267-268`). So the plan's narrower claim, that none of these tokens "reaches a worker this way", is true. A later command declaring both would need the comment revisited.
- **validation.md.** Its "## Verifier round 1" section (`.specs/features/probe-host-composition/validation.md:162`) states the round-1 outcome and every disposition accurately.

#### Carried from 12f01d01

- **Builder deviations scrutinised, level and sampling gaps, Swept existing.** Carried from `12f01d01`; the sections are under "Round 1 history" below. The fix touched none of their cited files except `apps/vestra-cli/src/cli.ts`, which I re-read at `ec219824`: only the two comment lines changed. Every `cli.ts` line number cited in round 1 moved down by 2: `:135`, `:156` and `:214` are now `:137`, `:158` and `:216`.
- **Coverage, Test policy, faults.** The `light` profile is unchanged: no coverage recompute, no fault injection. checks.md has no Test policy section, and the plan has no binding source.

#### Gate (verified at ec219824)

| Run | Linux | Windows |
| --- | --- | --- |
| The 36 proof invocations (C1-C34) | 36/36, each 1 test passed, 0 skipped | 36/36, each 1 test passed, 0 skipped |
| `node --test tests/e2e/cli-launchers-e2e.test.mjs` | 17 passed, 0 failed, 0 skipped | 17 passed, 0 failed, 0 skipped |
| `node --test tests/build/sealed-launcher-closure.test.mjs` | 14 passed, 0 failed, 0 skipped | not run |
| `corepack pnpm run test:e2e` (all 35 files under `tests/e2e`) | exit 0: 361 passed, 0 failed, 0 cancelled, 0 skipped | not run |
| `corepack pnpm run test:build` (all 18 files under `tests/build`) | exit 0: 186 passed, 0 failed, 0 cancelled, 0 skipped | not run |
| `gate:quick` | carried from `12f01d01` (PASS: unit 3215, agent-readiness 413, census 14). The fix changes no unit test and only a comment in product code | the orchestrator was running it in the same checkout; I did not run it |

#### Not verified

- macOS: no host.
- The rest of `gate:full`, `gate:build`, `gate:security` and `gate:release`: `test:contract`, `test:integration`, `test:security`, `test:fault`, `test:mutation`, `test:qualification`, `build`, and the load proofs. Round 1 ran targeted contract, security and integration suites green, and the fix touches none of their inputs.
- No lesson was recorded with `lessons.py`: this Verifier's only permitted write is this report. The lesson round 1 suggested still stands for the orchestrator to record.

#### Round 1 history (verified at 12f01d01)

Round 1 ran the full procedure over `d069bf92..12f01d01` under profile `light` and returned FAIL. All 34 checks passed on both platforms; F1 alone drove the FAIL. Its report follows unchanged, except that the headings are one level lower and this paragraph replaces its header lines.

Every check, C1-C34, is proven at `12f01d01` on Linux and on Windows. Each proof names a test that exists and ran, and each check has a located assertion. The verdict is FAIL for one reason only: finding F1. The change breaks two existing tests that pass at the base. They run in `test:e2e` and `test:build`, so `gate:full`, `gate:build`, `gate:security` and `gate:release` go red. AGENTS.md says work is done only when the required gates pass.

##### Platforms

| Platform | Host | Node | Tree |
| --- | --- | --- | --- |
| Linux | WSL 2 Ubuntu, checkout `~/verchestra-569`, detached at `12f01d01`, clean before and after (`git status --short` empty) | 24.14.0 | `corepack pnpm install --frozen-lockfile`: lockfile up to date |
| Windows | Windows 11 Pro, `C:\My_AI_Projects\verchestra` at `12f01d01`; only `?? .claude/` is untracked, as before the run | 24.14.0 | as checked out |
| macOS | not available on this host: no macOS column | - | - |

##### How the proofs were run

Each of the 36 proof lines in `checks.md` ran exactly as written: `node --test --test-name-pattern "<name>" <file>`, one invocation per proof, on each platform. C23 and C25 have two proofs each. For every invocation the runner reported exit 0 and `tests 1 / pass 1 / fail 0 / cancelled 0 / skipped 0 / todo 0`. The one `✔` line it printed was the test the check names, so no filter matched zero tests and no test was skipped.

On Windows, a case that needs `approve` or `check` takes its `if (WIN32)` branch. That branch asserts the `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` refusal with exit 5 (`tests/e2e/extension-cli-e2e.test.mjs:158-164`). The Windows column therefore proves the refusal for those cases, not the POSIX behavior. On Linux every case runs in full.

All 21 tests in `tests/e2e/extension-cli-e2e.test.mjs`, 5 in `tests/unit/skill-lock-file.test.mjs`, 3 in `tests/unit/extension-approval-store.test.mjs`, 2 in `tests/unit/extension-check.test.mjs`, 3 in `tests/architecture/extension-host-composition.test.mjs`, and the 2 new tests in `tests/unit/governed-skill-registry.test.mjs` are named by a proof. Each was added in this diff range: no proof resolves only to a test the feature never touched.

Abbreviations below: E = `tests/e2e/extension-cli-e2e.test.mjs`, L = `tests/unit/skill-lock-file.test.mjs`, A = `tests/unit/extension-approval-store.test.mjs`, K = `tests/unit/extension-check.test.mjs`, G = `tests/architecture/extension-host-composition.test.mjs`, R = `tests/unit/governed-skill-registry.test.mjs`. `refused(result, code, status)` asserts `result.status === status` and the error code (E:100-104).

##### Checks

| Check | Claim | Proof run | Linux | Windows | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `add` writes the next generation with the extensionRef and entry sha256, and prints `lockDigest` and `generation` | `add registers the worker in a signed lock` (E) | exit 0, 1/1 | exit 0, 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:183` - `assert.deepEqual(first, { lockDigest: lock.lockDigest, generation: 1, skillId, extensionId, approvalRef })`; E:194 `assert.deepEqual(skill.extensionRef, { kind: "plugin", id: WORKER.extension, approvalRef: WORKER.ref })`; E:198 `assert.equal(skill.contents[0].digest, digest)`; E:215 `assert.equal(next.generation, 2)` | PASS |
| C2 | lock and source signatures verify against the pinned anchor; the registry accepts the lock | `a lock the store writes verifies against the pinned anchor` (L) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/skill-lock-file.test.mjs:120` - `assert.equal(await verifier.verifyLock(onDisk.lock), true)`; L:121 `verifySource(...) === true`; L:123 `assert.equal(resolved.lockDigest, onDisk.lock.lockDigest)`; a different key does not verify (L:131-136) | PASS |
| C3 | `init`'s placeholder becomes generation 1 | `the init placeholder becomes generation 1` (L) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/skill-lock-file.test.mjs:142` - `assert.equal(before.kind, "bootstrap")` over the exact `init` bytes (L:32); L:148 `assert.equal(written.generation, 1)`; L:154 `assert.equal(after.lock.generation, 1)` | PASS |
| C4 | generation N+1 keeps N as `skills.lock.<N>.json` | `the previous generation is kept for rollback` (L) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/skill-lock-file.test.mjs:174` - `assert.deepEqual(kept, generationOne)` where `kept` is `skills.lock.1.json` (L:173); L:177 `assert.equal(current.lock.generation, 2)` | PASS |
| C5 | an entry outside the Workspace, or behind a link, exits 5 and leaves the lock byte-identical | `add refuses an entry outside the Workspace or behind a link` (E) | exit 0, 1/1 | exit 0, 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:245` - `refused(add(fixture, WORKER, { entry }), "VES_EXTENSION_ENTRY_INVALID", 5, label)`; E:246 `assert.deepEqual(await readFile(lockPath(fixture)), before)` | PASS |
| C6 | an edited lock fails with `VES_SKILL_SIGNATURE_INVALID`; an unedited copy is accepted | `an edited lock fails its signature` (L) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/skill-lock-file.test.mjs:202-205` - `assert.rejects(..., (error) => error.code === "VES_SKILL_SIGNATURE_INVALID" && error.message === "Skill lock signature is invalid")`; L:196 the unedited copy resolves | PASS |
| C7 | DSSE envelopes, predicate `.../skill-lock/v1`, purpose `approval`; the key keeps exactly `EVIDENCE_PURPOSES` | `lock signatures use the existing approval purpose` (L) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/skill-lock-file.test.mjs:223` - `assert.equal(statement.predicateType, PREDICATE)` (L:33 is `.../skill-lock/v1`); L:224 `binding.purpose === "approval"`; L:234 pins `EVIDENCE_PURPOSES`; L:240 the key file's purposes equal it | PASS |
| C8 | after `add` and `approve`, a task command still unlocks the same key | `the Workspace key still unlocks for task commands` (E) | exit 0, 1/1 | exit 0, 1/1 (approve asserted refused) | `tests/e2e/extension-cli-e2e.test.mjs:262` - `assert.deepEqual(JSON.parse(...).publicKeyRef.purposes, [...EVIDENCE_PURPOSES])`; E:272 `assert.equal(plan.status, 0)` for `task plan` | PASS |
| C9 | `approve` records extension id, lockDigest, entry digest, the measured launch digest and `expiresAt` | `approve records the confirmed launch` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:286` - `assert.deepEqual(data, { approvalRef, extensionId, componentDigest, launchDigest, expiresAt: expires })`; E:299-304 the record's `lockDigest`, `extensionId`, `componentDigest`, `launchDigest`, `launch`, `expiresAt` | PASS |
| C10 | the default is 30 days; more than 365 days exits 2 | `approve defaults to 30 days and refuses more than 365` (E) | exit 0, 1/1 | exit 0, 1/1 (365-day bound in full) | `tests/e2e/extension-cli-e2e.test.mjs:312` - `refused(tooLate.result, "VES_CLI_ARGUMENT_INVALID", 2, ...)`; E:318 `assert.equal(Date.parse(content.expiresAt) - Date.parse(content.approvedAt), 30 * DAY)` | PASS |
| C11 | a mistyped digest, and no `--confirm-stdin` without a terminal, each give `VES_TASK_CONFIRMATION_REQUIRED`, exit 5, and no file | `approve writes nothing unless the launch digest is typed back` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:326` - `refused(mistyped.result, "VES_TASK_CONFIRMATION_REQUIRED", 5, ...)`; E:329 the same for the unconfirmed run; E:327 and E:330 `assert.deepEqual(await approvalFiles(fixture), [])` | PASS |
| C12 | a second `approve` exits 5 and leaves the first record byte-identical | `approve refuses a second approval for the same ref` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:342` - `refused(again.result, "VES_EXTENSION_APPROVAL_EXISTS", 5, ...)`; E:343 `assert.deepEqual(await readFile(approvalPath(...)), first)` | PASS |
| C13 | `NODE_OPTIONS`, `API_TOKEN` and `VERCHESTRA_PROBE_WORKSPACE_ID` are refused with the host's code before anything is measured | `approve refuses environment the worker would refuse` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:356` - `refused(..., "VES_PROBE_HOST_ENVIRONMENT_DENIED", 5, name)` for the 3 names at E:354, with a missing executable; E:365 a permitted name reaches measurement (`VES_PROBE_HOST_INPUT_INVALID`) | PASS |
| C14 | `list` gives `active`, `expired`, `revoked` and `invalid` in code-unit order, and an empty array at exit 0 | `list reports each approval state in order` (E) | exit 0, 1/1 | exit 0, 1/1 (empty list in full) | `tests/e2e/extension-cli-e2e.test.mjs:374` - `assert.deepEqual(empty, { approvals: [] })`; E:389-397 `[[active.ref,"active"],[expired.ref,"expired"],[revoked.ref,"revoked"],[invalid.ref,"invalid"]]` | PASS |
| C15 | `revoke` writes a signed revocation and prints `revokedAt`; `list` then says `revoked`; `check` fails | `revoke ends an approval` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:413` - `assert.equal(revocation.predicateType, \`${BASE}/extension-approval-revocation/v1\`)`; E:411 `revokedAt` parses; E:416-419 `["revoked"]`; E:421-423 `status === 4` and code `VES_PROBE_WORKSPACE_TRUST_APPROVAL` | PASS |
| C16 | revoking an unknown ref, or one already revoked, exits 5 and writes nothing | `revoke refuses an unknown or revoked approval` (E) | exit 0, 1/1 | exit 0, 1/1 (unknown in full) | `tests/e2e/extension-cli-e2e.test.mjs:430` - `refused(unknown, "VES_EXTENSION_APPROVAL_NOT_FOUND", 5, ...)`; E:438 `refused(again, "VES_EXTENSION_APPROVAL_REVOKED", 5, ...)`; E:431 and E:439-440 nothing written | PASS |
| C17 | the approval and revocation record shapes, paths and predicate types | `approval and revocation records have their declared shape` (A) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/extension-approval-store.test.mjs:66` - `assert.equal(statement.predicateType, \`${BASE}/extension-approval/v1\`)`; A:68-77 the eight body keys; A:84 the revocation predicate; A:87 `["orders-probe-001.json", "orders-probe-001.revoked.json"]` | PASS |
| C18 | lookup returns nothing for an edited, an expired, or a revoked approval, and the record for an untouched one | `lookup returns only a verified, unexpired, unrevoked approval` (A) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/extension-approval-store.test.mjs:112` - `assert.deepEqual(await store.lookup("untouched"), untouched)`; A:113-115 `edited`, `expiring` and `revoked` are each `undefined` | PASS |
| C19 | two concurrent writes leave one record; the other is refused | `two concurrent approvals for one ref leave one record` (A) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/extension-approval-store.test.mjs:131-134` - one fulfilled and one rejected, the reason `VES_EXTENSION_APPROVAL_EXISTS`, and `readdir` is `["orders-probe-001.json"]` | PASS |
| C20 | an admissible worker gives every check `pass` and exit 0 | `check passes an admissible worker` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:450` - `assert.deepEqual(data.checks.map(...), CHECK_IDS.map((id) => [id, "pass"]))`; `succeeded` asserts status 0 (E:95) | PASS |
| C21 | each of the 5 failing prerequisites fails alone, with its code and a recovery, at exit 4 | `check names each failing prerequisite` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted for all 5) | `tests/e2e/extension-cli-e2e.test.mjs:519` - `assert.equal(result.status, 4)`; E:522-526 `assert.deepEqual(failed.map(...), [[prerequisite.failing, prerequisite.code]])` over the table at E:458-507; E:527 recovery is not empty | PASS |
| C22 | only `VES_EXECUTION_GRANT_REQUIRED` passes; other codes, and an admission with no grant, fail naming the code | `only a grant-required admission passes` (K) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/extension-check.test.mjs:52` - `assert.deepEqual(passed.map(...), ROWS.map((id) => [id, "pass"]))`; K:72-78 `assertFailed` for `..._TRUST_APPROVAL`, `..._TRUST_INVALID`, `VES_SKILL_SIGNATURE_INVALID`, `VES_SKILL_UNKNOWN`; K:80-84 `VES_EXTENSION_ADMISSION_UNEXPECTED` | PASS |
| C23 | on win32, `approve` and `check` give `VES_PROBE_HOST_PLATFORM_UNSUPPORTED` and exit 5 before reading the Workspace | `approve and check refuse on win32` (K); `approve and check refuse on Windows` (E) | exit 0, 1/1; exit 0, 1/1 (POSIX: both succeed) | exit 0, 1/1; exit 0, 1/1 (refusal) | `tests/unit/extension-check.test.mjs:106-110` - `error.envelope?.code === "VES_PROBE_HOST_PLATFORM_UNSUPPORTED"`, with K:111-115 as the control (linux reads the missing Workspace); E:161-162 `refused(..., "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, ...)` | PASS |
| C24 | no worker starts during the full journey | `no worker starts during the extension commands` (E) | exit 0, 1/1 | exit 0, 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:560` - `await assert.rejects(readFile(marker), { code: "ENOENT" }, "AC 14: a worker started")`; E:570 the positive control writes the marker | PASS |
| C25 | the walk allows only the extension check module, and only admission; forbidden imports are flagged | `only the extension commands reach admission`; `the walk flags spawning imports and other modules` (G) | exit 0, 1/1; exit 0, 1/1 | exit 0, 1/1; exit 0, 1/1 | `tests/architecture/extension-host-composition.test.mjs:151` - `assert.deepEqual(findings, [])`; G:152 the single edge; G:156 `index.ts`, `framed-probe-worker.ts` and `testing.ts` unreachable; G:182 each of 7 forbidden shapes gives exactly 1 finding | PASS |
| C26 | the manifest declares the 5 commands and `vestra extension --help` names them | `the extension commands are declared and documented` (E) | exit 0, 1/1 | exit 0, 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:575` - `assert.ok(declared.includes(name))`; E:579 each `^  ${name} ` in the help text; E:582 `assert.deepEqual(json.json.data.commands, COMMANDS)` | PASS |
| C27 | a missing required flag on `add`, `approve`, `revoke` or `check` exits 2 with `VES_CLI_ARGUMENT_INVALID` | `missing flags exit 2` (E) | exit 0, 1/1 | exit 0, 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:611` - `refused(vestra(fixture, argv), "VES_CLI_ARGUMENT_INVALID", 2, label)` over 6 cases | PASS |
| C28 | `list` and `check` outside a Workspace exit 5 | `outside a Workspace the commands refuse` (E) | exit 0, 1/1 | exit 0, 1/1 | `tests/e2e/extension-cli-e2e.test.mjs:640` - `refused(run(["list"]), "VES_INIT_WORKSPACE_MISSING", 5, "list")`; E:642 `check` exits 5 (the platform code on win32) | PASS |
| C29 | `add` and `approve` without the passphrase exit 5 and write nothing | `signing commands refuse without the passphrase` (E) | exit 0, 1/1 | exit 0, 1/1 (`add` in full) | `tests/e2e/extension-cli-e2e.test.mjs:649` - `refused(add(...), "VES_TASK_NOT_CONFIGURED", 5, ...)`; E:651 lock unchanged; E:660 `approve` the same; E:662 no approval file | PASS |
| C30 | every envelope carries the fields its Surface row names | `envelopes carry their declared fields` (E) | exit 0, 1/1 | exit 0, 1/1 (`add` and `list` in full) | `tests/e2e/extension-cli-e2e.test.mjs:671` - the `add` key set; E:684 `approve`; E:695 a `list` entry; E:707 `["code","id","recovery","status"]` per `check` row; E:710 `revoke` | PASS |
| C31 | `extension-host` declares an `exports` map, and the CLI depends on it | `extension-host is an exported CLI dependency` (G) | exit 0, 1/1 | exit 0, 1/1 | `tests/architecture/extension-host-composition.test.mjs:200` - `assert.equal(host.exports["./admission"], "./src/workspace-trust.ts")`; G:202 `cli.dependencies["@verchestra/extension-host"] === "workspace:0.0.0"` | PASS |
| C32 | an expired approval fails `check` with `VES_PROBE_WORKSPACE_TRUST_APPROVAL` at exit 4 | `check fails an expired approval` (E) | exit 0, 1/1 | exit 0, 1/1 (refusal asserted) | `tests/e2e/extension-cli-e2e.test.mjs:721` - `assert.equal(result.status, 4)`; E:723-726 `[["approval", "VES_PROBE_WORKSPACE_TRUST_APPROVAL"]]`; E:719 passes before the expiry | PASS |
| C33 | `resolve` refuses a lock with no TLC entry with `VES_SKILL_TLC_REQUIRED` for a TLC-only profile | `resolve refuses a lock without TLC` (R) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/governed-skill-registry.test.mjs:165-168` - `assert.rejects(registry().resolve(profile({ grillEnabled: false, enabledSkillIds: ["tlc-spec-driven"] }), extensionOnlyLock()), (error) => error.code === "VES_SKILL_TLC_REQUIRED")`. Without the rule the profile lookup would give `VES_SKILL_UNKNOWN` (`governed-skill-registry.ts:179-182`) | PASS |
| C34 | a lock holding only a probe worker passes `planUpdate`, `activate` (1 to 2, staged and committed) and `resolveExecutableExtension` | `an extension-only lock passes updates and extension resolution` (R) | exit 0, 1/1 | exit 0, 1/1 | `tests/unit/governed-skill-registry.test.mjs:196` - `assert.equal(plan.candidateGeneration, 2)`; R:197-201 `{ activated: true, lockDigest, generation: 2 }`; R:202 `assert.deepEqual(calls, ["stage", "commit"])`; R:208 `assert.deepEqual(resolved.extensionRef, EXTENSION_REF)` | PASS |

##### Findings

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | high (blocking) | **Two existing tests fail at HEAD and pass at the base.** The five new commands are in the release manifest, but two pinned command lists were never updated. (1) The exact `--help` snapshot in `tests/e2e/cli-launchers-e2e.test.mjs:44-46`, asserted at `tests/e2e/cli-launchers-e2e.test.mjs:64`, still lists 14 commands at the old column width. Both `vestra emits the exact canonical release output for --help` and `verchestra emits the exact canonical release output for --help` fail. (2) `tests/build/sealed-launcher-closure.test.mjs:294-297` compares `report.behavior.commands` with `SEALED_COMMANDS` (`tests/build/sealed-launcher-closure.test.mjs:79-94`), but the sealed launcher now reports 19 commands (`apps/vestra-cli/src/sealed-launcher.ts:121`), so `the health report carries only honest observations of the staged closure` fails. `test:e2e` runs in `gate:full`, `gate:build`, `gate:security` and `gate:release`; `test:build` runs in `gate:build` (`scripts/gate-stages.mjs`). `validation.md` claims only `gate:quick`, `agent:check` and a selected list of suites, and that list contains neither file. The fix is the same update the builder made to `tests/contract/cli-surface.test.mjs:89-110` and `:681`: add the door-5 commands to both pinned lists. | Linux at `12f01d01`: cli-launchers fails 2/2 for the `--help` pattern, and sealed-launcher-closure fails 1 of 14 with `+ 'extension add'`, `+ 'extension approve'`... in the deepStrictEqual diff. Linux at `d069bf92`: both pass, 2/2 and 1/1. Windows at `12f01d01`: cli-launchers 15/17, with the same 2 failures |
| F2 | low | The plan's Impact row says a repeatable option "takes the next token as given", which is not true for every token. `--arg --help` is parsed as command help: it exits 0, prints help, and approves nothing. `--arg --version` is refused as the global flag. `--output` is removed before the option walk. Each outcome fails safe, but the sentence claims more than the parser does, and no check covers it. | `apps/vestra-cli/src/cli.ts:214` (`rest.includes("--help")` runs before the option walk); `apps/vestra-cli/src/cli.ts:156` (`refuseMixedVersion`); `apps/vestra-cli/src/cli.ts:135` (`extractOutput`). A parse probe at HEAD returned `command-help` for `["extension","approve","--arg","--help"]` and `VES_CLI_ARGUMENT_INVALID` (`--version`) for `--arg --version` |
| F3 | low | The CHANGELOG describes expiry wrongly. It says an approval expires after 30 days "unless `--expires` names an earlier time, at most 365 days ahead". The code accepts any instant after now and up to 365 days ahead, so a later time than 30 days is allowed. | `CHANGELOG.md:17`; `apps/vestra-cli/src/extension/extension-command.ts:76-84` |
| F4 | low (process) | An approved Surface row was rewritten instead of added to. In `e33b3516` the `vestra extension approve` row of `plan.md` gained `--confirm-stdin` and the credential flags, and a sentence was appended under the table. The tlc-spec-lean rule says Surface rows are additive and an approved row is never rewritten. The new content is additive and matches the manifest; this is for the human reviewer. | `git show e33b3516 -- .specs/features/probe-host-composition/plan.md` |
| F5 | info | The guard's failure messages no longer name #569. Check C37 of beta-release-2026-10 required them to (`.specs/features/beta-release-2026-10/checks.md:141`). Door 4 deliberately replaces that guard, and the file header still names #569. | `tests/architecture/extension-host-composition.test.mjs:151-152`; the base message was `"#569: the probe host stays uncomposed ..."` |
| F6 | info | `README.md` documents `vestra task` usage (`README.md:263-309`) but not `vestra extension`. The plan only requires help generated from the manifest, so this does not contradict it. | `README.md` |

##### Builder deviations scrutinised

- **TLC rule kept in place through a required-skill set.** Consistent with door 6. `resolve` passes `PROFILE_REQUIRED_SKILLS` (`packages/agent-runtime/src/skills/governed-skill-registry.ts:176`) before it reads the profile. `resolveExecutableExtension`, `planUpdate` and `activate` pass `NO_REQUIRED_SKILLS` (`:237`, `:265-266`, `:287`). The rule stays ahead of the digest check (`:361-364`). No other caller of `#validateLock` exists. The existing case `lock rejects invalid missing TLC` (`tests/unit/governed-skill-registry.test.mjs:107-112`) is unchanged and passes: R ran 24/24 on Windows.
- **`SkillLock.signature` and `source.signature` widened to `unknown`.** This is a type-only change. `#validateLock` never checked the signature's type at runtime. The only production verifier is `workspaceLockVerifier` (`apps/vestra-cli/src/extension/skill-lock-file.ts:204-215`), and C6 proves it decides.
- **`--version` is a command option only when the command declares it.** `refuseMixedVersion` (`apps/vestra-cli/src/cli.ts:156-160`) keeps the global-flag refusal for every other command. The new cli-surface test asserts that `extension list --version` is refused. 57/57 passed on both platforms.
- **`exports` map with `./admission`.** C31, and G:154-156 show that the admission edge never loads `index.ts`, `framed-probe-worker.ts` or `testing.ts`. A repo-wide search finds no other deep import of `@verchestra/extension-host/...` that the new map would break.
- **New DSSE predicate types.** Three entries were appended to `PREDICATE_TYPES_V1` (`packages/evidence/src/integrity/dsse.ts:37-39`); no existing entry changed. No test pins the predicate set.
- **`assertProbeWorkerEnvironment` extracted.** The behavior is the same. The name and value rules are unchanged, and the base names come from the same `baseEnvironment` (`packages/platform-node/src/spawned-probe-worker.ts:102-138`). On Linux at HEAD, `tests/integration/spawned-probe-worker.test.mjs` passed 13/13 and `tests/security/probe-workspace-trust-security.test.mjs` 34/34.
- **`complexity-baseline.json` lowered or removed.** Every change lowers the ratchet: `runCli` dropped out and two `cli.ts` values went down. `node scripts/complexity.mjs check` passes on Windows ("nothing above 10 unaccounted"), and so does the complexity stage of Linux `gate:quick`.
- **`pnpm-lock.yaml`.** The only change is the 3-line workspace link of `@verchestra/extension-host` into `apps/vestra-cli`. No other dependency changed.
- **`tests/contract/cli-surface.test.mjs`, `slice(6)` changed to a filter on `task `.** The set is identical. At the base, `slice(6)` of the 14-command manifest was exactly the 8 task commands, `task check` through `task review`. At HEAD the filter on `task ` yields the same 8 in the same order (`tests/contract/cli-surface.test.mjs:220-233`). The positional property that `slice(6)` implied is still pinned by the full ordered 19-name list (`:88-110`). The count went from 14 to 19 (`:681`), which matches exactly the five added commands. No assertion was weakened.
- **Other test edits.** `tests/unit/governed-skill-registry.test.mjs` is additions only (+74/-0). `tests/fixtures/probe-workers/reference-worker.mjs` only adds the opt-in start marker; without the variable the worker behaves as before. The guard rewrite in G is door 4's authorized change, and its positive control was widened from 1 case to 7. No `.skip`, `.only` or `todo` was added.
- **Secrets, local paths, generated files.** Searching the diff found no machine-local paths, home directories, tokens or keys. The fixture origin `https://fixture-user:fixture-token@example.invalid/...` is a fake test value, and E:203-204 asserts it never reaches the lock. `docs/canonical-json-census.json` gained 4 reviewed rows; their signals match a live scan, since `tests/security/canonical-json-census.test.mjs` passes 14/14. No file under `packages/contracts` or any other generated contract changed.

##### Level and sampling gaps

- **C19.** The proof races two writers inside one process (`Promise.allSettled`), not two processes. The mechanism is an OS-level exclusive `link()` (`apps/vestra-cli/src/extension/extension-approval-store.ts:171-183`), so separate processes should behave the same, but the proof samples one.
- **C24.** The start marker only fires if the approved environment reaches a spawned worker. A spawn path that dropped that environment would not be seen. The static guard (C25) is the complementary proof.
- **C5 on Windows.** The file-link case is POSIX only, because it needs Developer Mode. Windows covers the directory junction.
- **C17.** C17's own proof chooses the directory itself. That the directory sits under `<Workspace state>` is proven by the E helper path (E:70), read at E:296 in C9.
- **C2 and C3.** Both are proven at the store and registry layer, as checks.md says. The `add` command's own signatures are verified end to end at E:207-211 (C1).
- **Precision gaps in checks.md.** The claims of C5, C12, C16 and C21 name exit codes but not the error codes. The tests freeze them: `VES_EXTENSION_ENTRY_INVALID`, `VES_EXTENSION_APPROVAL_EXISTS`, `VES_EXTENSION_APPROVAL_NOT_FOUND` and `VES_EXTENSION_APPROVAL_REVOKED`, plus the five codes in the E:458-507 table. They are pinned only in the tests, not in the obligation.
- **Observed although outside `light`.** The second half of AC 15 (`check` fails an approval file edited after signing with `VES_PROBE_WORKSPACE_TRUST_APPROVAL`) has no direct proof. It follows from C18 (the lookup returns nothing) and C21 (an absent approval gives that code), but no journey runs `check` against an edited approval file.
- **macOS.** Not run.

##### Swept existing

- **AD-040 typed-back confirmation (C11).** Present at `apps/vestra-cli/src/task/task-confirm.ts:45-61`; it refuses with `VES_TASK_CONFIRMATION_REQUIRED`. `approve` calls it at `apps/vestra-cli/src/extension/extension-approve.ts:78`.
- **Passphrase from the existing secret store (C29).** `SIGNING_PASSPHRASE` and `readCredentials` are at `apps/vestra-cli/src/task/task-credentials.ts:19` and `:96`.
- **Registry stages and rolls back (Observable, `add` fails halfway).** `packages/agent-runtime/src/skills/governed-skill-registry.ts:291-298` stages, commits, and on any error rolls back with `VES_SKILL_ACTIVATION_ROLLED_BACK`.
- **The generation only increases (Relations).** `packages/agent-runtime/src/skills/governed-skill-registry.ts:267-268` throws `VES_SKILL_UPDATE_GENERATION`.
- **Key purposes cannot change.** `EVIDENCE_PURPOSES` is at `apps/vestra-cli/src/task/task-signing.ts:14`.
- **`n/a` rows.** Observability and deletion are approved policy, so there is nothing to check in the code.

##### Coverage, Test policy, faults

- **Coverage.** Not recomputed. Under `light` the join is read, not recomputed; that recompute is `standard`.
- **Test policy.** checks.md has no `Test policy` section.
- **Faults injected.** None, since fault injection is not part of `light`. The three mutations validation.md reports are the builder's own and were not re-run.
- **Binding sources.** None: not a `ui` profile, and the plan marks no binding source.

##### Gate

- **Linux, `corepack pnpm gate:quick` at `12f01d01`.** PASS: format, lint, complexity and typecheck, then `test:unit` 3215 passed / 0 failed / 0 skipped, `test:agent-readiness` 413 / 0 / 0, `test:census` 14 / 0 / 0.
- **Linux, targeted suites at `12f01d01`.** `node --test tests/architecture/*.test.mjs` 146/146. `tests/contract/cli-surface.test.mjs` 57/57. `tests/contract/skill-update-lifecycle.test.mjs` 12/12. `tests/security/skill-executable-content-security.test.mjs` 12/12. `tests/e2e/secret-cli-e2e.test.mjs` 5/5. `tests/build/sealed-launcher-closure.test.mjs` 13 passed and **1 failed (F1)**. `tests/e2e/cli-launchers-e2e.test.mjs` `--help` cases: **2 failed (F1)**.
- **Windows, targeted suites at `12f01d01`.** `tests/contract/cli-surface.test.mjs` 57/57. `tests/unit/governed-skill-registry.test.mjs` 24/24. `tests/security/canonical-json-census.test.mjs` 14/14. `node scripts/complexity.mjs check` PASS. `tests/e2e/cli-launchers-e2e.test.mjs` 15 passed and **2 failed (F1)**.
- **Proofs.** 36/36 invocations passed on Linux and 36/36 on Windows, each with exactly 1 named test passing.

##### Not verified

- macOS: no host.
- Full runs of `test:e2e`, `test:build`, `test:contract`, `test:integration`, `test:security`, `gate:full` and the load proofs were not run locally, as the brief instructed. Other pinned-surface regressions beyond F1 can therefore not be ruled out; CI is the sensor for those.
- Lesson distillation (verify.md step 7) was not written, because this run's only permitted write is this report. Suggested lesson for the orchestrator to record: when a change adds a command to the release manifest, update every pinned command list (the cli-surface manifest list and count, the cli-launchers `--help` snapshot, and the sealed-launcher `SEALED_COMMANDS`), and run `test:e2e` and `test:build` for that surface, not only `gate:quick`.

##### Route back

Fix F1 by adding the five `extension` commands to the pinned `--help` snapshot (`tests/e2e/cli-launchers-e2e.test.mjs:44-46`) and to `SEALED_COMMANDS` (`tests/build/sealed-launcher-closure.test.mjs:79-94`). Then re-verify in round 2, scoped to that diff, with every proof re-run at the new HEAD. F2 and F3 are one-line corrections to the plan's Impact wording and to the CHANGELOG.
