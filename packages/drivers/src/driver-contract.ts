import type { DriverEvent } from "@verchestra/domain";
import { codeUnitCompare } from "@verchestra/domain";

// invariant: ARQ-005 (#597). The contract every driver implements and the
// error every driver raises. Each driver module imports it from here, never
// from the package index that re-exports the drivers, so no driver is
// evaluated through a cycle with the barrel.
export const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;

export class DriverProtocolError extends Error {
  readonly code: string;
  readonly terminateHost: boolean;
  readonly revokeGrants: boolean;
  readonly cancellationRequired: boolean;

  constructor(
    code: string,
    message: string,
    flags: {
      readonly terminateHost?: boolean;
      readonly revokeGrants?: boolean;
      readonly cancellationRequired?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "DriverProtocolError";
    this.code = code;
    this.terminateHost = flags.terminateHost ?? false;
    this.revokeGrants = flags.revokeGrants ?? false;
    this.cancellationRequired = flags.cancellationRequired ?? false;
  }
}

export interface DriverSessionRef {
  readonly sessionId: string;
}

export interface DriverStartRequest {
  readonly workspaceId: string;
  readonly runId: string;
  readonly passportRef: { readonly passportId: string; readonly revision: number };
  readonly serializedContextRef: { readonly manifestId: string; readonly target: string };
  readonly tools: readonly { readonly name: string; readonly inputSchemaDigest: string }[];
}

export interface Driver {
  probe(): Promise<Readonly<Record<string, unknown>>>;
  start(
    request: DriverStartRequest,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal
  ): Promise<DriverSessionRef>;
  send(session: DriverSessionRef, input: Readonly<Record<string, unknown>>): Promise<void>;
  cancel(session: DriverSessionRef, reason: string): Promise<void>;
  close(session: DriverSessionRef): Promise<Readonly<Record<string, unknown>>>;
}

export function validateDriverStartRequest(request: DriverStartRequest): void {
  if (request === null || typeof request !== "object")
    throw new DriverProtocolError("VES_DRIVER_START_INVALID", "Driver start request is invalid");
  const tools = Array.isArray(request.tools) ? request.tools : [];
  const toolNames = new Set<string>();
  const validTools =
    tools.length === request.tools?.length &&
    tools.every((tool) => {
      const valid =
        tool !== null &&
        typeof tool === "object" &&
        Object.keys(tool).sort(codeUnitCompare).join(",") === "inputSchemaDigest,name" &&
        typeof tool.name === "string" &&
        SAFE.test(tool.name) &&
        DIGEST.test(tool.inputSchemaDigest) &&
        !toolNames.has(tool.name);
      if (valid) toolNames.add(tool.name);
      return valid;
    });
  if (
    Object.keys(request).sort(codeUnitCompare).join(",") !==
      "passportRef,runId,serializedContextRef,tools,workspaceId" ||
    typeof request.workspaceId !== "string" ||
    !request.workspaceId.startsWith("workspace_") ||
    !SAFE.test(request.workspaceId) ||
    typeof request.runId !== "string" ||
    !request.runId.startsWith("run_") ||
    !SAFE.test(request.runId) ||
    request.passportRef === null ||
    typeof request.passportRef !== "object" ||
    Object.keys(request.passportRef).sort(codeUnitCompare).join(",") !== "passportId,revision" ||
    typeof request.passportRef.passportId !== "string" ||
    !request.passportRef.passportId.startsWith("passport_") ||
    !SAFE.test(request.passportRef.passportId) ||
    !Number.isSafeInteger(request.passportRef.revision) ||
    request.passportRef.revision < 1 ||
    request.serializedContextRef === null ||
    typeof request.serializedContextRef !== "object" ||
    Object.keys(request.serializedContextRef).sort(codeUnitCompare).join(",") !== "manifestId,target" ||
    !DIGEST.test(request.serializedContextRef.manifestId) ||
    !SAFE.test(request.serializedContextRef.target) ||
    !validTools
  )
    throw new DriverProtocolError("VES_DRIVER_START_INVALID", "Driver start request is invalid");
}
