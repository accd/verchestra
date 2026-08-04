import {
  assertDriverReviewBinding,
  assertDriverInvocationFacts,
  SelfTestError,
  type DriverInvocationFacts,
  type DriverReviewFacts
} from "@verchestra/application";

export interface DriverAuthorityFacts {
  readonly approvalGranted: boolean;
  readonly capabilityGranted: boolean;
  readonly destinationId: string;
  readonly maximumCostUsd: number;
  readonly egressAllowed: boolean;
  readonly approvedReview: DriverReviewFacts;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function hasWriterTool(review: DriverReviewFacts): boolean {
  return review.tools.some((tool) => tool.access !== "read");
}

function authorized(review: DriverReviewFacts, authority: DriverAuthorityFacts): boolean {
  return (
    authority.approvalGranted &&
    authority.capabilityGranted &&
    authority.egressAllowed &&
    authority.destinationId === review.destinationId &&
    authority.maximumCostUsd === review.maximumCostUsd &&
    canonical(authority.approvedReview) === canonical(review) &&
    !hasWriterTool(review)
  );
}

function assertAuthorityShape(authority: DriverAuthorityFacts): void {
  for (const field of ["approvalGranted", "capabilityGranted", "egressAllowed"] as const) {
    if (typeof authority[field] !== "boolean")
      throw new SelfTestError("VES_SELFTEST_DRIVER_REVIEW_INVALID", `Driver authority ${field} is invalid`);
  }
  if (typeof authority.destinationId !== "string" || authority.destinationId.length === 0)
    throw new SelfTestError("VES_SELFTEST_DRIVER_REVIEW_INVALID", "Driver authority destination is invalid");
  if (!Number.isFinite(authority.maximumCostUsd) || authority.maximumCostUsd <= 0)
    throw new SelfTestError("VES_SELFTEST_DRIVER_REVIEW_INVALID", "Driver authority cost is invalid");
}

export async function runAuthorizedDriverBoundary(input: {
  readonly review: DriverReviewFacts;
  readonly displayedReview: DriverReviewFacts;
  readonly authority: DriverAuthorityFacts;
  readonly invoke: () => Promise<void>;
}): Promise<DriverInvocationFacts> {
  // Complete review binding is a precondition of provider entry.  A displayed
  // mismatch is therefore rejected before `invoke`, rather than discovered
  // while assembling post-call facts.
  assertAuthorityShape(input.authority);
  assertDriverReviewBinding(input.review, input.displayedReview, input.authority.approvedReview);
  const permitted =
    authorized(input.review, input.authority) && canonical(input.displayedReview) === canonical(input.review);
  let providerBoundaryEntries = 0;
  if (permitted) {
    providerBoundaryEntries += 1;
    await input.invoke();
  }
  const facts = {
    review: input.review,
    displayedReview: input.displayedReview,
    authorized: permitted,
    providerBoundaryEntries,
    writerToolReachable: hasWriterTool(input.review)
  };
  assertDriverInvocationFacts(facts);
  return facts;
}
