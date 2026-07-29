import type { KeyLifecycleError } from "@verchestra/contracts";

import type { PublicKeyRef } from "./types.ts";

export type KeyLifecycleErrorCode = KeyLifecycleError["code"];

export const KEY_LIFECYCLE_ERROR_CODES = Object.freeze([
  "VES_KEYSTORE_INTEGRITY",
  "VES_KEY_REVOKED",
  "VES_KEY_EXPIRED"
] as const satisfies readonly KeyLifecycleErrorCode[]);

export interface EvidenceSigner {
  readonly publicKeyRef: PublicKeyRef;
  sign(purpose: string, data: Uint8Array): Promise<string>;
}

export interface KeyProviderRequest {
  readonly keyId: string;
  readonly purposes: readonly string[];
}

export interface KeyRotationRequest extends KeyProviderRequest {
  readonly overlapUntil: string;
}

export interface KeyRotation {
  readonly current: EvidenceSigner;
  readonly previous: PublicKeyRef;
}

export interface KeyProviderPort {
  loadOrCreate(request: KeyProviderRequest): Promise<EvidenceSigner>;
  rotate(request: KeyRotationRequest): Promise<KeyRotation>;
  revoke(keyId: string): Promise<void>;
}
