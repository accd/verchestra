import { DomainValueError } from "./errors.ts";

export const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
export type DataClassificationValue = (typeof DATA_CLASSIFICATIONS)[number];

export class DataClassification {
  readonly value: DataClassificationValue;
  readonly rank: number;

  private constructor(value: DataClassificationValue) {
    this.value = value;
    this.rank = DATA_CLASSIFICATIONS.indexOf(value);
    Object.freeze(this);
  }

  static parse(value: string): DataClassification {
    if (!DATA_CLASSIFICATIONS.includes(value as DataClassificationValue)) {
      throw new DomainValueError("VES_CLASSIFICATION_INVALID", "Data classification is unknown");
    }
    return new DataClassification(value as DataClassificationValue);
  }

  static mostRestrictive(values: readonly DataClassification[]): DataClassification {
    if (values.length === 0) {
      throw new DomainValueError("VES_CLASSIFICATION_INVALID", "At least one classification is required");
    }
    return values.reduce((highest, current) => (current.rank > highest.rank ? current : highest));
  }

  dominates(other: DataClassification): boolean {
    return this.rank >= other.rank;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
