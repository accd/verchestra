import { generateKeyPairSync, sign as signBytes, type KeyObject } from "node:crypto";

import { IntegrityError } from "./canonical.ts";
import type { PublicKeyRef } from "./types.ts";

export interface SignerOptions {
  readonly keyId: string;
  readonly purposes: readonly string[];
  readonly validFrom?: string;
  readonly validUntil?: string;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new IntegrityError("VES_TRUST_ROOT_INVALID", `${field} must not be empty`);
  }
}

export class NodeEd25519Signer {
  readonly #privateKey: KeyObject;
  readonly #publicKeyRef: PublicKeyRef;

  private constructor(privateKey: KeyObject, publicKeyRef: PublicKeyRef) {
    this.#privateKey = privateKey;
    this.#publicKeyRef = publicKeyRef;
  }

  static generate(options: SignerOptions): NodeEd25519Signer {
    assertNonEmpty(options.keyId, "keyId");
    if (options.purposes.length === 0 || options.purposes.some((purpose) => purpose.length === 0)) {
      throw new IntegrityError("VES_TRUST_ROOT_INVALID", "At least one non-empty purpose is required");
    }

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyRef: PublicKeyRef = Object.freeze({
      keyId: options.keyId,
      algorithm: "Ed25519",
      encoding: "spki-der-base64url",
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      purposes: Object.freeze([...new Set(options.purposes)]),
      ...(options.validFrom === undefined ? {} : { validFrom: options.validFrom }),
      ...(options.validUntil === undefined ? {} : { validUntil: options.validUntil })
    });
    return new NodeEd25519Signer(privateKey, publicKeyRef);
  }

  get publicKeyRef(): PublicKeyRef {
    return this.#publicKeyRef;
  }

  async sign(purpose: string, data: Uint8Array): Promise<string> {
    if (!this.#publicKeyRef.purposes.includes(purpose)) {
      throw new IntegrityError(
        "VES_SIGNING_PURPOSE_DENIED",
        `Key ${this.#publicKeyRef.keyId} cannot sign for ${purpose}`
      );
    }
    return signBytes(null, data, this.#privateKey).toString("base64url");
  }
}
