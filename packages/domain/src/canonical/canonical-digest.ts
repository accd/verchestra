// The sole authority for the v2:sha256: digest-identity prefix, so every
// migrated call site derives its identity the same way instead of
// re-deriving the prefix format locally (docs/canonical-json-compatibility.md).

import { DomainValueError } from "../primitives/errors.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export function formatCanonicalDigestV2(sha256Hex: string): string {
  if (typeof sha256Hex !== "string" || !SHA256_HEX.test(sha256Hex))
    throw new DomainValueError(
      "VES_DIGEST_V2_INVALID",
      "formatCanonicalDigestV2 requires a lowercase 64-character sha256 hex digest"
    );
  return `v2:sha256:${sha256Hex}`;
}
