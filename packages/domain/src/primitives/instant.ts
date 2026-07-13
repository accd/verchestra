import { DomainValueError } from "./errors.ts";

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class IsoInstant {
  readonly value: string;
  readonly epochMilliseconds: number;

  private constructor(value: string, epochMilliseconds: number) {
    this.value = value;
    this.epochMilliseconds = epochMilliseconds;
    Object.freeze(this);
  }

  static parse(value: string): IsoInstant {
    if (!CANONICAL_INSTANT.test(value)) {
      throw new DomainValueError("VES_INSTANT_INVALID", "Instant must use canonical millisecond UTC form");
    }
    const epochMilliseconds = Date.parse(value);
    if (!Number.isFinite(epochMilliseconds) || new Date(epochMilliseconds).toISOString() !== value) {
      throw new DomainValueError("VES_INSTANT_INVALID", "Instant is not a real calendar time");
    }
    return new IsoInstant(value, epochMilliseconds);
  }

  static fromDate(value: Date): IsoInstant {
    const epochMilliseconds = value.getTime();
    if (!Number.isFinite(epochMilliseconds)) {
      throw new DomainValueError("VES_INSTANT_INVALID", "Date is invalid");
    }
    return IsoInstant.parse(new Date(epochMilliseconds).toISOString());
  }

  compare(other: IsoInstant): -1 | 0 | 1 {
    return this.epochMilliseconds < other.epochMilliseconds
      ? -1
      : this.epochMilliseconds > other.epochMilliseconds
        ? 1
        : 0;
  }

  addMilliseconds(duration: number): IsoInstant {
    if (!Number.isSafeInteger(duration)) {
      throw new DomainValueError("VES_INSTANT_INVALID", "Duration must be a safe integer");
    }
    const result = this.epochMilliseconds + duration;
    if (!Number.isSafeInteger(result)) {
      throw new DomainValueError("VES_INSTANT_INVALID", "Instant is outside the supported range");
    }
    return IsoInstant.fromDate(new Date(result));
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

export interface Clock {
  now(): IsoInstant;
}

export class FixedClock implements Clock {
  #current: IsoInstant;

  constructor(initial: IsoInstant) {
    this.#current = initial;
  }

  now(): IsoInstant {
    return this.#current;
  }

  advanceBy(milliseconds: number): void {
    this.#current = this.#current.addMilliseconds(milliseconds);
  }
}
