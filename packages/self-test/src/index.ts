// Self-Test trust domain adapter (T69, #10). Node-bound facts only:
// disposable-root provisioning and path-fact probing, sentinel capture,
// bounded fixtures, cleanup with residue reporting, quarantine mechanics,
// and test-only key material. Rules and verdicts live in
// packages/application; sibling-adapter wiring lives only in the CLI
// composition root (.specs/features/self-test/design.md).
export const packageName = "@verchestra/self-test" as const;
export {
  DisposableRootProvider,
  collectLinkChain,
  normalizeFactPath,
  probeRootFacts,
  sha256
} from "./disposable-roots.ts";
export {
  BoundedFixtureFactory,
  SentinelCatalog,
  fixtureJoin,
  testOnlyKeyMaterial,
  type SentinelTarget,
  type TestOnlyKey
} from "./sentinels-and-fixtures.ts";
export { GitFixtureFactory, type GitFixtureFacts } from "./git-fixtures.ts";
export { offlineGuard, type OfflineGuard } from "./network-guard.ts";
export {
  DurableCrashRunner,
  DurableCrashRunnerError,
  type DurableCrashRunnerErrorCode
} from "./durable-crash-runner.ts";
