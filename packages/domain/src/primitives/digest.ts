import { DomainValueError } from "./errors.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export class Digest {
  readonly algorithm = "sha256" as const;
  readonly hex: string;
  readonly value: string;

  private constructor(hex: string) {
    this.hex = hex;
    this.value = `sha256:${hex}`;
    Object.freeze(this);
  }

  static sha256(hex: string): Digest {
    if (!SHA256_HEX.test(hex)) {
      throw new DomainValueError("VES_DIGEST_INVALID", "SHA-256 digest must be 64 lowercase hex characters");
    }
    return new Digest(hex);
  }

  static parse(value: string): Digest {
    const prefix = "sha256:";
    if (!value.startsWith(prefix)) {
      throw new DomainValueError("VES_DIGEST_INVALID", "Digest algorithm is not supported");
    }
    return Digest.sha256(value.slice(prefix.length));
  }

  equals(other: Digest): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
