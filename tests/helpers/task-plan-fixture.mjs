// invariant: the plan a request binds, as `task plan` builds it
// (apps/vestra-cli/src/task/task-plan.ts `planApproval`), from the fixed
// inputs of the Run record suites. Nothing here is a credential, a
// machine-local path, or provider state.
import { planApproval } from "../../apps/vestra-cli/src/task/task-plan.ts";
import { ApprovalRequester } from "../../packages/application/src/index.ts";
import { FixedClock, IsoInstant } from "../../packages/domain/src/index.ts";
import { ArtifactSealer, NodeEd25519Signer } from "../../packages/evidence/src/index.ts";
import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";
import { CREATED_AT, RUN_ID, WORKSPACE_ID, contextManifest, filled, planRecord } from "./task-run-record-fixture.mjs";

// why: an Execution Package's artifact ID covers its issue time and an
// approval request its clock and ID source; a fixed signing seed, instant, and
// ID source make the plan a byte-stable function of the request alone.
const PKCS8_ED25519_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");

export async function boundPlan(request) {
  const signer = NodeEd25519Signer.fromPkcs8(
    {
      keyId: "workspace-task-evidence",
      purposes: ["execution-package", "approval", "run-capsule", "context-manifest"]
    },
    Buffer.concat([PKCS8_ED25519_HEADER, Buffer.alloc(32, 7)])
  );
  let sequence = 0;
  const context = {
    workspace: { workspaceId: WORKSPACE_ID },
    request,
    runId: RUN_ID,
    createdAt: CREATED_AT,
    sourceStateDigest: filled("1"),
    policyDigest: filled("3"),
    gatePlanDigest: filled("4"),
    skillLockDigest: filled("2")
  };
  return planApproval(
    context,
    contextManifest(),
    new ArtifactSealer({ signer, now: () => new Date(CREATED_AT) }),
    new ApprovalRequester({
      digest: new NodeContentDigest(),
      clock: new FixedClock(IsoInstant.parse(CREATED_AT)),
      uuid: () => `018f0b6d-7b1a-7abc-8def-${String(++sequence).padStart(12, "0")}`
    })
  );
}

// invariant: a plan record as `task plan` writes it for `request`: bound to its
// Execution Package and its approval intent, with the package to store beside
// it.
export async function boundPlanRecord(request) {
  const { pkg, intent, approvalRequest } = await boundPlan(request);
  const record = planRecord({
    request,
    packageId: pkg.artifactId,
    packageDigest: `sha256:${pkg.payloadDigest}`,
    approvalIntent: intent,
    approvalRequest
  });
  return { record, pkg };
}
