import { DomainValueError } from "./errors.ts";

const KIND_PATTERN = /^[a-z][a-z0-9-]{1,31}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const REQUIREMENT_PATTERN = /^VES-[A-Z]{3}-[0-9]{3}$/u;

export type UuidSource = () => string;

function assertKind(kind: string): void {
  if (!KIND_PATTERN.test(kind)) {
    throw new DomainValueError("VES_ID_INVALID", "ID kind is not canonical");
  }
}

export class StableId {
  readonly kind: string;
  readonly uuid: string;
  readonly value: string;

  private constructor(kind: string, uuid: string) {
    this.kind = kind;
    this.uuid = uuid;
    this.value = `${kind}_${uuid}`;
    Object.freeze(this);
  }

  static create(kind: string, source: UuidSource): StableId {
    assertKind(kind);
    return StableId.parse(`${kind}_${source()}`, kind);
  }

  static parse(value: string, expectedKind?: string): StableId {
    const separator = value.indexOf("_");
    const kind = separator < 0 ? "" : value.slice(0, separator);
    const uuid = separator < 0 ? "" : value.slice(separator + 1);
    assertKind(kind);
    if (!UUID_PATTERN.test(uuid)) {
      throw new DomainValueError("VES_ID_INVALID", "ID UUID must be canonical v4 or v7");
    }
    if (expectedKind !== undefined && kind !== expectedKind) {
      throw new DomainValueError("VES_ID_KIND_MISMATCH", "ID kind does not match the expected kind");
    }
    return new StableId(kind, uuid);
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

export class RequirementId {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
    Object.freeze(this);
  }

  static parse(value: string): RequirementId {
    if (!REQUIREMENT_PATTERN.test(value)) {
      throw new DomainValueError("VES_REQUIREMENT_ID_INVALID", "Requirement ID is not canonical");
    }
    return new RequirementId(value);
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
