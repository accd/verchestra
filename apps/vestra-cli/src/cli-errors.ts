import { PublicErrorException, PublicErrorRegistry, type PublicErrorDefinition } from "@verchestra/domain";

export const CLI_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  {
    code: "VES_CLI_ARGUMENT_INVALID",
    category: "validation",
    component: "cli",
    retryability: "after-change",
    recovery: "Correct the command arguments and retry.",
    documentationVersion: "1",
    safeDetails: { argument: "string" }
  },
  {
    code: "VES_CLI_COMMAND_FAILED",
    category: "external",
    component: "cli",
    retryability: "after-change",
    recovery: "Inspect the safe diagnostic and retry after remediation.",
    documentationVersion: "1",
    safeDetails: { command: "string" }
  },
  {
    code: "VES_CLI_INTERNAL",
    category: "internal",
    component: "cli",
    retryability: "never",
    recovery: "Record the incident reference and run a safe diagnostic.",
    documentationVersion: "1",
    safeDetails: { incident: "string" }
  },
  {
    code: "VES_CLI_RELEASE_INCOMPATIBLE",
    category: "integrity",
    component: "cli",
    retryability: "after-change",
    recovery: "Activate the minimum compatible release before running commands.",
    documentationVersion: "1",
    safeDetails: { minimumRelease: "string" }
  }
] as const satisfies readonly PublicErrorDefinition[]);

export const cliPublicErrorRegistry = new PublicErrorRegistry(CLI_PUBLIC_ERROR_DEFINITIONS);

export function cliError(
  code: string,
  details: Readonly<Record<string, unknown>>,
  message: string
): PublicErrorException {
  return new PublicErrorException(cliPublicErrorRegistry.create(code, details), message);
}
