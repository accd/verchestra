import { DomainValueError } from "./errors.ts";

const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
const NON_PORTABLE_CHARACTER = /[<>:"|?*\u0000-\u001f\u007f]/u;
const MAX_SEGMENT_LENGTH = 255;
const MAX_LOGICAL_PATH_LENGTH = 4_096;

export class LogicalPath {
  readonly value: string;
  readonly segments: readonly string[];

  private constructor(value: string, segments: readonly string[]) {
    this.value = value;
    this.segments = Object.freeze([...segments]);
    Object.freeze(this);
  }

  static parse(value: string): LogicalPath {
    const segments = value.split("/");
    if (
      value.length === 0 ||
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.includes("\\") ||
      /^[A-Za-z]:/u.test(value) ||
      value.length > MAX_LOGICAL_PATH_LENGTH ||
      segments.some(
        (segment) =>
          segment.length === 0 ||
          segment.length > MAX_SEGMENT_LENGTH ||
          segment === "." ||
          segment === ".." ||
          segment.endsWith(".") ||
          segment.endsWith(" ") ||
          WINDOWS_RESERVED_NAME.test(segment) ||
          NON_PORTABLE_CHARACTER.test(segment)
      )
    ) {
      throw new DomainValueError("VES_LOGICAL_PATH_INVALID", "Logical path is not canonical and relative");
    }
    return new LogicalPath(value, segments);
  }

  isWithin(parent: LogicalPath): boolean {
    return this.value === parent.value || this.value.startsWith(`${parent.value}/`);
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
