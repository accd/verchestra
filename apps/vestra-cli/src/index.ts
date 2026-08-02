export const packageName = "@verchestra/vestra-cli" as const;
export { CLI_PUBLIC_ERROR_DEFINITIONS, cliPublicErrorRegistry } from "./cli-errors.ts";
export {
  parseCliArguments,
  runCli,
  type CliCommandManifest,
  type CliOptionManifest,
  type InstalledCliManifest,
  type ParsedCliArguments
} from "./cli.ts";
export { installedReleaseManifest } from "./release-manifest.ts";
export { createCommandBus, main } from "./main.ts";
export {
  SELF_TEST_FAILURE_CODES,
  SelfTestComposition,
  createSelfTestCodeRegistry,
  createSmokeScenario,
  createWorkspaceScenario,
  placementMatchesExpectation,
  runSelfTestProfile,
  snapshotsIdentical,
  type SealedSelfTestReport,
  type SelfTestCompositionOptions,
  type SelfTestScenario
} from "./self-test-composition.ts";
