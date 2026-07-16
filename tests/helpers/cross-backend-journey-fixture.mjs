import { createHash } from "node:crypto";

import { MachineBootstrapService, canonicalTaskGatePlan } from "../../packages/application/src/index.ts";
import {
  buildConfluenceDeliveryPlan,
  buildJiraProjectionPlan,
  createConfluenceDeliveryIntent,
  createJiraProjectionIntent
} from "../../packages/connectors/src/index.ts";
import { claude, codex, executeInput, qwen, serviceOptions } from "./machine-bootstrap-fixture.mjs";
import {
  currentState,
  digest as packageFixtureDigest,
  executionHarness,
  packageInput
} from "./execution-package-fixture.mjs";
import {
  acceptInput,
  continueInput,
  coordinator as handoffCoordinator,
  handoffPorts,
  prepareInput,
  publishInput,
  sha as handoffDigest,
  sourceRunId,
  successorRunId,
  workspaceId
} from "./handoff-fixture.mjs";
import { MockJiraTransport, projectionFixture, projectionInput } from "./jira-fixture.mjs";
import { MockConfluenceDeliveryTransport, deliveryFixture, deliveryInput } from "./confluence-delivery-fixture.mjs";
import { executor, executorInput, executorPorts } from "./task-executor-fixture.mjs";
import {
  coordinator as gateCoordinator,
  digest as gateDigest,
  gateInput,
  gatePlan,
  gatePorts
} from "./gate-commit-fixture.mjs";
import {
  coordinator as verificationCoordinator,
  humanReviewInput,
  verificationInput,
  verificationPorts
} from "./verification-fixture.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function bootstrap(candidates) {
  const fixture = serviceOptions(MachineBootstrapService, candidates);
  const result = await fixture.service.execute(executeInput());
  return { ...fixture, result: { ...result, profile: fixture.store.profile } };
}

async function projectJira(packageRef, packageDigest, sourceStateDigest, options) {
  const transport = new MockJiraTransport();
  transport.failAfterCreate = options.jiraCreateAckLoss === true;
  const fixture = projectionFixture({ transport });
  const plan = buildJiraProjectionPlan(
    projectionInput({
      workspaceId,
      package: { packageRef, packageDigest },
      currentTaskIds: ["T58.1"],
      pendingTaskIds: ["T59.1"],
      canonicalRevisionDigest: sourceStateDigest
    })
  );
  fixture.adapter.register(plan);
  const intent = createJiraProjectionIntent(plan, {
    effectId: "effect:jira:cross-backend:001",
    grantRef: "grant:jira:managed:001",
    createdAt: "2026-07-16T12:00:00.000Z"
  });
  await fixture.broker.plan(intent);
  let reconciliation;
  let receipt;
  try {
    receipt = await fixture.broker.execute(intent.idempotencyKey);
  } catch (error) {
    if (options.jiraCreateAckLoss !== true || error?.code !== "VES_EFFECT_RECONCILIATION_REQUIRED") throw error;
    reconciliation = await fixture.broker.reconcile(intent.idempotencyKey);
    receipt = await fixture.broker.execute(intent.idempotencyKey);
  }
  if (options.repeatStableOperations === true) await fixture.broker.execute(intent.idempotencyKey);
  return { ...fixture, plan, intent, receipt, reconciliation };
}

async function projectConfluence(packageRef, packageDigest, prepared, options) {
  const transport = new MockConfluenceDeliveryTransport();
  transport.failAfterCreate = options.confluenceCreateAckLoss === true;
  const fixture = deliveryFixture({ transport });
  const plan = buildConfluenceDeliveryPlan(
    deliveryInput({
      workspaceId,
      runId: successorRunId,
      package: { packageRef, packageDigest },
      handoff: { handoffRef: prepared.handoffRef, handoffDigest: prepared.handoffDigest },
      currentTaskIds: ["T58.1"],
      pendingTaskIds: ["T59.1"]
    })
  );
  fixture.adapter.register(plan);
  const intent = createConfluenceDeliveryIntent(plan, {
    effectId: "effect:confluence:cross-backend:001",
    createdAt: plan.generatedAt
  });
  await fixture.broker.plan(intent);
  let reconciliation;
  let receipt;
  try {
    receipt = await fixture.broker.execute(intent.idempotencyKey);
  } catch (error) {
    if (options.confluenceCreateAckLoss !== true || error?.code !== "VES_EFFECT_RECONCILIATION_REQUIRED") throw error;
    reconciliation = await fixture.broker.reconcile(intent.idempotencyKey);
    receipt = await fixture.broker.execute(intent.idempotencyKey);
  }
  if (options.repeatStableOperations === true) await fixture.broker.execute(intent.idempotencyKey);
  return { ...fixture, plan, intent, receipt, reconciliation };
}

function executionFixture(packageDigest, sourceStateDigest, options) {
  const recovered = {
    checkpointRef: "checkpoint:receiver:old",
    workspaceId,
    runId: successorRunId,
    taskId: "T58.1",
    stage: "driver-progress",
    sequence: 2,
    data: { turn: 2 }
  };
  const fixture = executorPorts({
    worktrees: {
      create: async () => ({
        worktreeRef: `worktree:${"1".repeat(32)}:${"a".repeat(40)}`,
        baseCommit: "a".repeat(40)
      })
    },
    ...(options.resumeTask === true ? { checkpoints: { load: async () => recovered } } : {})
  });
  fixture.state.loadedCheckpoint = options.resumeTask === true ? recovered : undefined;
  const input = executorInput();
  input.workspaceId = workspaceId;
  input.runId = successorRunId;
  input.executionPackageDigest = packageDigest;
  input.sourceStateDigest = sourceStateDigest;
  return { ...fixture, input };
}

function gateFixture(execution, task) {
  const command = {
    ...gatePlan().commands[1],
    requirementIds: [...task.requirementIds],
    declaredCommand: task.verificationCommands[0],
    args: ["test:integration"]
  };
  const rawPlan = { schemaVersion: 1, commands: [command] };
  const plan = { ...rawPlan, planDigest: gateDigest(canonicalTaskGatePlan(rawPlan)) };
  const fixture = gatePorts({
    worktrees: {
      inspect: async () => ({
        changedPaths: execution.changedPaths,
        changeDigest: execution.changeDigest,
        commitCountSinceBase: 0
      })
    }
  });
  const base = gateInput();
  const input = {
    ...base,
    workspaceId,
    runId: successorRunId,
    task: {
      taskId: task.taskId,
      requirementIds: task.requirementIds,
      verificationCommands: task.verificationCommands,
      changeScope: task.changeScope,
      protectedPaths: task.protectedPaths,
      expectedCommitBoundary: task.expectedCommitBoundary
    },
    execution: {
      worktreeRef: execution.worktreeRef,
      baseCommit: execution.baseCommit,
      coordinationRef: execution.coordinationRef,
      changeDigest: execution.changeDigest,
      changedPaths: execution.changedPaths,
      checkpointRef: execution.checkpointRef
    },
    gatePlan: plan
  };
  return { ...fixture, input };
}

export async function runCrossBackendJourney(options = {}) {
  const source = await bootstrap([claude(), codex()]);

  const canonicalPackageInput = packageInput({
    discoveryEvidence: [
      { artifactId: "skill:grill-with-docs", digest: packageFixtureDigest("grill-with-docs") },
      { artifactId: "skill:tlc-spec-driven", digest: packageFixtureDigest("tlc-spec-driven") }
    ]
  });
  const packageHarness = executionHarness();
  const sealedPackage = await packageHarness.builder.build(canonicalPackageInput);
  const packageVerification = await packageHarness.builder.verify(
    sealedPackage,
    packageHarness.trust,
    currentState(canonicalPackageInput)
  );
  const packageDigest = `sha256:${sealedPackage.payloadDigest}`;
  const sourceStateDigest = `sha256:${sealedPackage.sourceStateDigest}`;
  const packageRef = `execution-package:${sealedPackage.artifactId}`;
  const semanticObligationsDigest = digest(
    JSON.stringify(
      sealedPackage.payload.requirements.map(({ requirementId, acceptanceCriteria }) => ({
        requirementId,
        acceptanceCriteria
      }))
    )
  );

  const handoffFixture = handoffPorts({
    packages: {
      verify: async (request) => ({
        valid: true,
        workspaceId: request.workspaceId,
        packageRef: request.packageRef,
        packageDigest: request.packageDigest,
        sourceStateDigest: request.sourceStateDigest,
        semanticObligationsDigest,
        packageId: sealedPackage.artifactId,
        firstPendingTaskId: "T58.1",
        pendingTaskIds: ["T58.1", "T59.1"],
        requiredRoles: ["implementer", "verifier"],
        requiredSecretNames: ["jira.token"],
        requiredIntegrationNames: ["jira", "confluence"]
      })
    },
    capsules: {
      verify: async (request) => ({
        valid: true,
        status: "HANDED_OFF",
        sourceRunId,
        successorRunId,
        packageRef: request.artifact.package.packageRef,
        packageDigest: request.artifact.package.packageDigest,
        sourceStateDigest,
        receiverApprovalInherited: false
      })
    }
  });
  const handoff = handoffCoordinator(handoffFixture.ports);
  const prepared = await handoff.prepare(
    prepareInput({
      package: {
        packageRef,
        packageDigest,
        sourceStateDigest
      },
      currentSourceStateDigest: sourceStateDigest,
      semanticObligationsDigest
    })
  );
  const published = await handoff.publish(publishInput(prepared));
  const receiverAcceptInput = acceptInput(published, { currentSourceStateDigest: sourceStateDigest });
  const accepted = await handoff.accept(receiverAcceptInput);
  const continued = await handoff.continue(continueInput(accepted));
  if (options.repeatStableOperations === true) {
    await handoff.prepare(
      prepareInput({
        package: { packageRef, packageDigest, sourceStateDigest },
        currentSourceStateDigest: sourceStateDigest,
        semanticObligationsDigest
      })
    );
    await handoff.publish(publishInput(prepared));
    await handoff.accept(receiverAcceptInput);
    await handoff.continue(continueInput(accepted));
  }

  const jira = await projectJira(packageRef, packageDigest, sourceStateDigest, options);
  const confluence = await projectConfluence(packageRef, packageDigest, prepared, options);
  const receiver = await bootstrap([qwen()]);

  const taskFixture = executionFixture(packageDigest, sourceStateDigest, options);
  const execution = await executor(taskFixture.ports).execute(taskFixture.input);
  const commitFixture = gateFixture(execution, taskFixture.input.task);
  const gate = await gateCoordinator(commitFixture.ports).execute(commitFixture.input);

  const verifierFixture = verificationPorts();
  const verifier = verificationCoordinator(verifierFixture.ports);
  const verifierInput = verificationInput();
  verifierInput.workspaceId = workspaceId;
  verifierInput.run.runId = successorRunId;
  verifierInput.packageDigest = packageDigest;
  verifierInput.commit.commitId = gate.commitId;
  verifierInput.commit.gateEvidenceDigest = gate.gateEvidenceDigest;
  const verification = await verifier.verify(verifierInput);
  const finalReviewInput = humanReviewInput(verification);
  finalReviewInput.workspaceId = workspaceId;
  finalReviewInput.run.runId = successorRunId;
  finalReviewInput.verification.commitId = gate.commitId;
  const review = await verifier.review(finalReviewInput);

  const portableHandoff = handoffFixture.state.artifacts.get(prepared.handoffRef).artifact;
  const sharedArtifacts = Object.freeze([
    Object.freeze({ kind: "execution-package", value: sealedPackage }),
    Object.freeze({ kind: "handoff", value: portableHandoff }),
    Object.freeze({ kind: "jira-projection", value: jira.transport.issues.values().next().value }),
    Object.freeze({ kind: "confluence-section", value: confluence.transport.pages.values().next().value.body }),
    Object.freeze({ kind: "gate-evidence", value: gate })
  ]);
  const sharedArtifactDigestBeforeProfiles = digest(JSON.stringify(sharedArtifacts));
  const sourceBootstrapRepeat = await source.service.execute(executeInput());
  const receiverBootstrapRepeat = await receiver.service.execute(executeInput());
  const sharedArtifactDigestAfterProfiles = digest(JSON.stringify(sharedArtifacts));

  return {
    sourceBootstrap: source.result,
    receiverBootstrap: receiver.result,
    sourceBootstrapRepeat,
    receiverBootstrapRepeat,
    sourceProfileStore: source.store,
    receiverProfileStore: receiver.store,
    sealedPackage,
    packageVerification,
    packageDigest,
    packageDigestBeforeLocalRepeat: packageDigest,
    semanticObligationsDigest,
    sourceApprovalBindingDigest: handoffDigest("source-approval"),
    portableHandoff,
    prepared,
    published,
    accepted,
    continued,
    handoffState: handoffFixture.state,
    jira,
    confluence,
    execution,
    executionState: taskFixture.state,
    gate,
    gateState: commitFixture.state,
    verification,
    verificationInput: verifierInput,
    verificationState: verifierFixture.state,
    review,
    reviewInput: finalReviewInput,
    sharedArtifacts,
    sharedArtifactDigestBeforeProfiles,
    sharedArtifactDigestAfterProfiles
  };
}
