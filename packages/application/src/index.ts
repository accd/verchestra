export const packageName = "@verchestra/application" as const;
export {
  type ArtifactPlanningPort,
  type DesiredArtifact,
  type EffectivePlacement,
  type LogicalArtifactAddress,
  type PlacementProject,
  type PlacementSnapshot,
  type PlannedWrite,
  type ProjectArtifactClass,
  type ProjectPlacement,
  type ResolvedArtifact,
  type WorkspacePlacementMode,
  type WritePlan
} from "./artifacts/artifact-planning.ts";
export {
  type CliCommand,
  type CommandBus,
  type CommandResult,
  type InvocationContext
} from "./commands/command-bus.ts";
export {
  BOOTSTRAP_PUBLIC_ERROR_DEFINITIONS,
  BootstrapError,
  bootstrapPublicErrorRegistry
} from "./bootstrap/bootstrap-errors.ts";
export {
  MachineBootstrapService,
  type BootstrapResult,
  type CanonicalBootstrapConfig,
  type CanonicalDatabaseRegistration,
  type CanonicalSecretRequirement,
  type DriverDiscoveryPort,
  type LocalDriverCandidate,
  type LocalModelPassport,
  type MachineProfile,
  type MachineProfileSaveReceipt,
  type MachineProfileStorePort,
  type MissingBinding,
  type RoleBindingResult,
  type RoleRequirement,
  type SecretBindingInspectorPort,
  type SecretBindingRequest
} from "./bootstrap/machine-bootstrap.ts";
export { SyncError } from "./sync/sync-errors.ts";
export {
  ApprovalService,
  AuthorityError,
  CapabilityBroker,
  type ApprovalAction,
  type ApprovalArtifactPort,
  type ApprovalBinding,
  type ApprovalGrantPayload,
  type ApprovalIntent,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovalReviewSurface,
  type AuthorityStorePort,
  type AuthorizedIdentity,
  type CapabilityGrant,
  type CapabilityRequest,
  type EntityRef,
  type PolicyAuthorizationPort,
  type SignedApprovalArtifact
} from "./authority/authority.ts";
export {
  CoordinationError,
  WorkClaimService,
  changeScopesOverlap,
  normalizeChangeScope,
  type ChangeTarget,
  type ClaimSignaturePort,
  type LocalLeasePort,
  type LocalLeaseRef,
  type NormalizedChangeScope,
  type RemoteClaimPort,
  type RunOwner,
  type WorkClaim
} from "./coordination/work-claims.ts";
export {
  DataEgressFirewall,
  EgressError,
  TrustEnvelopeService,
  type DeclassificationEvidence,
  type DeclassificationVerifierPort,
  type DestinationProfile,
  type EgressAuthorityPort,
  type EgressPolicyPort,
  type SourceIdentity,
  type TrustClass,
  type TrustEnvelope
} from "./egress/trust-egress.ts";
export {
  WorkspaceReconcileService,
  type CanonicalSyncConfiguration,
  type ContentDigestPort,
  type GenerationSnapshot,
  type IngestionManifestRef,
  type LocalRebuildRequirement,
  type PersistedSyncState,
  type PlannedEffect,
  type ProjectRegistration,
  type ProjectionMapping,
  type ReconcileOperation,
  type ReconciliationDirection,
  type SyncStateStorePort,
  type UncertainEffect,
  type WorkspaceReconcileInput,
  type WorkspaceReconcileResult
} from "./sync/workspace-reconcile.ts";
export {
  TaskExecutionCoordinator,
  TaskExecutorError,
  type AtomicExecutionTask,
  type ExecutionAuthorityPort,
  type ExecutionCheckpoint,
  type ExecutionCheckpointPort,
  type ExecutionContextPort,
  type ExecutionCoordinationPort,
  type ExecutionDriverPort,
  type ExecutionToolPort,
  type ExecutionToolRequest,
  type ExecutionWorktreePort,
  type TaskExecutionInput,
  type TaskExecutorErrorCode
} from "./execution/task-executor.ts";
export {
  normalizeTaskSchedule,
  TaskScheduleCoordinator,
  TaskSchedulerError,
  type ScheduledTaskOutcome,
  type ScheduledTaskStatus,
  type ScheduleRound,
  type TaskScheduleInput,
  type TaskScheduleReport,
  type TaskSchedulerErrorCode
} from "./execution/task-scheduler.ts";
export {
  FEEDBACK_BYTE_BUDGET,
  GateRepairError,
  runGateRepairLoop,
  type GateAttemptFeedback,
  type GateFailure,
  type GateRepairErrorCode,
  type GateRepairOutcome,
  type GateRepairPolicy,
  type GateRepairPorts
} from "./execution/gate-repair.ts";
export {
  BudgetMeterError,
  createBudgetMeter,
  type BudgetLedger,
  type BudgetMeter,
  type BudgetMeterErrorCode,
  type BudgetSnapshot,
  type BudgetStopReason,
  type DeclaredBudgets,
  type ModelPriceTable,
  type UsageEvent
} from "./execution/budget-meter.ts";
export { modelPriceTable } from "./execution/model-price-table.ts";
export {
  ProbeEvidenceError,
  verifyProbeEvidence,
  type ProbeClassification,
  type ProbeEvidenceErrorCode,
  type ProbeEvidenceFailure,
  type ProbeEvidenceFailureReason,
  type ProbeEvidencePort,
  type ProbeEvidenceReference,
  type ProbeEvidenceVerdict,
  type ResolvedProbeResult
} from "./execution/probe-evidence.ts";
export {
  TaskGateCommitCoordinator,
  TaskGateError,
  canonicalTaskGatePlan,
  type TaskGateCommand,
  type TaskGateCommitInput,
  type TaskGateErrorCode,
  type TaskGateRunnerResult
} from "./execution/gate-commit.ts";
export {
  IndependentVerificationCoordinator,
  VerificationError,
  assertNoToolRequests,
  assertReadOnlyGrant,
  resolveVerifierDriver,
  type DriverAvailabilityFact,
  type VerificationErrorCode,
  type VerificationPorts,
  type VerifierDriverResolution
} from "./verification/verification.ts";
export {
  HandoffError,
  PortableHandoffCoordinator,
  type HandoffErrorCode,
  type HandoffPorts
} from "./handoff/handoff.ts";
export {
  buildIdempotencyKey,
  createEffectIntent,
  EffectError,
  type EffectAdapter,
  type EffectApplyResult,
  type EffectIntent,
  type EffectRepository,
  type EffectRiskTier,
  type EffectStatus,
  type IdempotencyInput,
  type OperationReceipt,
  type PriorEffectState,
  type ReceiptOutcome
} from "./effects/effect-contract.ts";
export {
  QuarantineMachine,
  DRIVER_CHECK_IDS,
  DURABLE_CRASH_EXIT_CODE,
  DURABLE_CRASH_PHASES,
  FULL_CHECK_IDS,
  FULL_DURABLE_BOUNDARY_IDS,
  SELF_TEST_REPORT_FIELDS,
  SMOKE_CHECK_IDS,
  WORKSPACE_CHECK_IDS,
  WORKSPACE_SHAPES,
  SelfTestError,
  SelfTestOrchestrator,
  assertConvergence,
  assertDisjointRoot,
  assertDriverReviewBinding,
  assertDriverInvocationFacts,
  assertDriverScenarioFacts,
  assertDurableBoundaryFacts,
  assertFullWorkflowFacts,
  driverScenarioChecks,
  fullWorkflowChecks,
  assertNoNetworkAttempts,
  assertProfileCoverage,
  assertReportPayload,
  assertTestOnlyMaterials,
  diffSentinels,
  resolveSelfTestProfile,
  semanticFingerprint,
  type MaterialFact,
  type DriverInvocationFacts,
  type DriverLifecycleFacts,
  type DriverReviewFacts,
  type DriverReviewToolFact,
  type DriverScenarioFacts,
  type DurableBoundaryFact,
  type DurableCrashPhase,
  type DurableOutcomeFact,
  type FullDurableBoundaryId,
  type FullWorkflowFacts,
  type NetworkAttempt,
  type QuarantineState,
  type RootFacts,
  type ScenarioCheck,
  type SelfTestErrorCode,
  type SelfTestPorts,
  type SelfTestProfile,
  type SelfTestProfileId,
  type SelfTestReportPayload,
  type SelfTestRunResult,
  type SelfTestVerdict,
  type SentinelDiff,
  type SentinelFact,
  type SubjectRunFacts,
  type WorkspaceShape
} from "./self-test/self-test.ts";
export {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DOCTOR_REMEDIATION_CODES,
  DOCTOR_REPORT_FIELDS,
  DoctorError,
  assertDoctorCheckFacts,
  assertDoctorReportPayload,
  buildDoctorReport,
  doctorExitCode,
  type DoctorCheckFact,
  type DoctorCheckId,
  type DoctorCheckStatus,
  type DoctorErrorCode,
  type DoctorRemediationCode,
  type DoctorReportPayload,
  type DoctorReportValue,
  type DoctorVerdict
} from "./doctor/doctor.ts";
export {
  DOCTOR_REMEDIATION_BY_CHECK,
  collectDoctorFacts,
  type DoctorObservation,
  type DoctorProbeSet,
  type DoctorSubsystemProbe
} from "./doctor/doctor-facts.ts";
export {
  CampaignError,
  MINIMUM_CAMPAIGNS,
  assertCampaignCorpus,
  assertCampaignSummary,
  buildCampaignSummary,
  canonicalizeCorpus,
  evaluateCampaign,
  type CampaignDefinition,
  type CampaignErrorCode,
  type CampaignRunResult,
  type CampaignSummaryEntry,
  type CampaignSummaryPayload,
  type CampaignSummaryValue,
  type CampaignVerdict
} from "./regression/campaigns.ts";
export {
  PROMOTION_REPORT_FIELDS,
  PromotionError,
  assertPromotionReport,
  assertReportUntampered,
  buildPromotionReport,
  canonicalizeOracle,
  evaluatePromotion,
  type HoldoutEntry,
  type HoldoutOracle,
  type PromotionBlockCode,
  type PromotionDecision,
  type PromotionErrorCode,
  type PromotionInput,
  type PromotionReportPayload,
  type PromotionVerdict,
  type Sha256Hex
} from "./promotion/promotion-gate.ts";
export type {
  ContextClaimInput,
  ContextFragmentInput,
  ContextSourceKind,
  ContextSourceObservation,
  ContextSourcePort,
  ContextSourceQuery
} from "./context/context-source-port.ts";
