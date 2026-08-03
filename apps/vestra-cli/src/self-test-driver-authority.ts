import {
  assertDriverInvocationFacts,
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

export async function runAuthorizedDriverBoundary(input: {
  readonly review: DriverReviewFacts;
  readonly displayedReview: DriverReviewFacts;
  readonly authority: DriverAuthorityFacts;
  readonly invoke: () => Promise<void>;
}): Promise<DriverInvocationFacts> {
  const permitted = authorized(input.review, input.authority);
  let providerCalls = 0;
  if (permitted) {
    providerCalls += 1;
    await input.invoke();
  }
  const facts = {
    review: input.review,
    displayedReview: input.displayedReview,
    authorized: permitted,
    providerCalls,
    writerToolReachable: hasWriterTool(input.review)
  };
  assertDriverInvocationFacts(facts);
  return facts;
}
