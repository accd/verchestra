# Self-Test Smoke and Workspace Profiles Design

## Architecture

T70 extends the three places AD-010 already fixed for the Self-Test trust
domain; it does not add a fourth.

| Layer                                          | New contents in T70                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/application/src/self-test/`          | `ScenarioCheck`, `semanticFingerprint`, `assertProfileCoverage`, `requiredCheckIds` on `SelfTestProfile`, three new error codes |
| `packages/self-test/` (adapter)                | `GitFixtureFactory` (five real disposable Git repos), `offlineGuard()` fact-collector                              |
| `apps/vestra-cli/`                              | Smoke + workspace `SelfTestScenario` implementations appended to the existing `self-test-composition.ts` (not a new file — see handoff.md Decisions; AD-010 names that file as the only place importing sibling adapters), `main.ts`'s `createCommandBus(controlRoot)` extracted so scenarios reuse the real controller path, a `self-test` CLI command wired through `cli.ts`/`main.ts` |

Ports still return facts, never verdicts: `offlineGuard()` reports connection
*attempts*; the application layer decides whether that fails the run.
`GitFixtureFactory` reports repository paths and owner ids; it does not judge
placement correctness — that remains `@verchestra/workspace`'s job, invoked
from the composition root.

## Components and responsibilities

| Component | Responsibility |
| --------- | --------------- |
| `ScenarioCheck` (application) | One black-box result: `{ checkId, requirement, status: "pass" \| "fail", failureCode? }`. Pure data. |
| `semanticFingerprint(checks)` (application) | Orders checks by `checkId` and returns the `checkId:status` sequence used for convergence comparison. Excludes paths, durations, timestamps by construction — it never receives them. |
| `assertProfileCoverage(profile, checks)` (application) | Fails closed with `VES_SELFTEST_SCENARIO_MISSING` if any of `profile.requiredCheckIds` is absent from the produced checks. |
| `assertConvergence(a, b)` (application) | Fails closed with `VES_SELFTEST_NONCONVERGENT` if two fingerprints differ. Used only by the T7 qualification proof and available for future doctor-level use. |
| `GitFixtureFactory` (self-test adapter) | Creates the five shapes as real `git init` repositories under the disposable root, using a hermetic Git environment (`GIT_CONFIG_NOSYSTEM=1`, isolated `HOME`, no `GIT_TERMINAL_PROMPT`). Returns `{ shape, path, ownerId }` facts. |
| `offlineGuard()` (self-test adapter) | Wraps `node:net`/`node:http`/`fetch` for the duration of a scenario call and records connection attempts as facts; restores originals afterward even on throw. |
| `self-test-scenarios.ts` (CLI composition) | Implements `SelfTestScenario` for `smoke` (drives the existing `CommandBus`/`runCli` path with `init --dry-run`) and `workspace` (drives `@verchestra/workspace` scanner/placement/init/reconcile functions across the five fixture shapes). Returns `SubjectRunFacts` plus the check list via a side channel (see Report shape below). |
| `self-test` CLI command | New `CliCommand` name `"self-test"`, options `--profile` (`smoke`\|`workspace`) and reuses the existing `--output` flag. Exit code: 0 for PASS, 1 for FAIL, 2 for BLOCKED — mirrors the existing `cli-errors.ts` convention of distinct non-zero codes per failure class. |

## Public interfaces

```ts
// packages/application/src/self-test/self-test.ts (additions)
export interface ScenarioCheck {
  readonly checkId: string;
  readonly requirement: string;
  readonly status: "pass" | "fail";
  readonly failureCode?: SelfTestErrorCode;
}

export function semanticFingerprint(checks: readonly ScenarioCheck[]): readonly string[];
export function assertProfileCoverage(profile: SelfTestProfile, checks: readonly ScenarioCheck[]): void;
export function assertConvergence(a: readonly string[], b: readonly string[]): void;

// SelfTestProfile gains:
readonly requiredCheckIds: readonly string[];

// SubjectRunFacts gains a parallel, non-sealed channel:
// SelfTestScenario.run returns { ...SubjectRunFacts, checks: readonly ScenarioCheck[] }
// via a new SubjectRunFacts.checks: readonly ScenarioCheck[] field — NOT part of
// SelfTestReportPayload, so PRF-06 (sealed field allowlist) is unaffected.
```

```ts
// packages/self-test/src/git-fixtures.ts
export type WorkspaceShape = "standalone" | "colocated" | "centralized" | "nested" | "ignored";
export interface GitFixtureFacts {
  readonly shape: WorkspaceShape;
  readonly path: string;
  readonly ownerId: string;
}
export class GitFixtureFactory {
  constructor(root: RootFacts, budget: BoundedFixtureFactory);
  async provision(shape: WorkspaceShape): Promise<GitFixtureFacts>;
}

// packages/self-test/src/network-guard.ts
export interface NetworkAttempt { readonly api: "net.connect" | "http.request" | "fetch"; readonly target: string; }
export function offlineGuard(): { readonly attempts: () => readonly NetworkAttempt[]; readonly restore: () => void };
```

## Canonical sources and generated projections

No generated contracts are touched. `SELF_TEST_FAILURE_CODES` in
`apps/vestra-cli/src/self-test-composition.ts` is the single registration
point for new codes (unchanged mechanism from T69); the three new codes are
appended there, never invented ad hoc at a call site.

`apps/vestra-cli/src/release-manifest.ts` is canonical for the CLI's
advertised command surface; adding `self-test` there is a canonical-source
edit, and `tests/contract/cli-surface.test.mjs:71-77` (which currently seals
the manifest to `["init"]`) is a generated-projection assertion that must be
updated to match — not weakened, since it still asserts an exact, closed
list.

## Dependency direction

Unchanged from T69/AD-010: `application` has no adapter imports;
`packages/self-test` imports only `@verchestra/application` and
`node:*`; `apps/vestra-cli/src/self-test-scenarios.ts` is the only file that
imports both `@verchestra/self-test` and `@verchestra/workspace` (a sibling
adapter) to compose the TEST-ONLY subject, exactly as
`self-test-composition.ts` already does for T69's identity material.

## Security and trust boundaries

- `offlineGuard()` is fail-closed: any attempt observed during a scenario
  call becomes a `VES_SELFTEST_NETWORK_ATTEMPT` failure in `application`,
  not merely a logged warning.
- Git fixtures run with a hermetic environment so they cannot read the
  operator's real `~/.gitconfig` or credential helpers, and they are created
  under the T69 disposable root, so the existing non-overlap proof
  (`assertDisjointRoot`) already guards them — no new boundary check is
  needed for placement, only for repository identity (fresh `ownerId` per
  fixture, asserted in tests).
- `assertTestOnlyMaterials` (T69) is unchanged; smoke/workspace scenarios
  supply no additional material beyond the per-run identity T69 already
  generates.

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| 25+ real Git repos across two runs could exceed the `workspace` profile's 600s budget or the `smoke` profile's 60s budget | Measure wall-clock in T5/T4 before writing the qualification proof; keep fixture repos minimal (few files, no history beyond one commit) |
| Convergence proof is flaky if any check embeds a timestamp, random id, or absolute path in `checkId` or `status` | `semanticFingerprint` types only accept `checkId`/`status`; scenario code is reviewed to confirm no check derives its id from wall-clock or PID |
| `offlineGuard` global monkeypatching leaks across tests if `restore()` is skipped on throw | Adapter test wraps every `offlineGuard()` use in try/finally; unit test asserts restoration after a thrown scenario |
| `complexity:check` regression from new production functions | Run `pnpm complexity:report` after each task; use `pnpm complexity:update` only if a genuine baseline shift is justified, never to hide a regression |
| Updating the sealed CLI manifest assertion could look like weakening a test | The updated assertion stays exact and closed (`["init", "self-test"]`), reviewed explicitly in T6's commit message as a projection update, not a relaxation |
