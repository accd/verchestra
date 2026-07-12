// Generated from canonical JSON Schemas. Do not edit.

export interface CliOutput {
  schemaVersion: "1";
  command: string;
  ok: boolean;
  data: unknown;
  error?: {
    schemaVersion: "1";
    code: string;
    category: "validation" | "policy" | "state" | "conflict" | "external" | "integrity" | "security" | "internal";
    component: string;
    retryability: "never" | "after-change" | "safe" | "reconcile-first";
    recovery: string;
    safeDetails: {
      [k: string]: unknown;
    };
    documentationVersion: string;
    evidenceRef?: string;
    causeChainDigest?: string;
  };
}

export interface ProtocolEnvelope {
  schemaVersion: "1";
  protocol: "verchestra/1";
  messageId: string;
  correlationId: string;
  workspaceId: string;
  runId?: string;
  sequence: number;
  sentAt: string;
  payloadSchema: string;
  payloadDigest: string;
  payload: unknown;
}

export interface PublicError {
  schemaVersion: "1";
  code: string;
  category: "validation" | "policy" | "state" | "conflict" | "external" | "integrity" | "security" | "internal";
  component: string;
  retryability: "never" | "after-change" | "safe" | "reconcile-first";
  recovery: string;
  safeDetails: {
    [k: string]: unknown;
  };
  documentationVersion: string;
  evidenceRef?: string;
  causeChainDigest?: string;
}

export interface ReleaseManifest {
  schemaVersion: "1";
  releaseId: string;
  platform: string;
  /**
   * @minItems 1
   */
  components: [
    {
      name: string;
      path: string;
      sha256: string;
      releaseId: string;
    },
    ...{
      name: string;
      path: string;
      sha256: string;
      releaseId: string;
    }[]
  ];
}
