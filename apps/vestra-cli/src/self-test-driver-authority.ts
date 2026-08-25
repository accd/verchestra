import {
  assertDriverReviewBinding,
  assertDriverInvocationFacts,
  SelfTestError,
  type DriverInvocationFacts,
  type DriverReviewFacts
} from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";

export interface DriverAuthorityFacts {
  readonly approvalGranted: boolean;
  readonly capabilityGranted: boolean;
  readonly destinationId: string;
  readonly maximumCostUsd: number;
  readonly egressAllowed: boolean;
  readonly approvedReview: DriverReviewFacts;
}

// This equality is the gate on provider entry: `authorized` below only returns
// true when the approved review and the review about to be used encode
// identically. That makes it a trust identity, and it used to be decided by a
// private recursive encoder that ordered object members with ambient
// `String.prototype.localeCompare` -- so which reviews counted as "the same
// review" could depend on the machine's locale. It is now the qualified
// contract (canonicalizeJsonV2, RFC 8785 JCS), the same encoder the
// application-layer review binding uses (issue #58, AD-018).
//
// Every value reaching this function has already passed
// `assertDriverReviewBinding`, which fixes the field set and rejects anything
// that is not a string, finite number, or array of those -- so V2's stricter
// input rules (no `undefined`, no non-plain values) cannot turn a previously
// answerable comparison into a throw.
function canonical(value: unknown): string {
  return canonicalizeJsonV2(value);
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
  const fields = [
    "approvalGranted",
    "approvedReview",
    "capabilityGranted",
    "destinationId",
    "egressAllowed",
    "maximumCostUsd"
  ];
  if (Object.keys(authority).sort().join(",") !== fields.join(","))
    throw new SelfTestError("VES_SELFTEST_DRIVER_REVIEW_INVALID", "Driver authority fields are invalid");
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
  readonly actualReview: DriverReviewFacts;
  readonly authority: DriverAuthorityFacts;
  readonly invoke: (actualReview: DriverReviewFacts) => Promise<void>;
}): Promise<DriverInvocationFacts> {
  // Every review surface is a precondition of provider entry. The callback
  // receives only the value that passed this complete preflight.
  assertAuthorityShape(input.authority);
  assertDriverReviewBinding(input.review, input.displayedReview, input.authority.approvedReview, input.actualReview);
  const permitted =
    authorized(input.review, input.authority) && canonical(input.displayedReview) === canonical(input.review);
  let providerBoundaryEntries = 0;
  if (permitted) {
    providerBoundaryEntries += 1;
    await input.invoke(input.actualReview);
  }
  const facts = {
    review: input.review,
    displayedReview: input.displayedReview,
    actualReview: input.actualReview,
    authorized: permitted,
    providerBoundaryEntries,
    writerToolReachable: hasWriterTool(input.review)
  };
  assertDriverInvocationFacts(facts);
  return facts;
}
