# Architecture deepening, second round: validation for T2 (candidate evidence writers)

**ADR2-2.** The files a candidate build writes SHALL be written by a tested
module whose shapes the readers share, and the bytes SHALL be identical to the
inline scripts' for the same inputs.

No workflow was dispatched, and nothing was signed, uploaded or published. No
key was read. The artifacts of three candidate runs were downloaded read-only
(`gh run download`) into an ignored scratch directory, replayed, and deleted.

The three inline programs wrote three files, and only these:
`gate-evaluations.json` (`.github/workflows/t76-candidate-build.yml` at
`23f29e1`, lines 161-193), `target-build-evidence.json` (232-254) and
`t76-target-index.json` (298-335). `build-info.json` is written by
`scripts/t76-build-candidate.mjs`; the target evidence binds it by digest, so
its record and digest rule move into the module too.

## 1. Byte identity

### 1.1 The published candidates, replayed byte for byte

For each candidate run below, `node tests/helpers/t76-inline-evidence-writers.mjs replay`
re-sealed, for every target, `gate-evaluations.json` from the run's five gate
logs and `target-build-evidence.json` from the run's `bundle.json`,
`build-info.json` and `gate-evaluations.json`, then reconciled the five
evidence files into an index. It did so once with the inline programs and once
with the module, and compared each result with the file the run uploaded.

| Candidate | Revision | Candidate run | Index digest | Inline programs | Module |
| --- | --- | --- | --- | --- | --- |
| `0.0.0-qualification.3` | `6725554a8e14aba44a0dcdb9edf76decc58ac4d2` | `36781862073` | `sha256:8de4a183dc3943424f864e15c2052ab073c46f5cd406f3225420a5f41fae4d66` | 11 of 11 identical | 11 of 11 identical |
| `0.0.0-qualification.4` | `d58a25f3d80a720000bbdd4cbbc8650cdc8c9686` | `36928077854` | `sha256:8e3aaa590d9b2b1f3e900e37a35ed800f7dee7ed1cb71ffd8ef85d831afc85b1` | 11 of 11 identical | 11 of 11 identical |
| `0.0.0-qualification.5` | `e17abb3c8970b72c837bbbd07f86b4676ca9adb3` | `37017865729` | `sha256:a1dfbc762326d4c114e5874e8aa8c9f6c476ba37524169bc8aa49680b6d30847` | 11 of 11 identical | 11 of 11 identical |

Eleven files per run: five `gate-evaluations.json`, five
`target-build-evidence.json` (`win32-x64` among them) and the index. The
module reproduces all 33 sealed files of the three published candidates.

### 1.2 The golden tests

The reference is
`tests/fixtures/t76-inline-evidence-writers/t76-candidate-build-23f29e1.yml.txt`,
the output of `git show 23f29e1:.github/workflows/t76-candidate-build.yml`. Its
sha256 is `8a58f96f5c9f596eed033cab15536ae482c91e560f605bbfd02b2c293ccf854c`,
pinned at `tests/helpers/t76-inline-evidence-writers.mjs:37` and asserted at
`tests/build/t76-candidate-evidence-golden.test.mjs:174`. The three program
bodies have not changed since `51e6390` (2026-08-25), before any published
candidate was built. Each program is its heredoc body with the run block's
indentation removed (`heredocBody`, helper `:66`). The one edit at run time is
its import of the domain encoder, which named the candidate checkout relative
to the job's directory and now names the same file of this repository
(`inlineProgram`, helper `:82`, which also asserts the import occurs once).

| Test | Shows |
| --- | --- |
| `t76-candidate-evidence-golden.test.mjs:178` | The programs and the module's `seal-gate`, run in turn on the same five gate logs, leave identical `gate-evaluations.json` bytes after every gate: `win32-x64` with CRLF logs, `linux-x64` with LF logs, and a run whose `full` and `release` gates fail (sealed as `fail`). The logs carry two suite summaries each, non-zero skipped and todo counts, and a decoy `info tests` line. |
| `:198` | For all five targets, `seal-target` and the program write identical `target-build-evidence.json` over the same real hermetic bundle, build-info (canonical, no final line feed, as the builder writes it) and gate seal; `reconcile` and the program write an identical `t76-target-index.json` over artifact directories created in reverse order, with a logs-only artifact and a stray file beside them. |
| `:220` | Both refuse, and neither writes an index, for a missing target, a target bound to another revision, a target outside the fleet, a target sealed twice, and evidence that is not JSON. |
| `:247` | Both refuse a gate whose log carries no assertion and a malformed seal file, and leave the seal file as it was. |
| `:265` | Both refuse to seal target evidence without a build output. |
| `:275` | The replay passes on a run laid out as `gh run download` leaves it, the index artifact included, and fails, naming the one file, when a gate log no longer reproduces its seal. |

`tests/build` runs in `gate:build` and `gate:release`, so the platform matrix
runs the comparison on Windows, macOS and Linux hosts.

### 1.3 Where the module refuses and the programs wrote

The module writes the programs' bytes or refuses. These are the inputs where
the programs wrote and the module refuses. None is reachable from the
workflow: the builder records the requested target only when it equals the
host and the running Node, the verify step pins Node `v24.14.0`, and bash
hands over `${PIPESTATUS[0]}`.

| Input | Inline program | Module | Test |
| --- | --- | --- | --- |
| Build output records another Node version, platform or architecture than the job asked for | wrote the job's target, with the typed `24.14.0` | `VES_T76_EVIDENCE_TARGET_MISMATCH` | `t76-candidate-evidence.test.mjs:295` |
| Build output records another revision, release id or version | wrote the dispatch inputs | `VES_T76_EVIDENCE_IDENTITY_MISMATCH` | `:295` |
| Build-info with a member too many | wrote its digest | `VES_T76_EVIDENCE_INPUT_INVALID` | `:295` |
| A gate sealed twice, or an unknown gate | appended it | `VES_T76_EVIDENCE_INPUT_INVALID` | `:165`, `:200` |
| Status `""`, `abc`, `00`, `1.0`, `0x0`, `1e0`, ` 0` | `Number()`: `""`, `00`, `0x0` and ` 0` sealed as `pass` | refused | `:224` |
| A seal file that is a JSON array of anything else | appended to it | `VES_T76_EVIDENCE_INPUT_INVALID` | `:200` |
| Target evidence with a member too many or too few | copied it into the index | `VES_T76_EVIDENCE_TARGET_UNEXPECTED` | `:368` |

## 2. Requirement evidence

| Claim | Evidence (file and assertion) |
| --- | --- |
| One module writes the three files | `scripts/t76-candidate-evidence.mjs:240` `sealGateEvaluation`, `:288` `sealTargetEvidence`, `:358` `reconcileTargetIndex`; command line `:390` (`seal-gate`, `seal-target`, `reconcile`) |
| The shapes, digest rules and fleet are stated once | `:27` fleet, `:37` gate profiles, `:41` file names, `:52` members of every record, `:119` sealed form, `:125`, `:129`, `:133` digest rules; `tests/build/t76-candidate-evidence.test.mjs:104` pins the interface |
| The workflow calls it with the same inputs and embeds no program | `.github/workflows/t76-candidate-build.yml:186`, `:229`, `:303`; `tests/agent-readiness/t76-candidate-workflow.test.mjs:101`, `:112`, `:135` pin each call and its arguments; `:233` no step serializes, hashes, writes or imports the encoder, and the only heredoc left is the runner identity check |
| The workflow keeps its permissions, its environment-free shape and the order of its steps | `t76-candidate-workflow.test.mjs:57` (`contents: read`), `:305` (no `secrets.`, no `environment:`, no write, one grant), `:279` (step names of both jobs, in order: the former steps in their former order, and the two tooling steps before each job's first seal) |
| The sealing program is the dispatched commit's, run outside the candidate tree | `.github/workflows/t76-candidate-build.yml:116-135` and `:271-290`: `actions/checkout` at `github.sha`, depth 1, `persist-credentials: false`, moved to `$RUNNER_TEMP/t76-evidence-tooling`, `HEAD` proven equal to `$GITHUB_SHA`; `t76-candidate-workflow.test.mjs:245` pins all of it, that the tooling is in place before each job's first seal, and that every call resolves the module under the tooling checkout and none under the candidate's |
| A bare tooling checkout can run it, with nothing installed | `t76-candidate-evidence.test.mjs:134` imports are Node built-ins and `packages/domain/src/index.ts` only; the module's `hazard:` comment at `:16` |
| The publisher takes the shapes and digest rules from it | `scripts/t76-publish-release.mjs:69-75` import; `:280`, `:285`, `:302`, `:473`, `:561` members; `:289` index digest; `:478` build-info digest; error codes unchanged; `tests/build/t76-release-publication.test.mjs` passes unedited |
| The materializer takes them from it | `scripts/t76-materialize-candidate.mjs:12` import; `:103`, `:110`, `:215`; `tests/build/t76-candidate-materializer.test.mjs` passes unedited |
| The builder writes build-info from its record and admits its gates | `scripts/t76-build-candidate.mjs:14`, `:198-210`, `:534`; `tests/build/reproducible-target-build.test.mjs:169-192` builds the real target, proves build-info.json is the module's record byte for byte, and seals evidence over the real output with the module (build-info and release digests agree) |
| The fleet has one binding | `scripts/t76-signing-custody.mjs:29` re-exports it; `t76-candidate-evidence.test.mjs:126` asserts custody and publisher hold the module's object; `tests/build/t76-signing-custody.test.mjs` passes unedited (its interface is still the same twelve names) |
| The fixture builds its records with it | `tests/helpers/t76-publication-fixture.mjs:39` fleet, `:80` gate seal, `:165` build-info, `:174` evidence, `:242` index; `t76-candidate-evidence.test.mjs:412` the module's reconciliation of the fixture's artifacts is the fixture's index byte for byte |
| The workflow's fleet is the module's | `t76-candidate-workflow.test.mjs:150` the matrix's platform and arch pairs equal `SUPPORTED_TARGET_KEYS`; `:101` its profile list equals `GATE_PROFILES` |
| Gate records, at the interface | `t76-candidate-evidence.test.mjs:147` sums every summary, LF and CRLF, pass and fail; `:165` refusals; `:180` absent, empty and blank seal files, canonical form; `:200` refusals keep the file; `:224` command-line status |
| Target evidence, at the interface | `:245` build-info members and projection; `:262` the evidence binds the exact seal bytes, final line feed included, the canonical build info and the bundle; `:284` sealed form for `win32-x64` and `darwin-arm64`; `:295` refusals write nothing |
| Index, at the interface | `:329` code-unit order whatever the input order, digest over that order; `:356` passes over non-directories and artifacts without evidence; `:368` refusals write nothing |
| Every stated Node version agrees | `t76-candidate-workflow.test.mjs:313`: two setups, the runtime check, the build and the seal all state `24.14.0` |
| Routing | `tests/agent-readiness/gate-selection.test.mjs:386-391` the module is in the census and selects the publisher's gates |

## 3. Workflow pins that changed

`tests/agent-readiness/t76-candidate-workflow.test.mjs` pinned the inline
programs' text. Each deleted assertion is replaced by a behaviour test of the
module and a pin of the call that runs it.

| Deleted case (file at `23f29e1`) | Replacement |
| --- | --- |
| `:58-61` `assertionCount = sum(/\u2139 tests`, `skipped = sum(`, `todo = sum(`, `survivingMutants: 0` | `t76-candidate-evidence.test.mjs:147` (sums, record members, `survivingMutants` 0), golden `:178`; workflow `:101` pins `seal-gate` with the gate's own `$status` and `$log`, after the gate and before the failure accounting, and the profile list against `GATE_PROFILES` |
| `:68-70` `releaseDigest: bundle.releaseDigest`, `gateEvidenceDigest`, `canonicalizeJsonV2(evidence)` | `t76-candidate-evidence.test.mjs:262`, `:284`, golden `:198`; workflow `:112` pins `seal-target` and its ten arguments |
| `:79-84` the fleet literal `expected = new Set([...])`, `entries.length !== expected.size`, `value.revision !== process.env.CANDIDATE_REVISION` | `t76-candidate-evidence.test.mjs:356`, `:368`, golden `:198`, `:220`; workflow `:135` pins `reconcile`, `:150` pins the matrix against the module's fleet |
| `:149-152` the empty seal file reader (`readFile(...).catch(`, `raw.trim() === "" ? [] : JSON.parse(raw)`, no `.catch` on the parse) | `t76-candidate-evidence.test.mjs:180` (absent, empty, blank), `:200` (malformed refused, file kept), golden `:247`; workflow `:216` pins the truncation before the loop |

Added: `:233` no embedded writer, `:245` the module runs from the dispatched
commit's tooling checkout, never the candidate's, `:279` step order, `:305` no
secret, no environment, no write, `:313` Node versions agree. Unchanged: manual
and read-only (`:57`), the matrix block (`:64`), the revision and runner checks
(`:80`), runtime before its check (`:89`), lifecycle scripts (`:160`), heredoc
termination (`:184`, which still finds the runner identity heredoc).

## 4. Defects in the inline programs

Fixed by refusal, with no byte change (section 1.3 lists the inputs):

- **D1.** The target evidence took its target from the matrix and a Node
  version typed into the program, and never read the build output's target. A
  stale literal would have sealed a target the bundle does not carry. The
  publisher does not compare the two either (O4).
- **D2.** It took the release identity from the dispatch inputs without
  comparing it with the build output.
- **D3.** The reconciliation copied any evidence whose target and revision
  fit, whatever its other members.
- **D4.** The gate seal read the status with `Number()`, so an empty status
  would have been sealed as a pass, and it accepted an unknown or repeated
  gate.
- **D5.** The reconciliation sorted with a nested ternary; the module uses a
  code-unit comparator with the same order.

Recorded, unchanged (a change would change bytes or is a reader's):

- **O1.** `survivingMutants` is a constant `0`: no gate log counts mutants.
  The builder refuses any other value.
- **O2.** A gate that printed no assertion stops the gates step at once
  (`set -e`), so later gates are neither run nor sealed. Fail-closed.
- **O3.** No reader verifies `gateEvidenceDigest`: the publisher checks
  neither its form nor that it covers the artifact's `gate-evaluations.json`.
- **O4.** The publisher keys a target by its evidence's target and does not
  compare it with the bundle's. The module now refuses to seal such evidence;
  a closure assembled by hand would still be keyed by its evidence.
- **O5.** Windows: no field is written differently on Windows, and the
  records carry no path, so no separator can leak. CRLF gate logs seal the
  same counts (golden `:178`).
- **O6.** The counters sum every `\u2139 tests N` line in the log; a test that
  printed such a line itself would be counted.

O3 and O4 are publisher behaviour with their own error codes; the follow-up
in section 9 closes both.

## 5. Discrimination

Each mutation was applied to the module or the workflow, the named suite was
run, and the file was restored.

| Mutation | Suite | Result |
| --- | --- | --- |
| M1 sealed files lose their final line feed | golden | killed (4 failures) |
| M2 the index is ordered descending | golden | killed (2) |
| M3 a passing gate is sealed as `passed` | golden | killed (4) |
| M4 the gate evidence digest covers the canonical form instead of the bytes | golden | killed (3) |
| M5 only the first suite summary is counted | golden | killed (4) |
| M6 the fleet coverage check is skipped | golden | killed (1) |
| M7 `seal-target` ignores `--node-version` and seals `24.14.0` | interface | killed (1) |
| M8 build-info drops `deterministic` | publication | killed (25) |
| W0 the workflow as `23f29e1` carries it | workflow | killed (the three calls, no embedded writer, Node versions, the tooling, step order); the permissions, matrix and no-secret pins pass on it |
| W1 `seal-gate` gets a fixed status | workflow | killed |
| W2 `seal-target` loses `--node-version` | workflow | killed (2) |
| W3 `reconcile` gets another revision | workflow | killed |
| W4 the evidence step is renamed | workflow | killed (2) |
| W5 the evidence step reads a secret | workflow | killed |
| T1 the tooling is checked out at `inputs.revision` | workflow | killed |
| T2 `seal-target` runs `scripts/` of the candidate checkout | workflow | killed (3) |
| T3 the tooling checkout persists credentials | workflow | killed |
| T4 the collect job skips the move | workflow | killed (2) |
| T5 the move does not prove the dispatched commit | workflow | killed |

## 6. Guardrails

- **Census.** `docs/canonical-json-census.json` gains
  `scripts/t76-candidate-evidence.mjs` (`migrated-v2`: canonicalizer 6, digest
  2). `scripts/t76-publish-release.mjs` drops from 13 canonicalizer signals to
  11. The other touched scripts keep their signals. `pnpm census:refresh`,
  then `pnpm test:census`: 13 pass.
- **Complexity.** `complexity-baseline.json` is unchanged; no new function is
  above 10, and no hotspot moved. `pnpm complexity:check` passes.
- **Citations.** Nine line citations of the publisher and the custody module
  moved, in `.specs/features/architecture-deepening/validation-c7.md`,
  `.specs/features/release-custody/validation.md`,
  `.specs/features/tuf-metadata-version-safety/validation.md` and
  `.specs/features/tuf-timestamp-refresh/validation.md`; the workflow's Claude
  Code pin moved from `:133` to `:158` in
  `.specs/features/claude-code-2-1-282/validation.md`.
- No dependency, migration, error-catalog entry or digest-bound report
  changed. No test was skipped, weakened or deleted without the replacement
  recorded in section 3.

## 7. Gates

At the tip of this pull request (`4fb35a3`), after the tooling change:
`pnpm gate:quick` PASS (unit 2504, agent-readiness 329, census 13) and
`pnpm agent:check` PASS. At the tip of the follow-up (section 9), which
contains this pull request:

| Command | Result | Tests |
| --- | --- | --- |
| `pnpm gate:quick` (format, lint, complexity, typecheck, unit 2504, agent-readiness 329, census 13) | PASS | 2846 |
| `pnpm test:architecture` | PASS | 96 |
| `pnpm test:build` | PASS | 172 |
| `pnpm test:agent-readiness` | PASS | 329 |
| `pnpm gate:release` (static checks, build, unit, architecture, build, qualification, security, fault, release) | PASS | 4778 |
| `pnpm gate:security` (static checks, build, unit, contract, e2e, architecture, qualification, security, fault) | PASS | 5621 |
| `pnpm agent:check` | PASS | - |

Every suite reported 0 failed, 0 skipped and 0 todo. Before the tooling
change, at `3709464`, `gate:release` passed 4775 and `gate:security` 5621.

## 8. What the five-target dispatch must show

The evidence is sealed by the module at the dispatched commit, so the branch
is the dispatch ref and the revision is any candidate.

1. **The branch head.** Dispatch `t76-candidate-build.yml` from
   `refactor/candidate-evidence-writers` with `revision` set to the branch
   head. The five target jobs and `collect` succeed. In every job the tooling
   steps check out and move the dispatched commit (the move proves `HEAD` is
   `$GITHUB_SHA`). Each target's gates step prints five
   `T76 gate <profile> sealed: pass, <n> assertions` lines and its evidence
   step prints `T76 target evidence sealed for <key>: sha256:...`; `collect`
   prints `T76 target index sealed for <revision>: sha256:...` and uploads
   `t76-target-index-<revision>-<run>`.
2. **The run's own bytes replay.** From a checkout of the branch:

   ```bash
   gh run download <run> --repo accd/verchestra --dir <dir>/targets
   cp <dir>/targets/t76-target-index-<revision>-<run>/t76-target-index.json <dir>/
   node tests/helpers/t76-inline-evidence-writers.mjs replay --run <dir> \
     --revision <revision> --release-id <release_id> --semantic-version <semantic_version>
   ```

   It must print 11 `PASS` lines (five gate seals, five target evidence files,
   the index), each `inline true, module true`, and exit 0.
3. **A revision without the module.** Dispatch again from the branch with
   `revision` set to the `.5` candidate (`e17abb3c8970b72c837bbbd07f86b4676ca9adb3`),
   which carries no module. It must succeed and replay as in 2: the tooling,
   not the candidate, seals the evidence. With `.5`'s own `release_id`,
   `semantic_version` and `created_at`, a reproducible build also yields
   `.5`'s index digest, `sha256:a1dfbc762326d4c114e5874e8aa8c9f6c476ba37524169bc8aa49680b6d30847`;
   if it does not, the replay locates the file that differs.
4. The platform matrix on the branch passes, so the golden tests have run on
   Windows, macOS and Linux hosts.

## 9. Follow-up: the publisher's two gaps (O3, O4)

A separate pull request on top of this one. It changes what the publisher
refuses, never a byte it writes.

| Claim | Evidence (file and assertion) |
| --- | --- |
| A reader verifies `gateEvidenceDigest` against the gate evaluations it covers | `scripts/t76-publish-release.mjs:419` `assertGateEvidence` hashes the `gate-evaluations.json` of each target's artifact with the module's rule and compares it with the evidence: `VES_T76_PUBLISH_DIGEST_MISMATCH`, or `VES_T76_PUBLISH_INPUT_MISSING` when the file is absent; `:306` holds the field to the digest form, `VES_T76_PUBLISH_INPUT_INVALID` |
| The publisher refuses a target evidence whose target differs from its bundle's | `:435` `assertBundleTarget`: `VES_T76_PUBLISH_CLOSURE_INCONSISTENT` |
| Both run before any output | `:446` `assertSealedTargets` runs for every target at `:812`, before the output directory is created at `:813` |
| Each is proven by a test that failed before the change | `tests/build/t76-release-publication.test.mjs:595` (a tampered gate seal, a missing one, a malformed digest) and `:624` (two targets' evidence swapped, and a stale Node version); each asserts the code and that no output directory exists. Before the change both failed with "Missing expected rejection": the publisher signed both closures. `tests/helpers/t76-publication-fixture.mjs:293` `resealTargetEvidence` keeps a rewritten closure self-consistent |
| No byte written changes | the emitted-tree, manifest, ledger-entry and pinned-input assertions of `t76-release-publication.test.mjs` pass unedited; the three codes already existed |

The published candidates' evidence still passes. Each candidate run was
downloaded again with the index of the release before it:

| Candidate | Writers replay | Publisher replay (`tests/helpers/t76-publication-replay.mjs`) |
| --- | --- | --- |
| `.3`, run `36781862073`, rollback `.2` run `32980992904` | 11 of 11 identical | published all five targets |
| `.4`, run `36928077854`, rollback `.3` run `36781862073` | 11 of 11 identical | published all five targets |
| `.5`, run `37017865729`, rollback `.4` run `36928077854` | 11 of 11 identical | published all five targets |

The publisher replay runs the real `publishT76Release` over the downloaded run,
signs with throwaway keys bound to throwaway anchors in a scratch directory,
and deletes what it wrote; `t76-release-publication.test.mjs:654` proves it on
a fixture closure. The per-target release digests it reports are the ones each
run sealed.

Census: `scripts/t76-publish-release.mjs` goes from 11 to 13 canonicalizer
signals; `pnpm test:census` passes. Complexity is unchanged. The publisher and
publication-test line citations in
`.specs/features/architecture-deepening/validation-c7.md`,
`.specs/features/release-custody/validation.md` and
`.specs/features/tuf-metadata-version-safety/validation.md` move with the
code.
