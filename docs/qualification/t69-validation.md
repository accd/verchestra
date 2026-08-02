---
schema: verchestra-qualification-report/v1
task: T69
revision: d0513ae38e3cd07d0b43057c06666a5bb77c6d28
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: d0513ae38e3cd07d0b43057c06666a5bb77c6d28
criteriaEvidence: 6 of 6 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 13 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/180
---

# T69 Self-Test Trust Domain Validation

## Scope

T69 gives Verchestra a way to exercise its own production boundaries with
production code while holding zero production authority and mutating zero
active state. A disposable root is provisioned and proven disjoint from every
guarded root before anything runs; the subject is composed only from test-only
material; the active-state Sentinel Set is hashed before and after; cleanup
either proves removal or the root enters an explicit quarantine; and the run
leaves exactly one allowlisted, signed report.

The split follows the boundary the architecture already enforces. Adapters may
not import sibling adapters, and the domain has to exercise exactly those
siblings, so rules live in `packages/application/src/self-test/`, Node-bound
facts in the new `packages/self-test/` adapter, and the only place that
constructs TEST-ONLY sibling instances is
`apps/vestra-cli/src/self-test-composition.ts`. Ports return facts, never
verdicts: a rule an adapter can answer is a rule nobody can unit-test.

53 cases across four suites, against a declared minimum of 35.

| Suite                                                        | Cases |
| ------------------------------------------------------------ | ----: |
| `tests/unit/self-test-rules.test.mjs`                        |    30 |
| `tests/unit/self-test-adapter.test.mjs`                      |     9 |
| `tests/security/self-test-escape.test.mjs`                   |     4 |
| `tests/fault-injection/self-test-composition-faults.test.mjs` |    10 |

## Deterministic gates

Both gates ran on a clean checkout detached at the implementation revision,
dispatched through `full-validation.yml`; each run's artifact records the
revision and the profile.

| Command              | Result                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `pnpm gate:quick`    | PASS — [run 30725095158](https://github.com/accd/verchestra/actions/runs/30725095158) |
| `pnpm gate:security` | PASS — [run 30725100211](https://github.com/accd/verchestra/actions/runs/30725100211) |

| Profile         | Stages                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `gate:quick`    | `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit`, `test:agent-readiness`                                               |
| `gate:security` | `format:check`, `lint`, `complexity:check`, `typecheck`, `build`, `test:unit`, `test:architecture`, `test:qualification`, `test:security`, `test:fault` |

A first dispatch of `gate:quick` at the T4 revision failed, and the failure was
a defect in the validation workflow rather than in T69: the candidate was
fetched with `--depth=1`, which makes it a graft boundary, so the ancestry
proof this contract requires of every post-T68 report could not succeed and the
resolver derived `T68 complete; T68a next` inside the runner. That is recorded
in #177 and repaired in #178; the runs above are from the repaired workflow.
It is stated here rather than omitted because the first failure is part of this
task's real evidence trail.

## Adequacy matrix

Anchored in `.specs/features/self-test/spec.md`.

| Criterion | Requirement                                                                              | Assertion                                                                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TST-01    | No alias, symlink, junction, or normalized form of a disposable root overlaps a guarded root; an overlapping candidate fails closed | `self-test-rules.test.mjs` — device-and-inode identity, containment in both directions, a link-chain hop through a guarded root, a sibling sharing only a path prefix admitted, and missing device or inode facts failing closed rather than assuming disjoint. `self-test-escape.test.mjs` — a real junction (win32) or directory symlink (POSIX) into guarded state is exposed in `linkChain` by the adapter and refused by the rule. The orchestrator test proves an overlapping root is never mutated: zero cleanup and zero quarantine calls, because overlap means the root may be the production state this domain exists to protect |
| TST-02    | Production keys, identities, policies, stores, and credentials are rejected with a distinct error; a test-only identity is constructed rather than borrowed | `self-test-rules.test.mjs` — non-test material rejected with `VES_SELFTEST_PRODUCTION_MATERIAL` naming the material. `self-test-escape.test.mjs` and `self-test-composition-faults.test.mjs` — the subject never runs when production material is present, and the composed subject only ever receives `testOnly: true` material generated per run and never persisted                                                                                                                                       |
| TST-03    | Profiles come from a closed registry declaring identity, resources, limits, cleanup policy, and report schema; unknown profiles fail closed | `self-test-rules.test.mjs` — all four sealed ids resolve with bounded fixture and duration limits and the single `remove-or-quarantine` cleanup policy; an unknown id fails naming the registry. There is no registration API, so the enum stays exactly the four values the qualified support-bundle contract admits. `self-test-composition-faults.test.mjs` — an unknown profile provisions nothing at all                                                    |
| TST-04    | The Sentinel Set hashed before execution is byte-identical after it; any mutated, added, or removed sentinel fails the run and quarantines the root | `self-test-rules.test.mjs` — order-independent comparison, mutated/added/removed each named, duplicate ids rejected as malformed facts. `self-test-adapter.test.mjs` — digests track content and absence is itself a fact. `self-test-composition-faults.test.mjs` — a scenario that rewrites a sentinel and a scenario that deletes one both fail the run and leave the root quarantined on disk                                                     |
| TST-05    | A root cleanup cannot prove removed enters quarantine through an explicit state machine, never a silent leak; quarantine failure fails closed | `self-test-rules.test.mjs` — legal path, terminal states, and illegal transitions naming both states; unproven cleanup quarantines; a quarantine that cannot prove itself raises `VES_SELFTEST_QUARANTINE_FAILED`. `self-test-adapter.test.mjs` — removal is only claimed when the root demonstrably no longer exists, proven against a genuinely undeletable root, and quarantine renames aside with a reason marker                                     |
| TST-06    | The report contains only the allowlisted `self_test.*` fields, passes the prohibited-content scanner, and is signed by the test-domain identity | `self-test-rules.test.mjs` — unknown and missing fields rejected, prohibited content classes rejected while registered `VES_` codes pass, profile and verdict enums closed. `self-test-composition-faults.test.mjs` — the sealed report verifies against its trust root, carries exactly the seven allowlisted fields, is bound to the code-registry digest so it cannot be replayed under a registry admitting different codes, and an unregistered failure code fails before sealing                    |

## Discrimination sensor

Thirteen mutations, each targeting behavior rather than formatting, applied in
place and reverted after the affected suites ran. Application was verified per
mutation; a pattern that did not match would have been reported as
not-applied rather than counted.

| #   | Criterion | Mutation                                                | Result             |
| --- | --------- | ------------------------------------------------------- | ------------------ |
| M1  | TST-01    | Path containment never reports overlap                  | KILLED (4 failing) |
| M2  | TST-01    | Overlap ignores the real path and link chain            | KILLED (1)         |
| M3  | TST-02    | Production material passes as test-only                 | KILLED (3)         |
| M4  | TST-03    | An unknown profile resolves instead of failing closed   | KILLED (3)         |
| M5  | TST-04    | A mutated sentinel digest is not reported               | KILLED (4)         |
| M6  | TST-05    | Any quarantine transition is legal                      | KILLED (2)         |
| M7  | TST-05    | A failed quarantine is treated as successful            | KILLED (1)         |
| M8  | TST-06    | The report allowlist accepts unknown fields             | KILLED (1)         |
| M9  | TST-06    | Prohibited report content passes the scanner            | KILLED (2)         |
| M10 | TST-01    | The adapter hides symlink and junction hops             | KILLED (1)         |
| M11 | TST-05    | Cleanup claims removal without proving it               | KILLED (1)         |
| M12 | TST-01    | Fixtures may escape the disposable root                 | KILLED (1)         |
| M13 | TST-06    | Unregistered failure codes reach evidence               | KILLED (1)         |

M11 survived its first run: every case passed with the post-removal check
deleted, because `rm` genuinely succeeded in each of them, so nothing was
asserting that the claim was checked rather than assumed. The suite was
strengthened rather than the mutation dropped — a root is made genuinely
undeletable (a process working directory on Windows, a read-only parent on
POSIX) and the reported facts are asserted against reality, with the case
failing loudly if the arrangement itself did not hold. The mutation then died,
and the campaign closed at 13 killed, 0 survived with a clean rerun of all four
suites.

## Non-shallow checks

- The overlap rule is decided from facts an adapter cannot editorialize:
  canonical path, resolved real path, device id, inode id, and the full link
  chain. The rule never touches a filesystem, so every verdict is unit-testable
  and every fact is separately observable.
- An overlapping root is refused before any mutation, including quarantine.
  Quarantining an overlapping root would mean writing a marker into what might
  be production state.
- The four profile ids are not a convenience enum: they are the values the
  already-qualified support-bundle evidence contract admits for
  `self_test.profile` (T57). Crash-recovery in T71 is a mode inside `full`
  rather than a fifth id, so no qualified surface reopens.
- The report is bound to the digest of the code registry it was validated
  against, and a negative assertion proves a swapped binding is refused, so a
  report cannot be replayed as though it came from a registry admitting
  different codes.
- No JSON schema was added for the report. `schema-registry.test.mjs` seals the
  schema list and `test:contract` does not run in `gate:security`, so a schema
  added here would break a gate this task never runs. The allowlist stays in
  TypeScript until T72.
- The adapter takes its key material from `node:crypto` rather than the
  evidence package, because evidence is a sibling adapter it must not import.
  The architecture rule shaped the design instead of being worked around.

## Verdict

T69 is complete. Six of six acceptance criteria have file-and-assertion
evidence, 53 cases exceed the declared minimum of 35, both declared gates pass
on the implementation revision through externally dispatched runs, and thirteen
of thirteen mutations are killed with none surviving.

What this does not claim: no Self-Test profile is composed into the public CLI,
which still exposes only `init`. T70 adds the smoke and workspace profiles,
T71 the full, fault, and approved-driver profiles, and T72 the `doctor --deep`
verb and signed report surface. Independent verification and human review are
established outside this file, at the pull request it names.
