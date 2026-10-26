import { PublicErrorException, type PublicErrorRegistry } from "@verchestra/domain";
import { platformSecurityPublicErrorRegistry, runtimePublicErrorRegistry } from "@verchestra/platform-node";
import { initPublicErrorRegistry } from "@verchestra/workspace";

import { stableCode, taskError } from "./task-errors.ts";

const REGISTRIES: readonly PublicErrorRegistry[] = [
  platformSecurityPublicErrorRegistry,
  runtimePublicErrorRegistry,
  initPublicErrorRegistry
];

// invariant: what any task command shows for an error. A public refusal stays
// as it is; a platform, runtime, or init code without safe details becomes its
// own public envelope, recovery included; anything else is VES_TASK_FAILED
// with the stable code as its reason.
export function publicError(error: unknown): PublicErrorException {
  if (error instanceof PublicErrorException) return error;
  const code = stableCode(error);
  for (const registry of REGISTRIES)
    if (registry.codes.includes(code)) {
      const definition = registry.definitions.find((entry) => entry.code === code);
      if (definition !== undefined && Object.keys(definition.safeDetails).length === 0)
        return new PublicErrorException(registry.create(code, {}), "Task command failed", { cause: error });
    }
  return taskError("VES_TASK_FAILED", { reason: code }, "Task command failed", { cause: error });
}
