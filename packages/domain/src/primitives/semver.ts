import { DomainValueError } from "./errors.ts";

// why: one ordering for release versions, semver 2.0.0 section 11. Two callers compared versions with
// their own code, and both dropped the pre-release part, so `0.0.0-qualification.9` and `0.0.0` were
// equal (or `NaN`) to them. Build metadata is not accepted, as in every pattern the repository already
// validates a version with.
const CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const IDENTIFIER = /^[0-9A-Za-z-]+$/u;
const NUMERIC = /^(?:0|[1-9]\d*)$/u;
const DIGITS = /^\d+$/u;

interface ParsedVersion {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}

const invalid = (): never => {
  throw new DomainValueError(
    "VES_SEMVER_INVALID",
    "Version must be major.minor.patch with optional pre-release identifiers"
  );
};

function parse(value: string): ParsedVersion {
  if (typeof value !== "string") return invalid();
  const dash = value.indexOf("-");
  const match = CORE.exec(dash < 0 ? value : value.slice(0, dash));
  if (match === null) return invalid();
  const prerelease = dash < 0 ? [] : value.slice(dash + 1).split(".");
  for (const identifier of prerelease) {
    if (!IDENTIFIER.test(identifier)) return invalid();
    // why: a numeric identifier with a leading zero is not a valid semver identifier.
    if (DIGITS.test(identifier) && !NUMERIC.test(identifier)) return invalid();
  }
  return { core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease };
}

function order<T extends bigint | number | string>(left: T, right: T): -1 | 0 | 1 {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIdentifiers(left: string, right: string): -1 | 0 | 1 {
  const leftNumeric = NUMERIC.test(left);
  const rightNumeric = NUMERIC.test(right);
  if (leftNumeric && rightNumeric) return order(BigInt(left), BigInt(right));
  // why: a numeric identifier is always older than an alphanumeric one.
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  // why: code-unit order, never localeCompare, so the result does not depend on the host.
  return order(left, right);
}

/** Compares two release versions by semver 2.0.0 precedence. Throws `VES_SEMVER_INVALID` for either one that is not a version. */
export function compareSemanticVersions(left: string, right: string): -1 | 0 | 1 {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = order(a.core[index]!, b.core[index]!);
    if (difference !== 0) return difference;
  }
  // why: a version with a pre-release is older than the same version without one.
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return order(a.prerelease.length === 0 ? 1 : 0, b.prerelease.length === 0 ? 1 : 0);
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index += 1) {
    const difference = compareIdentifiers(a.prerelease[index]!, b.prerelease[index]!);
    if (difference !== 0) return difference;
  }
  // why: with every shared identifier equal, the version with more identifiers is newer.
  return order(a.prerelease.length, b.prerelease.length);
}
