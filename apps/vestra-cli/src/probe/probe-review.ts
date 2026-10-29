import type { ProbePlan } from "@verchestra/data-probe";

export interface ProbeReview {
  readonly runId: string;
  readonly plan: ProbePlan;
  readonly extensionId: string;
  readonly launchDigest: string;
  readonly bindingDigest: string;
}

// invariant: AC 1 and AC 2. What the owner reads before typing the binding
// digest back: the database and how it is classified, what is read and within
// which bounds, by which approved worker. The statement's parameters are not
// in the plan, so they cannot be in the review.
export function renderProbeReview(review: ProbeReview): string {
  const { plan } = review;
  const { bounds } = plan;
  const objects = plan.operation.objects.map((object) => `${object.schema}.${object.name}`).join(", ");
  return [
    `Approve probe run ${review.runId}:`,
    `  database:              ${plan.databaseId}`,
    `  engine:                ${plan.engine}`,
    `  logical environment:   ${plan.logicalEnvironment}`,
    `  classification:        ${plan.classification}`,
    `  production:            ${plan.production}`,
    `  purpose:               ${plan.purpose}`,
    `  statement fingerprint: ${plan.statementFingerprint}`,
    `  objects read:          ${objects}`,
    `  bounds:                rows ${bounds.rowLimit}, bytes ${bounds.byteLimit}, timeout-ms ${bounds.timeoutMs}, concurrency ${bounds.concurrencyLimit}`,
    `  worker:                ${review.extensionId}`,
    `  launch digest:         ${review.launchDigest}`,
    `  binding digest:        ${review.bindingDigest}`,
    ""
  ].join("\n");
}
