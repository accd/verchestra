import type { RunSnapshot, WorkflowCommand, WorkflowDecision } from "@verchestra/domain";

type Row = Record<string, unknown>;
type Digest = `sha256:${string}`;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const REQUIREMENT = /^VES-[A-Z]{3}-[0-9]{3}$/u;
const PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;

export type VerificationErrorCode =
  | "VES_VERIFIER_INPUT_INVALID"
  | "VES_VERIFIER_IDENTITY_CONFLICT"
  | "VES_VERIFIER_EXPECTATION_INVALID"
  | "VES_VERIFIER_INSPECTION_INVALID"
  | "VES_VERIFIER_SENSOR_INVALID"
  | "VES_VERIFIER_REPORT_INVALID"
  | "VES_VERIFIER_LESSON_INVALID"
  | "VES_VERIFIER_WORKFLOW_REJECTED"
  | "VES_HUMAN_REVIEW_INPUT_INVALID"
  | "VES_HUMAN_REVIEW_ACTOR_INVALID"
  | "VES_HUMAN_REVIEW_STALE"
  | "VES_HUMAN_REVIEW_REPORT_INVALID"
  | "VES_HUMAN_REVIEW_AUTHORITY_DENIED"
  | "VES_HUMAN_REVIEW_RECORD_INVALID"
  | "VES_HUMAN_REVIEW_WORKFLOW_REJECTED";

export class VerificationError extends Error {
  readonly code: VerificationErrorCode;

  constructor(code: VerificationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VerificationError";
    this.code = code;
  }
}

function fail(code: VerificationErrorCode, message: string): never {
  throw new VerificationError(code, message);
}

function exact<const Key extends string>(
  value: unknown,
  label: string,
  allowed: readonly Key[],
  code: VerificationErrorCode
): Record<Key, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const row = value as Row;
  if (Object.keys(row).some((key) => !(allowed as readonly string[]).includes(key)))
    fail(code, `${label} contains unknown fields`);
  return row as Record<Key, unknown>;
}

function token(value: unknown, label: string, code: VerificationErrorCode): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string, code: VerificationErrorCode): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code, `${label} is invalid`);
  return value as Digest;
}

function literal<T extends string>(
  value: unknown,
  label: string,
  values: readonly T[],
  code: VerificationErrorCode
): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(code, `${label} is invalid`);
  return value as T;
}

function integer(value: unknown, label: string, min: number, max: number, code: VerificationErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(code, `${label} is invalid`);
  return value as number;
}

function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Row)) freeze(child, seen);
  return Object.freeze(value);
}

interface Criterion {
  readonly criterionId: string;
  readonly requirementId: string;
  readonly whenRef: string;
  readonly thenRef: string;
  readonly independentTestRef: string;
}

interface EvidenceClaim {
  readonly criterionId: string;
  readonly evidenceRef: string;
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly assertionRef: string;
  readonly expectedOutcomeDigest: Digest;
}

interface Mutation {
  readonly mutationId: string;
  readonly criterionId: string;
  readonly operator: string;
  readonly targetRef: string;
  readonly expectedFailureRef: string;
}

interface VerificationInput {
  readonly workspaceId: string;
  readonly run: RunSnapshot;
  readonly verifier: { readonly actorId: string; readonly actorKind: "human" | "model"; readonly passportRef: string };
  readonly packageDigest: Digest;
  readonly commit: { readonly commitId: string; readonly authorActorId: string; readonly gateEvidenceDigest: Digest };
  readonly criteria: readonly Criterion[];
  readonly evidenceClaims: readonly EvidenceClaim[];
  readonly mutations: readonly Mutation[];
}

export interface VerificationPorts {
  readonly digest: { readonly sha256: (value: string) => string };
  readonly expectations: {
    readonly derive: (criterion: Criterion) => Promise<unknown>;
  };
  readonly evidence: {
    readonly inspect: (request: {
      readonly commitId: string;
      readonly criterion: Criterion;
      readonly claim: EvidenceClaim;
      readonly expectedOutcomeDigest: Digest;
    }) => Promise<unknown>;
  };
  readonly sensor: {
    readonly activeStateDigest: () => Promise<unknown>;
    readonly run: (request: {
      readonly commitId: string;
      readonly criterion: Criterion;
      readonly mutation: Mutation;
      readonly expectedOutcomeDigest: Digest;
    }) => Promise<unknown>;
  };
  readonly lessons: { readonly record: (lesson: Readonly<Row>) => Promise<unknown> };
  readonly reports: {
    readonly save: (report: Readonly<Row>) => Promise<unknown>;
    readonly verify: (verification: Readonly<Row>) => Promise<unknown>;
  };
  readonly workflow: {
    readonly apply: (snapshot: RunSnapshot, command: WorkflowCommand) => Promise<WorkflowDecision>;
  };
  readonly humanAuthority: { readonly verify: (review: Readonly<Row>) => Promise<unknown> };
  readonly reviews: { readonly save: (review: Readonly<Row>) => Promise<unknown> };
}

function list(value: unknown, label: string, max: number, code: VerificationErrorCode): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code, `${label} is invalid`);
  return value;
}

function normalizeRun(
  value: unknown,
  requiredState: "VERIFYING" | "HUMAN_REVIEW",
  code: VerificationErrorCode
): RunSnapshot {
  const row = exact(
    value,
    "run",
    ["runId", "runKind", "state", "version", "repairCycles", "approval", "implementationActorId"],
    code
  );
  const approvalRow = exact(row.approval, "run.approval", ["bindingDigest"], code);
  return freeze({
    runId: token(row.runId, "run.runId", code),
    runKind: literal(row.runKind, "run.runKind", ["feature", "recovery"] as const, code),
    state: literal(row.state, "run.state", [requiredState] as const, code),
    version: integer(row.version, "run.version", 0, Number.MAX_SAFE_INTEGER, code),
    repairCycles: integer(row.repairCycles, "run.repairCycles", 0, 3, code),
    approval: { bindingDigest: digest(approvalRow.bindingDigest, "run.approval.bindingDigest", code) },
    implementationActorId: token(row.implementationActorId, "run.implementationActorId", code)
  });
}

function unique<T>(items: readonly T[], key: (item: T) => string, label: string, code: VerificationErrorCode): void {
  if (new Set(items.map(key)).size !== items.length) fail(code, `${label} contains duplicates`);
}

function normalizeVerification(value: unknown): VerificationInput {
  const code = "VES_VERIFIER_INPUT_INVALID" as const;
  const row = exact(
    value,
    "verification input",
    [
      "schemaVersion",
      "workspaceId",
      "run",
      "verifier",
      "packageDigest",
      "commit",
      "criteria",
      "evidenceClaims",
      "mutations"
    ],
    code
  );
  if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
  const verifier = exact(row.verifier, "verifier", ["actorId", "actorKind", "passportRef"], code);
  const commit = exact(row.commit, "commit", ["commitId", "authorActorId", "gateEvidenceDigest"], code);
  const commitId = token(commit.commitId, "commit.commitId", code);
  if (!COMMIT.test(commitId)) fail(code, "commit.commitId is invalid");
  const criteria = list(row.criteria, "criteria", 100, code).map((entry, index): Criterion => {
    const item = exact(
      entry,
      `criteria[${index}]`,
      ["criterionId", "requirementId", "whenRef", "thenRef", "independentTestRef"],
      code
    );
    const requirementId = token(item.requirementId, `criteria[${index}].requirementId`, code);
    if (!REQUIREMENT.test(requirementId)) fail(code, `criteria[${index}].requirementId is invalid`);
    return freeze({
      criterionId: token(item.criterionId, `criteria[${index}].criterionId`, code),
      requirementId,
      whenRef: token(item.whenRef, `criteria[${index}].whenRef`, code),
      thenRef: token(item.thenRef, `criteria[${index}].thenRef`, code),
      independentTestRef: token(item.independentTestRef, `criteria[${index}].independentTestRef`, code)
    });
  });
  if (criteria.length === 0) fail(code, "criteria must not be empty");
  unique(criteria, (entry) => entry.criterionId, "criteria", code);
  const criterionIds = new Set(criteria.map((entry) => entry.criterionId));
  const evidenceClaims = list(row.evidenceClaims, "evidenceClaims", 100, code).map((entry, index): EvidenceClaim => {
    const item = exact(
      entry,
      `evidenceClaims[${index}]`,
      ["criterionId", "evidenceRef", "file", "lineStart", "lineEnd", "assertionRef", "expectedOutcomeDigest"],
      code
    );
    const file = token(item.file, `evidenceClaims[${index}].file`, code);
    if (!PATH.test(file)) fail(code, `evidenceClaims[${index}].file is invalid`);
    const lineStart = integer(item.lineStart, `evidenceClaims[${index}].lineStart`, 1, 10_000_000, code);
    const lineEnd = integer(item.lineEnd, `evidenceClaims[${index}].lineEnd`, lineStart, 10_000_000, code);
    return freeze({
      criterionId: token(item.criterionId, `evidenceClaims[${index}].criterionId`, code),
      evidenceRef: token(item.evidenceRef, `evidenceClaims[${index}].evidenceRef`, code),
      file,
      lineStart,
      lineEnd,
      assertionRef: token(item.assertionRef, `evidenceClaims[${index}].assertionRef`, code),
      expectedOutcomeDigest: digest(item.expectedOutcomeDigest, `evidenceClaims[${index}].expectedOutcomeDigest`, code)
    });
  });
  unique(evidenceClaims, (entry) => entry.criterionId, "evidenceClaims", code);
  if (evidenceClaims.some((entry) => !criterionIds.has(entry.criterionId)))
    fail(code, "evidence references an unknown criterion");
  const mutations = list(row.mutations, "mutations", 100, code).map((entry, index): Mutation => {
    const item = exact(
      entry,
      `mutations[${index}]`,
      ["mutationId", "criterionId", "operator", "targetRef", "expectedFailureRef"],
      code
    );
    return freeze({
      mutationId: token(item.mutationId, `mutations[${index}].mutationId`, code),
      criterionId: token(item.criterionId, `mutations[${index}].criterionId`, code),
      operator: token(item.operator, `mutations[${index}].operator`, code),
      targetRef: token(item.targetRef, `mutations[${index}].targetRef`, code),
      expectedFailureRef: token(item.expectedFailureRef, `mutations[${index}].expectedFailureRef`, code)
    });
  });
  unique(mutations, (entry) => entry.mutationId, "mutations", code);
  unique(mutations, (entry) => entry.criterionId, "mutation criterion bindings", code);
  if (mutations.some((entry) => !criterionIds.has(entry.criterionId)))
    fail(code, "mutation references an unknown criterion");
  return freeze({
    workspaceId: token(row.workspaceId, "workspaceId", code),
    run: normalizeRun(row.run, "VERIFYING", code),
    verifier: {
      actorId: token(verifier.actorId, "verifier.actorId", code),
      actorKind: literal(verifier.actorKind, "verifier.actorKind", ["human", "model"] as const, code),
      passportRef: token(verifier.passportRef, "verifier.passportRef", code)
    },
    packageDigest: digest(row.packageDigest, "packageDigest", code),
    commit: {
      commitId,
      authorActorId: token(commit.authorActorId, "commit.authorActorId", code),
      gateEvidenceDigest: digest(commit.gateEvidenceDigest, "commit.gateEvidenceDigest", code)
    },
    criteria,
    evidenceClaims,
    mutations
  });
}

interface ExpectedOutcome {
  readonly expectedOutcomeRef: string;
  readonly expectedOutcomeDigest: Digest;
}

function expectedOutcome(value: unknown): ExpectedOutcome {
  const code = "VES_VERIFIER_EXPECTATION_INVALID" as const;
  const row = exact(value, "derived expectation", ["expectedOutcomeRef", "expectedOutcomeDigest"], code);
  return freeze({
    expectedOutcomeRef: token(row.expectedOutcomeRef, "expectedOutcomeRef", code),
    expectedOutcomeDigest: digest(row.expectedOutcomeDigest, "expectedOutcomeDigest", code)
  });
}

function inspectionCovered(
  value: unknown,
  commitId: string,
  expected: Digest
): { covered: boolean; evidence?: Readonly<Row> } {
  const code = "VES_VERIFIER_INSPECTION_INVALID" as const;
  const row = exact(
    value,
    "evidence inspection",
    ["valid", "commitId", "expectedOutcomeDigest", "assertionDigest"],
    code
  );
  if (typeof row.valid !== "boolean") fail(code, "evidence inspection validity is invalid");
  if (row.valid !== true) return { covered: false };
  const inspectedCommit = token(row.commitId, "inspection.commitId", code);
  const inspectedOutcome = digest(row.expectedOutcomeDigest, "inspection.expectedOutcomeDigest", code);
  const assertionDigest = digest(row.assertionDigest, "inspection.assertionDigest", code);
  return inspectedCommit === commitId && inspectedOutcome === expected
    ? {
        covered: true,
        evidence: freeze({ commitId: inspectedCommit, expectedOutcomeDigest: inspectedOutcome, assertionDigest })
      }
    : { covered: false };
}

type MutationStatus = "KILLED" | "SURVIVED" | "INVALID_SENSOR";

function sensorResult(
  value: unknown,
  baseline: Digest
): { readonly status: MutationStatus; readonly evidenceRef: string } {
  const code = "VES_VERIFIER_SENSOR_INVALID" as const;
  const row = exact(
    value,
    "sensor result",
    [
      "scratchIsolationVerified",
      "killed",
      "expectedFailureObserved",
      "evidenceRef",
      "activeStateBeforeDigest",
      "activeStateAfterDigest"
    ],
    code
  );
  for (const field of ["scratchIsolationVerified", "killed", "expectedFailureObserved"] as const) {
    if (typeof row[field] !== "boolean") fail(code, `sensor ${field} is invalid`);
  }
  const evidenceRef = token(row.evidenceRef, "sensor.evidenceRef", code);
  const before = digest(row.activeStateBeforeDigest, "sensor.activeStateBeforeDigest", code);
  const after = digest(row.activeStateAfterDigest, "sensor.activeStateAfterDigest", code);
  if (row.scratchIsolationVerified !== true || before !== baseline || after !== baseline)
    return { status: "INVALID_SENSOR", evidenceRef };
  return {
    status: row.killed === true && row.expectedFailureObserved === true ? "KILLED" : "SURVIVED",
    evidenceRef
  };
}

function receipt(value: unknown, kind: "report" | "lesson" | "review"): Readonly<Row> {
  const code =
    kind === "report"
      ? "VES_VERIFIER_REPORT_INVALID"
      : kind === "lesson"
        ? "VES_VERIFIER_LESSON_INVALID"
        : "VES_HUMAN_REVIEW_RECORD_INVALID";
  const fields =
    kind === "report"
      ? ["reportRef", "reportDigest"]
      : kind === "lesson"
        ? ["lessonRef"]
        : ["reviewRef", "reviewDigest"];
  const row = exact(value, `${kind} receipt`, fields, code);
  for (const field of fields) {
    if (field.endsWith("Digest")) digest(row[field], `${kind}.${field}`, code);
    else token(row[field], `${kind}.${field}`, code);
  }
  return freeze({ ...row });
}

function gapCode(status: string): string {
  if (status === "UNCOVERED") return "UNCOVERED_CRITERION";
  if (status === "OUTCOME_MISMATCH") return "OUTCOME_MISMATCH";
  if (status === "MISSING") return "MISSING_MUTATION";
  if (status === "SURVIVED") return "SURVIVING_MUTANT";
  return "INVALID_SENSOR";
}

export class IndependentVerificationCoordinator {
  private readonly ports: VerificationPorts;

  constructor(ports: VerificationPorts) {
    this.ports = ports;
  }

  async verify(value: unknown): Promise<Readonly<Row>> {
    const input = normalizeVerification(value);
    if (
      input.verifier.actorId === input.commit.authorActorId ||
      input.verifier.actorId === input.run.implementationActorId
    ) {
      fail("VES_VERIFIER_IDENTITY_CONFLICT", "the implementation author cannot verify the same work");
    }
    const outcomes = new Map<string, ExpectedOutcome>();
    for (const criterion of input.criteria)
      outcomes.set(criterion.criterionId, expectedOutcome(await this.ports.expectations.derive(criterion)));

    const criterionReports: Readonly<Row>[] = [];
    for (const criterion of input.criteria) {
      const outcome = outcomes.get(criterion.criterionId) as ExpectedOutcome;
      const claim = input.evidenceClaims.find((entry) => entry.criterionId === criterion.criterionId);
      let status: "COVERED" | "UNCOVERED" | "OUTCOME_MISMATCH" = "UNCOVERED";
      let evidence: readonly Readonly<Row>[] = [];
      if (claim !== undefined && claim.expectedOutcomeDigest !== outcome.expectedOutcomeDigest)
        status = "OUTCOME_MISMATCH";
      else if (claim !== undefined) {
        const inspected = inspectionCovered(
          await this.ports.evidence.inspect({
            commitId: input.commit.commitId,
            criterion,
            claim,
            expectedOutcomeDigest: outcome.expectedOutcomeDigest
          }),
          input.commit.commitId,
          outcome.expectedOutcomeDigest
        );
        if (inspected.covered) {
          status = "COVERED";
          evidence = [
            freeze({
              evidenceRef: claim.evidenceRef,
              file: claim.file,
              lineStart: claim.lineStart,
              lineEnd: claim.lineEnd,
              assertionRef: claim.assertionRef,
              ...inspected.evidence
            })
          ];
        }
      }
      criterionReports.push(
        freeze({
          criterionId: criterion.criterionId,
          requirementId: criterion.requirementId,
          status,
          expectedOutcomeRef: outcome.expectedOutcomeRef,
          expectedOutcomeDigest: outcome.expectedOutcomeDigest,
          evidence
        })
      );
    }

    const baseline = digest(
      await this.ports.sensor.activeStateDigest(),
      "active state digest",
      "VES_VERIFIER_SENSOR_INVALID"
    );
    const mutationReports: Readonly<Row>[] = [];
    for (const criterion of input.criteria) {
      const mutation = input.mutations.find((entry) => entry.criterionId === criterion.criterionId);
      if (mutation === undefined) {
        mutationReports.push(
          freeze({
            criterionId: criterion.criterionId,
            requirementId: criterion.requirementId,
            status: "MISSING",
            evidence: []
          })
        );
        continue;
      }
      const result = sensorResult(
        await this.ports.sensor.run({
          commitId: input.commit.commitId,
          criterion,
          mutation,
          expectedOutcomeDigest: (outcomes.get(criterion.criterionId) as ExpectedOutcome).expectedOutcomeDigest
        }),
        baseline
      );
      mutationReports.push(
        freeze({
          mutationId: mutation.mutationId,
          criterionId: criterion.criterionId,
          requirementId: criterion.requirementId,
          operator: mutation.operator,
          status: result.status,
          evidence: [result.evidenceRef]
        })
      );
    }
    const finalActive = digest(
      await this.ports.sensor.activeStateDigest(),
      "final active state digest",
      "VES_VERIFIER_SENSOR_INVALID"
    );
    if (finalActive !== baseline) {
      for (let index = 0; index < mutationReports.length; index += 1) {
        const prior = mutationReports[index];
        if (prior?.["status"] !== "MISSING") mutationReports[index] = freeze({ ...prior, status: "INVALID_SENSOR" });
      }
    }

    const gaps = [
      ...criterionReports.filter((entry) => entry["status"] !== "COVERED"),
      ...mutationReports.filter((entry) => entry["status"] !== "KILLED")
    ];
    const verdict = gaps.length === 0 ? "PASS" : "FAIL";
    const report = freeze({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      runId: input.run.runId,
      packageDigest: input.packageDigest,
      commitId: input.commit.commitId,
      gateEvidenceDigest: input.commit.gateEvidenceDigest,
      actorBinding: { authorActorId: input.commit.authorActorId, verifierActorId: input.verifier.actorId },
      verifierPassportRef: input.verifier.passportRef,
      requirementIds: [...new Set(input.criteria.map((entry) => entry.requirementId))].sort(),
      criteria: criterionReports,
      mutations: mutationReports,
      gaps: gaps.map((entry) =>
        freeze({
          code: gapCode(String(entry["status"])),
          criterionId: entry["criterionId"],
          requirementId: entry["requirementId"]
        })
      ),
      verdict
    });
    const reportReceipt = receipt(await this.ports.reports.save(report), "report");
    for (const gap of report.gaps) {
      receipt(
        await this.ports.lessons.record(
          freeze({
            code: gap.code,
            criterionId: gap.criterionId,
            requirementId: gap.requirementId,
            reportRef: reportReceipt["reportRef"]
          })
        ),
        "lesson"
      );
    }
    const command: WorkflowCommand = freeze({
      type: verdict === "PASS" ? "PASS_VERIFICATION" : "REQUEST_REPAIR",
      expectedVersion: input.run.version,
      actorRole: "verifier",
      actorId: input.verifier.actorId,
      evidence: ["verification-evidence"]
    });
    const decision = await this.ports.workflow.apply(input.run, command);
    const expectedStates = verdict === "PASS" ? ["HUMAN_REVIEW"] : ["REPAIRING", "HUMAN_RESOLUTION_REQUIRED"];
    if (!decision.accepted || !expectedStates.includes(decision.nextState))
      fail("VES_VERIFIER_WORKFLOW_REJECTED", "workflow rejected the verification result");
    return freeze({
      verdict,
      reportRef: reportReceipt["reportRef"],
      reportDigest: reportReceipt["reportDigest"],
      nextState: decision.nextState,
      repairCycles: decision.snapshot.repairCycles
    });
  }

  async review(value: unknown): Promise<Readonly<Row>> {
    const code = "VES_HUMAN_REVIEW_INPUT_INVALID" as const;
    const row = exact(
      value,
      "human review input",
      [
        "schemaVersion",
        "workspaceId",
        "run",
        "reviewer",
        "verification",
        "reviewSurfaceDigest",
        "currentSurfaceDigest",
        "outcome",
        "findingRefs"
      ],
      code
    );
    if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
    const run = normalizeRun(row.run, "HUMAN_REVIEW", code);
    const reviewer = exact(row.reviewer, "reviewer", ["actorId", "actorKind"], code);
    const actorId = token(reviewer.actorId, "reviewer.actorId", code);
    if (reviewer.actorKind !== "human") fail("VES_HUMAN_REVIEW_ACTOR_INVALID", "final review requires a human actor");
    const verificationRow = exact(
      row.verification,
      "verification",
      ["reportRef", "reportDigest", "verdict", "commitId"],
      code
    );
    const verification = freeze({
      reportRef: token(verificationRow.reportRef, "verification.reportRef", code),
      reportDigest: digest(verificationRow.reportDigest, "verification.reportDigest", code),
      verdict: literal(verificationRow.verdict, "verification.verdict", ["PASS", "FAIL"] as const, code),
      commitId: token(verificationRow.commitId, "verification.commitId", code)
    });
    if (!COMMIT.test(verification.commitId) || verification.verdict !== "PASS")
      fail("VES_HUMAN_REVIEW_REPORT_INVALID", "Human Review requires a verified PASS report");
    const verifiedRow = exact(
      await this.ports.reports.verify(verification),
      "verified report",
      ["valid", "reportRef", "reportDigest", "verdict", "commitId"],
      "VES_HUMAN_REVIEW_REPORT_INVALID"
    );
    if (
      verifiedRow.valid !== true ||
      verifiedRow.reportRef !== verification.reportRef ||
      verifiedRow.reportDigest !== verification.reportDigest ||
      verifiedRow.verdict !== "PASS" ||
      verifiedRow.commitId !== verification.commitId
    )
      fail("VES_HUMAN_REVIEW_REPORT_INVALID", "verification report proof is invalid");
    const reviewSurfaceDigest = digest(row.reviewSurfaceDigest, "reviewSurfaceDigest", code);
    const currentSurfaceDigest = digest(row.currentSurfaceDigest, "currentSurfaceDigest", code);
    if (reviewSurfaceDigest !== currentSurfaceDigest)
      fail("VES_HUMAN_REVIEW_STALE", "review surface changed after presentation");
    const outcome = literal(row.outcome, "outcome", ["accepted", "rejected"] as const, code);
    const findingRefs = list(row.findingRefs, "findingRefs", 100, code).map((entry, index) =>
      token(entry, `findingRefs[${index}]`, code)
    );
    unique(findingRefs, (entry) => entry, "findingRefs", code);
    const authorityRequest = freeze({
      workspaceId: token(row.workspaceId, "workspaceId", code),
      runId: run.runId,
      reviewerActorId: actorId,
      reportRef: verification.reportRef,
      reportDigest: verification.reportDigest,
      commitId: verification.commitId,
      reviewSurfaceDigest,
      outcome
    });
    const authority = exact(
      await this.ports.humanAuthority.verify(authorityRequest),
      "human review authority",
      ["authorized", "authorizationRef"],
      "VES_HUMAN_REVIEW_AUTHORITY_DENIED"
    );
    if (authority.authorized !== true) fail("VES_HUMAN_REVIEW_AUTHORITY_DENIED", "Human Review authority was denied");
    const authorizationRef = token(authority.authorizationRef, "authorizationRef", "VES_HUMAN_REVIEW_AUTHORITY_DENIED");
    const record = freeze({
      schemaVersion: 1,
      workspaceId: authorityRequest.workspaceId,
      runId: run.runId,
      reviewerActorId: actorId,
      verificationReportRef: verification.reportRef,
      verificationReportDigest: verification.reportDigest,
      commitId: verification.commitId,
      reviewSurfaceDigest,
      authorizationRef,
      outcome,
      findingRefs
    });
    const reviewReceipt = receipt(await this.ports.reviews.save(record), "review");
    if (outcome === "rejected") return freeze({ status: "REVIEW_REJECTED", ...reviewReceipt });
    const decision = await this.ports.workflow.apply(
      run,
      freeze({
        type: "APPROVE_HUMAN_REVIEW",
        expectedVersion: run.version,
        actorRole: "human",
        actorId,
        evidence: ["human-review-record"]
      })
    );
    if (!decision.accepted || decision.nextState !== "COMPLETED")
      fail("VES_HUMAN_REVIEW_WORKFLOW_REJECTED", "workflow rejected Human Review completion");
    return freeze({ status: "COMPLETED", ...reviewReceipt, nextState: decision.nextState });
  }
}
