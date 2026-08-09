// The one qualified context token estimator (AD-015).
//
// The estimator is the last machine-dependent input in an otherwise
// deterministic pipeline: fragment ordering is already provably invariant, but
// a caller-injected estimate decides *which* fragments compile in, and two
// conforming estimators may disagree arbitrarily. So exactly one estimator
// ships, its identity travels in the context manifest, and the manifest digest
// covers it.
//
// Calibration basis — deliberately conservative, so estimation error omits
// context or refuses the compile rather than dispatching beyond a model's real
// capacity:
//
//   * Byte-pair vocabularies for the major model families encode typical
//     English text at roughly four UTF-8 bytes per token. Dividing by three
//     therefore over-estimates that case by about a third.
//   * Scripts outside Latin-1 cost three or more UTF-8 bytes per character
//     while often tokenizing at one to two characters per token, so bytes / 3
//     stays at or above the real count there too.
//   * Structured text (JSON, code) tokenizes more densely than prose, which
//     the same margin absorbs.
//
// UTF-8 bytes rather than UTF-16 code units: the count must not depend on how
// a runtime represents a string, because it feeds a digest. Surrogate pairs
// make `String.prototype.length` a representation detail; the UTF-8 byte
// length of a given text is a property of the text.
//
// Changing this algorithm changes compiled contexts and therefore invalidates
// historical manifests. That is a versioned migration, exactly like a
// canonicalization change — bump `version` and migrate deliberately, never
// silently.

const BYTES_PER_TOKEN = 3;

export interface TokenEstimatorIdentity {
  readonly name: string;
  readonly version: string;
}

export const QUALIFIED_TOKEN_ESTIMATOR: TokenEstimatorIdentity = Object.freeze({
  name: "verchestra-utf8-bytes",
  version: "1"
});

/**
 * Estimate the tokens `content` occupies, over-estimating on purpose.
 *
 * Always returns a positive safe integer: empty content still costs one token,
 * because a fragment that exists is never free and the compiler's own guard
 * refuses a non-positive estimate.
 */
export function estimateQualifiedTokens(content: string): number {
  return Math.ceil(Buffer.byteLength(content, "utf8") / BYTES_PER_TOKEN) + 1;
}
