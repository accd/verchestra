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

export interface DoctorReport {
  "doctor.verdict": "PASS" | "FAIL" | "BLOCKED";
  "doctor.check_codes": string[];
  "doctor.failure_codes": string[];
  "doctor.blocked_capabilities": string[];
  "doctor.remediation_codes": string[];
  "doctor.duration_ms": number;
}

export interface KeyLifecycleError {
  schemaVersion: "1";
  code: "VES_KEYSTORE_INTEGRITY" | "VES_KEY_REVOKED" | "VES_KEY_EXPIRED";
}

export interface PromotionReport {
  verdict: "PROMOTED" | "BLOCKED";
  candidateDigest: string;
  holdoutDigest: string;
  policyId: string;
  evaluatorKeyId: string;
  evidenceDigest: string;
  blocks: (
    | "VES_PROMOTION_ORACLE_TAMPERED"
    | "VES_PROMOTION_CANDIDATE_MUTATED"
    | "VES_PROMOTION_SHARED_IDENTITY"
    | "VES_PROMOTION_CONTAMINATED"
    | "VES_PROMOTION_INSUFFICIENT_REPETITION"
    | "VES_PROMOTION_CAMPAIGN_FAILED"
  )[];
  bodyDigest: string;
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

export interface RegressionCampaignSummary {
  corpusDigest: string;
  campaignCount: number;
  verdict: "PASS" | "FAIL";
  /**
   * @minItems 1
   */
  campaigns: [
    {
      id: string;
      requirement: string;
      verdict: "PASS" | "FAIL";
      samples: number;
      passRate: number;
      lowerConfidenceBound: number;
    },
    ...{
      id: string;
      requirement: string;
      verdict: "PASS" | "FAIL";
      samples: number;
      passRate: number;
      lowerConfidenceBound: number;
    }[]
  ];
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

export interface SubsystemAvailability {
  schemaVersion: 1;
  subsystem: "driver" | "connector" | "probe";
  available: boolean;
}

/**
 * Untrusted user request for one governed delivery task. Identity, digests, executables, credentials and approvals are derived locally and never carried here.
 */
export interface TaskRequest {
  schemaVersion: 1;
  sourceRevision: string;
  task: {
    taskId: string;
    /**
     * @minItems 1
     * @maxItems 100
     */
    requirementIds: [string, ...string[]];
    /**
     * @minItems 0
     * @maxItems 100
     */
    dependencyTaskIds: string[];
    component: string;
    /**
     * @minItems 1
     * @maxItems 100
     */
    changeScope: [string, ...string[]];
    /**
     * @minItems 1
     * @maxItems 100
     */
    protectedPaths: [string, ...string[]];
    /**
     * @minItems 1
     * @maxItems 100
     */
    verificationCommands: [string, ...string[]];
    /**
     * @minItems 1
     * @maxItems 100
     */
    doneCriteria: [string, ...string[]];
    risk: "low" | "medium" | "high" | "critical";
    expectedCommitBoundary: string;
  };
  /**
   * @minItems 1
   * @maxItems 50
   */
  gates: [
    {
      gateId: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      requirementIds: [string, ...string[]];
      declaredCommand: string;
      commandRef: string;
      /**
       * @minItems 0
       * @maxItems 100
       */
      args: string[];
      cwd: string;
      timeoutMs: number;
      outputLimitBytes: number;
      resultProtocol: "exit-code" | "test-summary";
      minimumTests: number;
    },
    ...{
      gateId: string;
      /**
       * @minItems 1
       * @maxItems 100
       */
      requirementIds: [string, ...string[]];
      declaredCommand: string;
      commandRef: string;
      /**
       * @minItems 0
       * @maxItems 100
       */
      args: string[];
      cwd: string;
      timeoutMs: number;
      outputLimitBytes: number;
      resultProtocol: "exit-code" | "test-summary";
      minimumTests: number;
    }[]
  ];
  budgets: {
    maximumCostUsd: number;
    maximumTokens: number;
    maximumDurationMs: number;
  };
  onGateFailure?: {
    maxAttempts: number;
    feedbackToDriver: boolean;
    escalateAfter: number;
  };
  driver: {
    driverId: "claude-code";
    model: string;
  };
  verifier: {
    driverId: "codex";
    model: string;
  };
  instructions: string;
}
