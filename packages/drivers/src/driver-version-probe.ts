export interface DriverProbeProfile<Identity extends { readonly driverId: string }> {
  // invariant: the identity fields lead every report, in the order given here.
  readonly identity: Identity;
  // why: every driver names its two probe refusals the same way, so the codes
  // are `<prefix>_NOT_AVAILABLE` and `<prefix>_VERSION_UNSUPPORTED`, and the
  // messages are "<noun> is unavailable" and "<noun> version is unsupported".
  readonly errorCodePrefix: string;
  readonly noun: string;
  readonly capabilities: readonly string[];
}

export type DriverVersionRequirement =
  // invariant: the pattern captures major, minor and patch, is neither global
  // nor sticky, and reads the minimum as well as the provider's own output. A
  // newer major is refused: a floor qualifies one major line.
  | { readonly minimum: string; readonly pattern: RegExp }
  // invariant: the whole reported text must equal the qualified version, so a
  // suffixed or longer version is drift, not a match.
  | { readonly exact: string };

export type DriverProbeReport<Identity> =
  | Readonly<Identity & { available: true; version: string; capabilities: readonly string[] }>
  | Readonly<
      Identity & {
        available: false;
        version?: string | undefined;
        error: Readonly<{ code: string; message: string }>;
      }
    >;

function parseVersion(text: string, pattern: RegExp): readonly [number, number, number] | undefined {
  const match = pattern.exec(text.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function meetsMinimum(actual: string, minimum: string, pattern: RegExp): boolean {
  const left = parseVersion(actual, pattern);
  const right = parseVersion(minimum, pattern);
  if (left === undefined || right === undefined || left[0] !== right[0]) return false;
  if (left[1] !== right[1]) return left[1] > right[1];
  return left[2] >= right[2];
}

function judge(
  text: string,
  requirement: DriverVersionRequirement
): { version: string | undefined; qualified: boolean } {
  if ("exact" in requirement) return { version: text, qualified: text === requirement.exact };
  const version = parseVersion(text, requirement.pattern)?.join(".");
  const qualified = version !== undefined && meetsMinimum(version, requirement.minimum, requirement.pattern);
  return { version, qualified };
}

async function observed(observe: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return await observe();
  } catch {
    // why: how the provider failed to answer may name a loader or a local
    // path; a probe is portable evidence, so only the absence is reported.
    return undefined;
  }
}

// invariant: `observe` returns what the provider reports as its version;
// nothing, or a throw, means the provider is absent. The result is always a
// frozen report, never a throw.
export async function probeDriverVersion<Identity extends { readonly driverId: string }>(
  profile: DriverProbeProfile<Identity>,
  requirement: DriverVersionRequirement,
  observe: () => Promise<string | undefined>
): Promise<DriverProbeReport<Identity>> {
  const text = await observed(observe);
  if (text === undefined)
    return Object.freeze({
      ...profile.identity,
      available: false,
      error: Object.freeze({
        code: `${profile.errorCodePrefix}_NOT_AVAILABLE`,
        message: `${profile.noun} is unavailable`
      })
    });
  const { version, qualified } = judge(text, requirement);
  if (version === undefined || !qualified)
    return Object.freeze({
      ...profile.identity,
      available: false,
      version,
      error: Object.freeze({
        code: `${profile.errorCodePrefix}_VERSION_UNSUPPORTED`,
        message: `${profile.noun} version is unsupported`
      })
    });
  return Object.freeze({
    ...profile.identity,
    available: true,
    version,
    capabilities: Object.freeze([...profile.capabilities])
  });
}
