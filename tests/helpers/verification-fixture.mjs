import { createHash } from "node:crypto";

import { IndependentVerificationCoordinator } from "../../packages/application/src/index.ts";
import { WorkflowMachine } from "../../packages/domain/src/index.ts";

export const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const verificationInput = () => ({
  schemaVersion: 2,
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
  run: {
    runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
    runKind: "feature",
    state: "VERIFYING",
    version: 10,
    repairCycles: 0,
    approval: { bindingDigest: sha("approval") },
    implementationActorId: "actor:implementer"
  },
  verifier: { actorId: "actor:verifier", actorKind: "model", passportRef: "passport:verifier:001" },
  implementerDriverId: "driver:implementer",
  verifierDriverId: "driver:verifier",
  packageDigest: sha("package"),
  commit: { commitId: "b".repeat(40), authorActorId: "actor:implementer", gateEvidenceDigest: sha("gates") },
  criteria: [
    {
      criterionId: "AC-001",
      requirementId: "VES-VFY-003",
      whenRef: "spec:when:001",
      thenRef: "spec:then:001",
      independentTestRef: "spec:test:001"
    },
    {
      criterionId: "AC-002",
      requirementId: "VES-VFY-004",
      whenRef: "spec:when:002",
      thenRef: "spec:then:002",
      independentTestRef: "spec:test:002"
    }
  ],
  evidenceClaims: [
    {
      criterionId: "AC-001",
      evidenceRef: "evidence:assertion:001",
      file: "tests/unit/verification.test.mjs",
      lineStart: 20,
      lineEnd: 22,
      assertionRef: "assertion:001",
      expectedOutcomeDigest: sha("expected:AC-001")
    },
    {
      criterionId: "AC-002",
      evidenceRef: "evidence:assertion:002",
      file: "tests/mutation/verification-sensor.test.mjs",
      lineStart: 20,
      lineEnd: 22,
      assertionRef: "assertion:002",
      expectedOutcomeDigest: sha("expected:AC-002")
    }
  ],
  mutations: [
    {
      mutationId: "mutation:AC-001:condition",
      criterionId: "AC-001",
      operator: "condition-negation",
      targetRef: "target:verification:001",
      expectedFailureRef: "failure:AC-001"
    },
    {
      mutationId: "mutation:AC-002:return",
      criterionId: "AC-002",
      operator: "return-substitution",
      targetRef: "target:verification:002",
      expectedFailureRef: "failure:AC-002"
    }
  ]
});

export const humanReviewInput = (report) => ({
  schemaVersion: 1,
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
  run: {
    runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
    runKind: "feature",
    state: "HUMAN_REVIEW",
    version: 11,
    repairCycles: 0,
    approval: { bindingDigest: sha("approval") },
    implementationActorId: "actor:implementer"
  },
  reviewer: { actorId: "actor:human-reviewer", actorKind: "human" },
  verification: {
    reportRef: report?.reportRef ?? "verification:report:001",
    reportDigest: report?.reportDigest ?? sha("report"),
    verdict: report?.verdict ?? "PASS",
    commitId: "b".repeat(40)
  },
  reviewSurfaceDigest: sha("review-surface"),
  currentSurfaceDigest: sha("review-surface"),
  outcome: "accepted",
  findingRefs: ["finding:none"]
});

export function verificationPorts(overrides = {}) {
  const state = { calls: [], reports: [], lessons: [], reviews: [], decisions: [], sensorRuns: 0 };
  const ports = {
    digest: { sha256: sha },
    expectations: {
      derive: async (criterion) => {
        state.calls.push(`derive:${criterion.criterionId}`);
        return {
          expectedOutcomeRef: `expected:${criterion.criterionId}`,
          expectedOutcomeDigest: sha(`expected:${criterion.criterionId}`)
        };
      },
      ...overrides.expectations
    },
    evidence: {
      inspect: async (request) => {
        state.calls.push(`inspect:${request.claim.criterionId}`);
        return {
          valid: true,
          commitId: request.commitId,
          expectedOutcomeDigest: request.expectedOutcomeDigest,
          assertionDigest: sha(request.claim.assertionRef)
        };
      },
      ...overrides.evidence
    },
    sensor: {
      activeStateDigest: async () => sha("active-state"),
      run: async (request) => {
        state.calls.push(`mutate:${request.mutation.mutationId}`);
        state.sensorRuns += 1;
        return {
          scratchIsolationVerified: true,
          killed: true,
          expectedFailureObserved: true,
          evidenceRef: `evidence:${request.mutation.mutationId}`,
          activeStateBeforeDigest: sha("active-state"),
          activeStateAfterDigest: sha("active-state")
        };
      },
      ...overrides.sensor
    },
    lessons: {
      record: async (lesson) => {
        state.calls.push(`lesson:${lesson.code}`);
        state.lessons.push(lesson);
        return { lessonRef: `lesson:${state.lessons.length}` };
      },
      ...overrides.lessons
    },
    reports: {
      verify: async (verification) => ({
        valid: true,
        reportRef: verification.reportRef,
        reportDigest: verification.reportDigest,
        verdict: verification.verdict,
        commitId: verification.commitId
      }),
      save: async (report) => {
        state.calls.push("report:save");
        state.reports.push(report);
        return { reportRef: "verification:report:001", reportDigest: sha(JSON.stringify(report)) };
      },
      ...overrides.reports
    },
    workflow: {
      apply: async (snapshot, command) => {
        state.calls.push(`workflow:${command.type}`);
        const decision = WorkflowMachine.decide(snapshot, command);
        state.decisions.push(decision);
        return decision;
      },
      ...overrides.workflow
    },
    humanAuthority: {
      verify: async () => ({ authorized: true, authorizationRef: "human-review-authorization:001" }),
      ...overrides.humanAuthority
    },
    reviews: {
      save: async (review) => {
        state.calls.push("review:save");
        state.reviews.push(review);
        return { reviewRef: "human-review:001", reviewDigest: sha(JSON.stringify(review)) };
      },
      ...overrides.reviews
    }
  };
  return { state, ports };
}

export const coordinator = (ports) => new IndependentVerificationCoordinator(ports);
