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
