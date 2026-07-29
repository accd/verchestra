import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signBytes, type KeyObject } from "node:crypto";

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
    const { privateKey } = generateKeyPairSync("ed25519");
    return NodeEd25519Signer.fromPrivateKey(options, privateKey);
  }

  static fromPkcs8(options: SignerOptions, encoded: Uint8Array): NodeEd25519Signer {
    try {
      return NodeEd25519Signer.fromPrivateKey(
        options,
        createPrivateKey({ key: Buffer.from(encoded), format: "der", type: "pkcs8" })
      );
    } catch (error) {
      if (error instanceof IntegrityError) throw error;
      throw new IntegrityError("VES_KEYSTORE_INTEGRITY", "Persisted signing key is invalid");
    }
  }

  static fromPrivateKey(options: SignerOptions, privateKey: KeyObject): NodeEd25519Signer {
    assertNonEmpty(options.keyId, "keyId");
    if (options.purposes.length === 0 || options.purposes.some((purpose) => purpose.length === 0)) {
      throw new IntegrityError("VES_TRUST_ROOT_INVALID", "At least one non-empty purpose is required");
    }
    if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
      throw new IntegrityError("VES_KEYSTORE_INTEGRITY", "Persisted signing key is not Ed25519 private key material");
    }

    const publicKey = createPublicKey(privateKey);
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

  exportPkcs8(): Uint8Array {
    return Uint8Array.from(this.#privateKey.export({ type: "pkcs8", format: "der" }) as Buffer);
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
