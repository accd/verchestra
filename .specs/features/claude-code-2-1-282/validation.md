# Claude Code 2.1.282 fleet pin and PR #433 scan hygiene validation

**Date:** 2026-09-30
**Diff:** `feat/405-governed-task-foundations`, PR #433
**Verifier:** primary agent local verification; GitHub required checks and SonarCloud remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| CC-01 | `.github/workflows/ci.yml:50`, `full-validation.yml:121`, `platform-matrix.yml:194`, `t76-candidate-build.yml:133` install `2.1.282` and verify the exact version; `apps/site/tests/unit/pages-workflow.test.mjs:15`, `:17` assert it; `.specs/features/platform-qualification-matrix/matrix.md` section 4 lists it | PASS locally |
| CC-02 | `spikes/claude-code-driver/test/claude-driver.test.mjs:46` pins the live probe to `2.1.282` with the `2.1.168` floor; `:82`-`:96` discriminate drift; `:54` reads every T03 flag and `dontAsk` from `--help` | PASS locally |
| CC-03 | `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:239` checks every mediated flag; `:265` asserts `VES_CLAUDE_VERSION_UNSUPPORTED` below the minimum; `:256` fails the fleet on a low pin; `:287` covers the version comparison. A simulated `2.1.168` on PATH takes the refusal branch and fails under `VES_REQUIRE_PINNED_PROVIDERS=1` | PASS locally |
| CC-04 | `docs/qualification/claude-code-driver-2.1.282.md`; `claude-code-driver.md` unchanged | PASS |
| CC-05 | `tests/unit/mcp-bridge-logical-path.test.mjs:43`-`:49` compares 299,593 inputs with the replaced pattern; `:52` pins segments and codes; `:64`-`:75` bound 100,000-separator inputs | PASS locally |
| CC-06 | `tests/contract/task-request.test.mjs:131`-`:140` compares 66,434 arguments with the schema pattern | PASS locally |
| CC-07 | `spikes/claude-code-driver/test/fake-claude-mediated.mjs:25`, `:119`-`:129`, `:222`; `claude-driver-mediated.test.mjs:103` proves the brokered credential by exact redaction under an ambient credential | PASS locally |
| CC-08 | `tests/helpers/system-git.mjs:6`-`:16`; `tests/helpers/worktree-tool-fixture.mjs:18` | PASS locally |

## External verification

Quality, Site, CodeQL, and SonarCloud must pass on the exact pushed head. No
production-readiness claim is made.
