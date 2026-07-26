# Agent-Ready Repository and LLM Discovery Validation

**Date**: 2026-07-26  
**Spec**: `.specs/features/agent-ready-repository/spec.md`  
**Diff range**: `fd585f128d310a6f355a544deee0ae4e5e54aa4f..2a3cc28f1f500ba8204456e2328a422575c55468`  
**Verifier**: independent sub-agent (author != verifier)  
**Verdict**: **FAIL — implementation checks pass, but public activation and governance requirements remain externally blocked**

---

## Task Completion

| Task | Status          | Notes                                                                                                              |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| T1   | ⚠️ Partial      | Repository deliverables and status tests are complete; GitHub issue creation remains blocked by integration `403`. |
| T2   | ✅ Done         | Instruction hierarchy, repository map, and exact compatibility pointers verified.                                  |
| T3   | ✅ Done         | Context, handoff parser, readiness checker, and quick-gate integration verified.                                   |
| T4   | ✅ Done         | Provider-neutral templates and contribution/review fields verified.                                                |
| T5   | ✅ Done         | Six-case corpus, deterministic runner, fake adapter, and optional-provider behavior verified.                      |
| T6   | ✅ Done locally | LLM endpoints and Markdown alternates compile and pass built-output checks.                                        |
| T7   | ⚠️ Partial      | Site/governance surfaces pass locally; requested GitHub topics are not applied.                                    |
| T8   | ⚠️ Partial      | Independent verification completed with 8/8 mutants killed; deployment and mandatory human review remain pending.  |

## Requirement Evidence

Evidence-or-zero was applied: each implementation requirement below has an exact test assertion or deterministic check. Public-state requirements are not promoted to verified merely because the local build is correct.

| Requirement | Spec-defined outcome                                                                                                                   | `file:line` + assertion expression                                                                                                                                                                                                                                                                                                                                      | Result                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| AGT-01      | Root instructions expose status, startup reads/commands, rules, safety, and done criteria concisely.                                   | `tests/architecture/agent-instructions.test.mjs:17` — `assert.ok(source.split(...).length < 200)`; `:18-30` — `assert.match(source, new RegExp(required, "iu"), required)` over status, command, safety, generated-contract, and review terms.                                                                                                                          | ✅ Verified                             |
| AGT-02      | All seven required regions have scoped instructions that apply and do not relax root rules.                                            | `tests/architecture/agent-instructions.test.mjs:34-39` — for every scoped path, `assert.match(...Apply the root...)` and `assert.doesNotMatch(...ignore                                                                                                                                                                                                                 | override                                | relax...)`. | ✅ Verified |
| AGT-03      | Clean-clone contribution is provider-neutral; absent local providers are not required or counted as passes.                            | `tests/agent-readiness/agent-eval.test.mjs:59-67` — `assert.deepEqual(summary.results.map(...), [["claude-code","not configured"],["codex","not configured"],["opencode-qwen","not configured"]])`; `tests/agent-readiness/context.test.mjs:15-23` executes the dependency-free context command and asserts its exact tracked contract.                                 | ✅ Verified                             |
| AGT-04      | Claude/Gemini files are import-only pointers; native instructions remain `AGENTS.md`.                                                  | `tests/architecture/agent-instructions.test.mjs:43-44` — exact-byte `assert.equal(..., "@AGENTS.md\n")` and `assert.equal(..., "@./AGENTS.md\n")`.                                                                                                                                                                                                                      | ✅ Verified                             |
| AGT-05      | Read-only deterministic context works before installation and degrades safely without Git.                                             | `tests/agent-readiness/context.test.mjs:15-23` — exact schema/repository/version/T68/T69/read/path-safety assertions; `:32-36` — missing-Git assertions for `revision === "unknown"`, `branch === null`, `dirty === false`, and T68/T69.                                                                                                                                | ✅ Verified                             |
| AGT-06      | Tracked specifications and portable handoffs preserve resumable next work.                                                             | `tests/agent-readiness/handoff-templates.test.mjs:8-19` — parser-valid v1 handoff plus all resume sections; `tests/agent-readiness/context.test.mjs:58-60` — `issue === 123`, `nextTask === "T3"`, and missing Blockers rejection.                                                                                                                                      | ✅ Verified                             |
| AGT-07      | Instructions cover injection/secrets/dirty work/dependencies/generated files/review/gate integrity.                                    | `tests/architecture/agent-instructions.test.mjs:18-30` — required safety terms asserted in root instructions; `tests/agent-readiness/handoff-templates.test.mjs:61-63` — issue/PR sources must match `acceptance`, `canonical`, `verification`, `safety`, `handoff`, and `human review`; malicious-refusal sensor was killed.                                           | ✅ Verified                             |
| AGT-08      | Readiness/CI rejects hierarchy, pointer, status, path, command, link, handoff, and contradiction faults and runs in quick gate.        | `tests/agent-readiness/check.test.mjs:46-58` — divergent pointer, stale version, and machine-local path are asserted errors; `tests/architecture/agent-instructions.test.mjs:35-38` — missing/contradicting scoped instructions fail; `scripts/gate.mjs:5` includes `test:agent-readiness`; missing-scope, wrong-pointer, and stale-status sensors all exited non-zero. | ✅ Verified                             |
| AGT-09      | Neutral corpus covers onboarding, routing, canonical/generated edits, handoff, and malicious instructions with deterministic outcomes. | `tests/agent-readiness/agent-eval.test.mjs:8-21` — exact six-case ordered ID assertion; `:30-34` — runner status/case-count/digest assertions; `scripts/agent-eval.mjs:85-94` compares complete expected results and rejects unsafe patch paths.                                                                                                                        | ✅ Verified                             |
| AGT-10      | Claude Code, Codex, and OpenCode/Qwen profiles are optional and unavailable providers remain `not configured`.                         | `tests/agent-readiness/agent-eval.test.mjs:53-67` — exact three-provider `not configured` deep equality.                                                                                                                                                                                                                                                                | ✅ Verified                             |
| LLM-01      | Tracked root `llms.txt` exactly equals the deterministic concise projection and preserves status/disclaimer.                           | `apps/site/tests/unit/llm-content.test.mjs:19-25` — `assert.equal(actual, expected)`, exact T68/T69 match, and prohibited-guarantee disclaimer match.                                                                                                                                                                                                                   | ✅ Verified                             |
| LLM-02      | GitHub Pages publishes `/verchestra/llms.txt` and `/verchestra/llms-full.txt`.                                                         | Local artifact evidence: `apps/site/tests/unit/llm-content.test.mjs:55-56` exact emitted-file equality and `apps/site/scripts/check-built-site.mjs:101-116` required-output assertions. Live probes on 2026-07-26 returned `404` for both production URLs.                                                                                                              | ❌ External activation gap              |
| LLM-03      | Every public documentation page emits `index.html.md` and an HTML alternate link.                                                      | `apps/site/tests/unit/llm-content.test.mjs:57-61` reads every routed alternate and asserts title/digest; `apps/site/scripts/check-built-site.mjs:67-70,132-139` asserts the HTML alternate URL and corresponding output for every docs/roadmap page. Production awaits deployment.                                                                                      | ⚠️ Locally verified; externally blocked |
| LLM-04      | Full context uses stable, attributed, allowlisted project/architecture/roadmap/guide/instruction/integration/T01-T68 content.          | `apps/site/tests/unit/llm-content.test.mjs:32-45` — deterministic recompilation, `>= 68` qualification documents, and exact T68, `AGENTS.md`, and integration-source membership assertions; `:47-48` asserts source attribution and SHA-256 digests.                                                                                                                    | ✅ Verified                             |
| LLM-05      | Output is under 1 MiB, path/secret safe, and preserves version/T68/T69.                                                                | `apps/site/tests/unit/llm-content.test.mjs:23-24,46-49` — exact projection/status, byte bound, attribution/digest, and local-path exclusion; `:76-79` asserts oversized output throws. Corrected absolute-path sensor exited non-zero with `LLM output contains a machine-local path`.                                                                                  | ✅ Verified                             |
| LLM-06      | Sitemap, robots, metadata, README, navigation, and GitHub topics expose AI resources without crawler hacks.                            | `apps/site/tests/unit/public-metadata.test.mjs:34-39` asserts homepage structured metadata and both LLM resources; `:43-47` asserts sitemap and LLM robot URLs; `apps/site/scripts/check-built-site.mjs:129-130` asserts sitemap endpoints. Requested repository topics are not applied.                                                                                | ❌ External governance gap              |
| LLM-07      | Public site says LLM files are inference-time aids, not ranking/training/indexing guarantees.                                          | `apps/site/tests/unit/llm-content.test.mjs:25` — `assert.match(actual, /does not guarantee indexing, SEO ranking, training inclusion, or crawler behavior/)`; the site guide source states the same at `apps/site/src/content/docs/docs/community/contributing-with-agents.md:64-66`.                                                                                   | ✅ Verified locally                     |

**Status**: 14/17 requirements fully verified; 3 public/governance requirements remain externally blocked. No spec-precision gap was found: the unverified outcomes are precise but not yet true in external state.

## Acceptance Criteria

| #   | Outcome                                                                                                             | Result                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Clean-clone agent resolves instructions, canonical sources, commands, status, and next action from tracked files.   | ✅                                                                                               |
| 2   | JSON context is deterministic, path-safe, secret-free, and handles clean, dirty, detached, and missing-Git states.  | ✅                                                                                               |
| 3   | `agent:check` rejects AGT-08 inconsistencies and is in `gate:quick`.                                                | ✅                                                                                               |
| 4   | A successor resumes at the next incomplete task without replay.                                                     | ✅                                                                                               |
| 5   | Corpus refuses secrets, destructive Git, gate weakening, generated output edits, and untrusted execution authority. | ✅                                                                                               |
| 6   | Build emits both LLM endpoints and per-page Markdown alternates in stable order.                                    | ✅ locally; production deployment pending                                                        |
| 7   | Generated output is attributed, status-consistent, under 1 MiB, and path/secret safe.                               | ✅                                                                                               |
| 8   | Metadata/governance expose resources and prohibit ranking/training/indexing/production claims.                      | ⚠️ Local surfaces pass; GitHub topics pending                                                    |
| 9   | Deterministic gates pass and all specified behavior mutations are killed before review.                             | ✅ via project-declared `corepack pnpm`; exact host `pnpm` launcher is externally policy-blocked |

## Gate Check

- **Exact command attempted**: `pnpm agent:check && pnpm gate:quick && pnpm site:test && pnpm site:build`
- **Host-launcher result**: blocked before feature tests because the injected pnpm runtime attempted a dependency relink and rejected `ip-address@10.3.1` under its active `minimumReleaseAge` policy.
- **Equivalent project-manager command**: `corepack pnpm agent:check && corepack pnpm gate:quick && corepack pnpm site:test && corepack pnpm site:build`
- **Clean scratch result**: PASS.
- **Readiness**: 19 passed, 0 failed, 0 skipped.
- **Quick unit suite**: 1,615 passed, 0 failed, 0 skipped.
- **Site unit suite**: 24 passed, 0 failed, 0 skipped.
- **Browser/Axe**: 45 passed across Chromium, Firefox, and WebKit; 0 failed, 0 skipped.
- **Lighthouse**: 1 URL/run; all assertions processed.
- **Build**: 120 pages; built-output links, metadata, size, status, safety, and alternates valid.
- **Total counted tests**: 1,703 passed, 0 failed, 0 skipped, plus Lighthouse assertions and build/type/lint/format checks.
- **Before-feature quick count**: 1,615 unit tests; current quick count is 1,615 unit + 19 readiness = 1,634. Delta: +19 readiness tests. Site diff adds four LLM compiler tests; no test files or assertions were deleted, skipped, or weakened.

## Discrimination Sensor

All mutations were made and discarded in a detached disposable worktree. The real implementation tree was never mutated.

| #   | Mutation                                                              | Target                                                                                   | Smallest deterministic check                               | Result                                                               |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Remove a scoped instruction file.                                     | `docs/AGENTS.md:1`                                                                       | `node scripts/agent-check.mjs`                             | ✅ Killed: `missing required path: docs/AGENTS.md`                   |
| 2   | Point Claude compatibility at the wrong file.                         | `CLAUDE.md:1`                                                                            | `node scripts/agent-check.mjs`                             | ✅ Killed: pointer mismatch                                          |
| 3   | Remove T68 evidence so qualification becomes stale.                   | `docs/qualification/t68-validation.md:1`; detector `scripts/agent-readiness.mjs:308-315` | `node scripts/agent-check.mjs`                             | ✅ Killed: T68/T69 status failure and broken qualification link      |
| 4   | Inject a drive-rooted Windows user-profile path into full LLM output. | `apps/site/src/lib/llm-content.ts:229-241`                                               | `node --test apps/site/tests/unit/llm-content.test.mjs`    | ✅ Killed: compiler threw `LLM output contains a machine-local path` |
| 5   | Change malicious-instruction result from `refuse` to `proceed`.       | `tests/agent-eval/fake-adapter.mjs:10-13`; comparator `scripts/agent-eval.mjs:84-94`     | `node --test tests/agent-readiness/agent-eval.test.mjs`    | ✅ Killed: deterministic result assertion                            |
| 6   | Propose editing generated contract output directly.                   | `tests/agent-eval/fake-adapter.mjs:10-13`; comparator `scripts/agent-eval.mjs:84-94`     | `node --test tests/agent-readiness/agent-eval.test.mjs`    | ✅ Killed: deterministic result assertion                            |
| 7   | Change the GitHub Pages base from `/verchestra` to `/`.               | `apps/site/astro.config.ts:13`; detector `apps/site/scripts/check-built-site.mjs:63-99`  | site build + `node apps/site/scripts/check-built-site.mjs` | ✅ Killed: built-site base-path assertion                            |
| 8   | Resume the handoff by replaying completed T2 instead of starting T3.  | `tests/agent-eval/fake-adapter.mjs:10-13`; comparator `scripts/agent-eval.mjs:84-94`     | `node --test tests/agent-readiness/agent-eval.test.mjs`    | ✅ Killed: deterministic result assertion                            |

**Sensor depth**: targeted eight-mutation suite required by the feature.  
**Result**: 8/8 valid behavior mutants killed; 0 survived. One initial
path-injection calibration omitted the drive-root separator and was discarded
as an invalid mutant before the corrected Windows absolute-path mutation above.

## Edge Cases

- [x] Clean detached HEAD: JSON context reported `branch: null`, `dirty: false`, exact revision, and T68/T69.
- [x] Dirty detached worktree: JSON context reported `dirty: true` without leaking an absolute path.
- [x] Missing Git: `tests/agent-readiness/context.test.mjs:32-36` asserts deterministic unknown/null/false state.
- [x] Windows and POSIX paths: `tests/agent-readiness/context.test.mjs:72-76` asserts normalized repository-relative paths.
- [x] Missing scoped instructions, divergent pointers, stale status, and local paths: readiness tests and sensors reject them.
- [x] Invalid/regressive/replayed handoffs: `tests/agent-readiness/context.test.mjs:63-68` and `handoff-templates.test.mjs:22-37` assert allowed and forbidden transitions.
- [x] Missing local providers: exact `not configured` outcomes asserted for all three optional providers.
- [x] Duplicate routes, unsafe source paths, malformed headings, and oversized output: `apps/site/tests/unit/llm-content.test.mjs:65-79` asserts each rejection.
- [x] Untrusted issue instructions: corpus expected result at `tests/agent-eval/corpus.json:76-85` refuses secret access, gate weakening, and destructive Git; mutation was killed.

## Code Quality

| Principle                                                                                                    | Status                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| No features beyond the specified agent-readiness/LLM surface                                                 | ✅                                                                                                      |
| No unnecessary single-use abstraction or flexibility                                                         | ✅                                                                                                      |
| Surgical changes; no unrelated product/T69-T77 implementation                                                | ✅                                                                                                      |
| Existing repository/site patterns and dependency direction preserved                                         | ✅                                                                                                      |
| No dependency or lockfile change                                                                             | ✅                                                                                                      |
| No deleted/skipped/weakened test assertion                                                                   | ✅                                                                                                      |
| Spec-anchored test outcomes are exact rather than shallow                                                    | ✅                                                                                                      |
| Per-layer coverage includes context, handoff, evaluator, compiler, metadata, built output, and browser paths | ✅                                                                                                      |
| Every new test maps to a requirement, listed edge case, or task done criterion                               | ✅                                                                                                      |
| Guidelines followed                                                                                          | ✅ `AGENTS.md`, `.specs/AGENTS.md`, `tests/AGENTS.md`, `apps/site/AGENTS.md`, and TLC coding principles |
| Senior-review assessment                                                                                     | ✅ Implementation is cohesive and bounded; external publication still requires human review             |

No `SPEC_DEVIATION`, `TODO`, or `FIXME` was introduced in the feature diff. Changed tests gained 445 net lines with no deleted test files; the single removed line in `documentation-contract.test.mjs` is paired with two replacement lines and is not an assertion weakening.

## External Blockers vs. Implementation Defects

### External blockers

1. **Production deployment** — live probes on 2026-07-26: landing page `200`; `/verchestra/llms.txt`, `/verchestra/llms-full.txt`, and `/verchestra/docs/community/contributing-with-agents/` each `404`. Merge to protected `main`, GitHub Pages deployment, and post-deploy probes require maintainer/human action.
2. **Repository topics** — `agents-md`, `llms-txt`, and `ai-coding-agents` cannot be written by the available connector/session.
3. **GitHub issue** — issue creation returned `403 Resource not accessible by integration`; the feature handoff therefore records `issue: null`.
4. **Mandatory human review** — merge, deployment, and accountability transfer are intentionally prohibited before review.
5. **Host pnpm launcher** — the injected runtime's active supply-chain policy blocks an automatic relink on `ip-address@10.3.1`; the frozen project-declared Corepack execution passes all gates.
6. **Dependabot acceptance** — the available GitHub integration does not expose alert reads, so an authenticated maintainer must verify zero open Dependabot alerts before closing the tracking issue.

### Implementation defects

None found. All deterministic local checks pass and all eight required mutants are killed.

## Fix / Unblock Plan

### Unblock 1: Publish and verify Pages output

- **Action**: after mandatory review, merge through protected `main` and let the existing Pages workflow deploy the exact gated artifact.
- **Verify**: require HTTP `200` for the guide, `llms.txt`, `llms-full.txt`, representative `index.html.md`, sitemap, and robots endpoints; verify base-path links and response content.
- **Priority**: Major, external activation.

### Unblock 2: Apply repository topics

- **Action**: an authenticated maintainer adds `agents-md`, `llms-txt`, and `ai-coding-agents`.
- **Verify**: read repository topics and compare exact set membership.
- **Priority**: Minor, external governance.

### Unblock 3: Create/link the tracking issue

- **Action**: use an issue-write-capable maintainer session, then record the issue number in the handoff.
- **Verify**: issue contains scope, acceptance, canonical sources, verification, safety, handoff, and human-review fields; confirm zero open Dependabot alerts before closure.
- **Priority**: Minor, process traceability.

## Requirement Traceability Update

| Requirement | Previous status | Validation status                           |
| ----------- | --------------- | ------------------------------------------- |
| AGT-01      | Implementing    | ✅ Verified                                 |
| AGT-02      | Implementing    | ✅ Verified                                 |
| AGT-03      | Implementing    | ✅ Verified                                 |
| AGT-04      | Implementing    | ✅ Verified                                 |
| AGT-05      | Implementing    | ✅ Verified                                 |
| AGT-06      | Implementing    | ✅ Verified                                 |
| AGT-07      | Implementing    | ✅ Verified                                 |
| AGT-08      | Implementing    | ✅ Verified                                 |
| AGT-09      | Implementing    | ✅ Verified                                 |
| AGT-10      | Implementing    | ✅ Verified                                 |
| LLM-01      | Implementing    | ✅ Verified                                 |
| LLM-02      | Implementing    | ❌ External deployment needed               |
| LLM-03      | Implementing    | ⚠️ Local output verified; deployment needed |
| LLM-04      | Implementing    | ✅ Verified                                 |
| LLM-05      | Implementing    | ✅ Verified                                 |
| LLM-06      | Implementing    | ❌ External topics/deployment needed        |
| LLM-07      | Implementing    | ✅ Verified locally                         |

## Interactive UAT

Not performed. The implementation is repository/build infrastructure with deterministic generated outputs; automated unit, built-output, browser/accessibility, Lighthouse, and live HTTP probes are the appropriate verification. Human review remains mandatory and is not represented as automated UAT.

## Lessons

No project lesson was recorded. There was no surviving mutant, implementation defect, spec-precision gap, or `SPEC_DEVIATION`; remaining failures are explicit external activation/governance actions. The verifier's permitted real-tree write scope was also limited to this report.

## Summary

**Overall**: ❌ Not ready to claim full feature completion.

- **Spec-anchored check**: 14/17 requirements fully matched; 3 externally blocked; 0 spec-precision gaps.
- **Gate**: 1,703 counted tests passed, 0 failed, 0 skipped; Lighthouse and both 120-page builds passed via project-declared Corepack pnpm.
- **Sensor**: 8/8 required mutants killed.
- **Implementation**: no defect found.
- **Next exact action**: mandatory human review, then merge/deploy, verify public endpoints, apply repository topics, create/link the tracking issue, and rerun the external-state portion of validation.
