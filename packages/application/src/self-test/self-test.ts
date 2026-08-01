// Self-Test trust domain rules (T69, #10). Ports return facts; every verdict
// lives here so it can be unit-tested without a filesystem. The adapter
// (packages/self-test) supplies the facts; the CLI composition root wires
// TEST-ONLY sibling adapters in as the subject.

export type SelfTestErrorCode =
  | "VES_SELFTEST_UNKNOWN_PROFILE"
  | "VES_SELFTEST_ROOT_FACTS_INVALID"
  | "VES_SELFTEST_ROOT_OVERLAP"
  | "VES_SELFTEST_PRODUCTION_MATERIAL"
  | "VES_SELFTEST_SENTINEL_FACTS_INVALID"
  | "VES_SELFTEST_SENTINEL_MUTATION"
  | "VES_SELFTEST_QUARANTINE_TRANSITION"
  | "VES_SELFTEST_QUARANTINE_FAILED"
  | "VES_SELFTEST_REPORT_FIELD_UNKNOWN"
  | "VES_SELFTEST_REPORT_CONTENT_PROHIBITED";

export class SelfTestError extends Error {
  readonly code: SelfTestErrorCode;

  constructor(code: SelfTestErrorCode, message: string) {
    super(message);
    this.name = "SelfTestError";
    this.code = code;
  }
}

function fail(code: SelfTestErrorCode, message: string): never {
  throw new SelfTestError(code, message);
}

// The profile ids reuse the sealed support-bundle enum (T57 evidence):
// `self_test.profile` admits exactly these four values, so the registry is
// closed by construction — there is no registration API to widen it.
export type SelfTestProfileId = "smoke" | "full" | "workspace" | "drivers";

export interface SelfTestProfile {
  readonly profileId: SelfTestProfileId;
  readonly summary: string;
  readonly maxFixtureBytes: number;
  readonly maxDurationMs: number;
  // The only cleanup policy T69 admits: a temporary root is proven removed or
  // it enters quarantine. There is no "best effort" member on purpose.
  readonly cleanupPolicy: "remove-or-quarantine";
}

const PROFILES: Readonly<Record<SelfTestProfileId, SelfTestProfile>> = Object.freeze({
  smoke: Object.freeze({
    profileId: "smoke",
    summary: "Fast provisioning, boundary, and report checks",
    maxFixtureBytes: 1_048_576,
    maxDurationMs: 60_000,
    cleanupPolicy: "remove-or-quarantine"
  }),
  full: Object.freeze({
    profileId: "full",
    summary: "Complete scenario surface, including crash-recovery mode",
    maxFixtureBytes: 67_108_864,
    maxDurationMs: 1_800_000,
    cleanupPolicy: "remove-or-quarantine"
  }),
  workspace: Object.freeze({
    profileId: "workspace",
    summary: "Workspace lifecycle scenarios against a disposable root",
    maxFixtureBytes: 16_777_216,
    maxDurationMs: 600_000,
    cleanupPolicy: "remove-or-quarantine"
  }),
  drivers: Object.freeze({
    profileId: "drivers",
    summary: "Approved-driver availability and contract checks",
    maxFixtureBytes: 4_194_304,
    maxDurationMs: 600_000,
    cleanupPolicy: "remove-or-quarantine"
  })
});

export function resolveSelfTestProfile(profileId: string): SelfTestProfile {
  const profile = (PROFILES as Record<string, SelfTestProfile>)[profileId];
  if (profile === undefined)
    fail(
      "VES_SELFTEST_UNKNOWN_PROFILE",
      `unknown self-test profile "${profileId}"; the closed registry declares: ${Object.keys(PROFILES).join(", ")}`
    );
  return profile;
}

// Facts about one filesystem root, produced by the adapter. Paths arrive
// normalized to forward slashes with no trailing separator; the rule treats
// them as opaque ordered segments and never touches the filesystem.
export interface RootFacts {
  readonly canonicalPath: string;
  readonly realPath: string;
  readonly deviceId: string;
  readonly inodeId: string;
  // Every path traversed while resolving links inside the root. An alias,
  // symlink, or junction that escapes shows up here even when the resolved
  // root path itself looks disjoint.
  readonly linkChain: readonly string[];
}

function assertRootFacts(facts: RootFacts, role: string): void {
  for (const field of ["canonicalPath", "realPath", "deviceId", "inodeId"] as const) {
    if (typeof facts[field] !== "string" || facts[field].length === 0)
      fail("VES_SELFTEST_ROOT_FACTS_INVALID", `${role} root facts are missing ${field}; overlap cannot be proven`);
  }
  if (!Array.isArray(facts.linkChain))
    fail("VES_SELFTEST_ROOT_FACTS_INVALID", `${role} root facts are missing linkChain; overlap cannot be proven`);
}

function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function pathsOverlap(a: string, b: string): boolean {
  return pathContains(a, b) || pathContains(b, a);
}

function overlapReason(candidate: RootFacts, guarded: RootFacts): string | null {
  if (candidate.deviceId === guarded.deviceId && candidate.inodeId === guarded.inodeId) return "device and inode";
  const candidatePaths = [candidate.canonicalPath, candidate.realPath, ...candidate.linkChain];
  const guardedPaths = [guarded.canonicalPath, guarded.realPath];
  for (const candidatePath of candidatePaths) {
    for (const guardedPath of guardedPaths) {
      if (pathsOverlap(candidatePath, guardedPath)) return `path ${candidatePath}`;
    }
  }
  return null;
}

// TST-01: an overlapping candidate fails closed, naming the guarded root and
// the fact that matched. The caller must not mutate an overlapping root in
// any way — not even to quarantine it — because overlap means it may be the
// production state this domain exists to protect.
export function assertDisjointRoot(candidate: RootFacts, guardedRoots: readonly RootFacts[]): void {
  assertRootFacts(candidate, "candidate");
  for (const guarded of guardedRoots) {
    assertRootFacts(guarded, "guarded");
    const reason = overlapReason(candidate, guarded);
    if (reason !== null)
      fail(
        "VES_SELFTEST_ROOT_OVERLAP",
        `candidate root ${candidate.canonicalPath} overlaps guarded root ${guarded.canonicalPath} via ${reason}`
      );
  }
}

// TST-02: production material is rejected with a distinct error, never merely
// avoided. The adapter reports what the subject was composed with; the rule
// refuses anything not explicitly test-only.
export interface MaterialFact {
  readonly materialId: string;
  readonly kind: "key" | "identity" | "policy" | "workspace" | "store" | "adapter";
  readonly testOnly: boolean;
}

export function assertTestOnlyMaterials(materials: readonly MaterialFact[]): void {
  const production = materials.filter((material) => material.testOnly !== true);
  if (production.length > 0)
    fail(
      "VES_SELFTEST_PRODUCTION_MATERIAL",
      `subject composition includes non-test material: ${production.map((material) => material.materialId).join(", ")}`
    );
}

// TST-04: the Sentinel Set hashed before execution must be byte-identical
// after it. The diff is a pure rule so a unit test can prove every verdict.
export interface SentinelFact {
  readonly sentinelId: string;
  readonly digest: string;
}

export interface SentinelDiff {
  readonly identical: boolean;
  readonly mutated: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

function sentinelMap(facts: readonly SentinelFact[], phase: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const fact of facts) {
    if (typeof fact.sentinelId !== "string" || fact.sentinelId.length === 0 || typeof fact.digest !== "string")
      fail("VES_SELFTEST_SENTINEL_FACTS_INVALID", `${phase} sentinel facts are malformed`);
    if (map.has(fact.sentinelId))
      fail("VES_SELFTEST_SENTINEL_FACTS_INVALID", `${phase} sentinel facts repeat ${fact.sentinelId}`);
    map.set(fact.sentinelId, fact.digest);
  }
  return map;
}

export function diffSentinels(before: readonly SentinelFact[], after: readonly SentinelFact[]): SentinelDiff {
  const beforeMap = sentinelMap(before, "before");
  const afterMap = sentinelMap(after, "after");
  const mutated: string[] = [];
  const removed: string[] = [];
  for (const [sentinelId, digest] of beforeMap) {
    if (!afterMap.has(sentinelId)) removed.push(sentinelId);
    else if (afterMap.get(sentinelId) !== digest) mutated.push(sentinelId);
  }
  const added = [...afterMap.keys()].filter((sentinelId) => !beforeMap.has(sentinelId));
  return Object.freeze({
    identical: mutated.length === 0 && added.length === 0 && removed.length === 0,
    mutated: Object.freeze(mutated.sort()),
    added: Object.freeze(added.sort()),
    removed: Object.freeze(removed.sort())
  });
}

// TST-05: a temporary root leaves the run through an explicit state machine —
// proven removed, or quarantined — never a silent leak. Invalid transitions
// fail closed with both states named.
export type QuarantineState = "provisioned" | "in-use" | "cleanup-pending" | "removed" | "quarantined";

const QUARANTINE_TRANSITIONS: Readonly<Record<QuarantineState, readonly QuarantineState[]>> = Object.freeze({
  provisioned: Object.freeze(["in-use", "cleanup-pending"] as const),
  "in-use": Object.freeze(["cleanup-pending", "quarantined"] as const),
  "cleanup-pending": Object.freeze(["removed", "quarantined"] as const),
  removed: Object.freeze([] as const),
  quarantined: Object.freeze([] as const)
});

export class QuarantineMachine {
  #state: QuarantineState = "provisioned";

  get state(): QuarantineState {
    return this.#state;
  }

  transition(to: QuarantineState): void {
    if (!QUARANTINE_TRANSITIONS[this.#state].includes(to))
      fail("VES_SELFTEST_QUARANTINE_TRANSITION", `illegal root transition ${this.#state} -> ${to}`);
    this.#state = to;
  }
}

// TST-06: the report carries only the `self_test.*` fields the sealed
// support-bundle evidence contract already declares. Signing happens at the
// composition boundary (T4); this rule closes the shape.
export const SELF_TEST_REPORT_FIELDS = Object.freeze([
  "self_test.check_count",
  "self_test.duration_ms",
  "self_test.evidence_refs",
  "self_test.failure_codes",
  "self_test.profile",
  "self_test.redaction_count",
  "self_test.verdict"
] as const);

const PROHIBITED_FIELD_CLASS =
  /(?:source|prompt|context|credential|secret|environment|row|raw|transcript|log|database)/iu;
const REPORT_FIELD_SET: ReadonlySet<string> = new Set(SELF_TEST_REPORT_FIELDS);
const VERDICTS = Object.freeze(["PASS", "FAIL", "BLOCKED"] as const);

export type SelfTestVerdict = (typeof VERDICTS)[number];

export interface SelfTestReportPayload {
  readonly [field: string]: unknown;
}

function assertReportValues(payload: SelfTestReportPayload): void {
  const profile = payload["self_test.profile"];
  if (typeof profile !== "string" || !(profile in PROFILES))
    fail("VES_SELFTEST_REPORT_CONTENT_PROHIBITED", "report profile is not a registered self-test profile");
  const verdict = payload["self_test.verdict"];
  if (!VERDICTS.includes(verdict as SelfTestVerdict))
    fail("VES_SELFTEST_REPORT_CONTENT_PROHIBITED", "report verdict is outside PASS, FAIL, BLOCKED");
}

// String values are scanned against the same prohibited class as field names;
// registered VES_ codes are exempt because failure codes legitimately name
// the classes they guard against.
function assertNoProhibitedContent(payload: SelfTestReportPayload): void {
  for (const value of Object.values(payload)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === "string" && PROHIBITED_FIELD_CLASS.test(entry) && !entry.startsWith("VES_"))
        fail("VES_SELFTEST_REPORT_CONTENT_PROHIBITED", "report value matches a prohibited content class");
    }
  }
}

export function assertReportPayload(payload: SelfTestReportPayload): void {
  for (const field of Object.keys(payload)) {
    if (!REPORT_FIELD_SET.has(field))
      fail("VES_SELFTEST_REPORT_FIELD_UNKNOWN", `report field ${field} is outside the sealed self_test allowlist`);
  }
  for (const field of SELF_TEST_REPORT_FIELDS) {
    if (!Object.hasOwn(payload, field))
      fail("VES_SELFTEST_REPORT_FIELD_UNKNOWN", `report is missing required field ${field}`);
  }
  assertNoProhibitedContent(payload);
  assertReportValues(payload);
}

// Ports return facts, never verdicts. The subject port is how the composition
// root hands the orchestrator TEST-ONLY instances of the sibling adapters
// without this package importing any of them.
export interface SubjectRunFacts {
  readonly checkCount: number;
  readonly durationMs: number;
  readonly evidenceRefs: readonly string[];
  readonly failureCodes: readonly string[];
  readonly redactionCount: number;
}

export interface SelfTestPorts {
  // Roots the run must never touch: active workspaces, production state, the
  // repository itself. The adapter measures them; the rule guards them.
  guardedRoots(): Promise<readonly RootFacts[]>;
  roots: {
    provision(profileId: SelfTestProfileId): Promise<RootFacts>;
    // Cleanup reports facts: whether removal is proven and what residue
    // remains. The decision to quarantine is the orchestrator's.
    cleanup(root: RootFacts): Promise<{ readonly removed: boolean; readonly residue: readonly string[] }>;
    quarantine(root: RootFacts, reason: string): Promise<{ readonly quarantined: boolean }>;
  };
  sentinels: { capture(): Promise<readonly SentinelFact[]> };
  subject: {
    materials(profileId: SelfTestProfileId): Promise<readonly MaterialFact[]>;
    run(profileId: SelfTestProfileId, root: RootFacts): Promise<SubjectRunFacts>;
  };
}

export interface SelfTestRunResult {
  readonly payload: SelfTestReportPayload;
  readonly rootState: QuarantineState;
  readonly sentinelDiff: SentinelDiff;
}

export class SelfTestOrchestrator {
  readonly #ports: SelfTestPorts;

  constructor(ports: SelfTestPorts) {
    this.#ports = ports;
  }

  async run(profileId: string): Promise<SelfTestRunResult> {
    const profile = resolveSelfTestProfile(profileId);
    const guarded = await this.#ports.guardedRoots();
    const root = await this.#ports.roots.provision(profile.profileId);
    // Overlap fails before any mutation of the candidate: an overlapping root
    // may BE production, so neither cleanup nor a quarantine marker may touch
    // it. The machine never leaves "provisioned" on this path.
    assertDisjointRoot(root, guarded);
    const machine = new QuarantineMachine();
    assertTestOnlyMaterials(await this.#ports.subject.materials(profile.profileId));
    const before = await this.#ports.sentinels.capture();
    machine.transition("in-use");
    const runFacts = await this.#ports.subject.run(profile.profileId, root);
    const diff = diffSentinels(before, await this.#ports.sentinels.capture());
    if (!diff.identical) {
      await this.#quarantine(
        machine,
        root,
        `sentinel mutation: ${[...diff.mutated, ...diff.added, ...diff.removed].join(", ")}`
      );
      fail(
        "VES_SELFTEST_SENTINEL_MUTATION",
        `active-state sentinels changed during the run (mutated: ${diff.mutated.join(", ") || "none"}; added: ${diff.added.join(", ") || "none"}; removed: ${diff.removed.join(", ") || "none"})`
      );
    }
    machine.transition("cleanup-pending");
    const cleanup = await this.#ports.roots.cleanup(root);
    if (cleanup.removed) machine.transition("removed");
    else await this.#quarantine(machine, root, `cleanup left residue: ${cleanup.residue.join(", ") || "unknown"}`);
    const payload = buildReportPayload(profile.profileId, runFacts);
    assertReportPayload(payload);
    return Object.freeze({ payload, rootState: machine.state, sentinelDiff: diff });
  }

  // Quarantine failing is itself a closed failure: a root that is neither
  // proven removed nor proven quarantined is exactly the silent leak TST-05
  // prohibits.
  async #quarantine(machine: QuarantineMachine, root: RootFacts, reason: string): Promise<void> {
    machine.transition("quarantined");
    const outcome = await this.#ports.roots.quarantine(root, reason);
    if (!outcome.quarantined)
      fail("VES_SELFTEST_QUARANTINE_FAILED", `root ${root.canonicalPath} could not be quarantined: ${reason}`);
  }
}

function buildReportPayload(profileId: SelfTestProfileId, facts: SubjectRunFacts): SelfTestReportPayload {
  return Object.freeze({
    "self_test.check_count": facts.checkCount,
    "self_test.duration_ms": facts.durationMs,
    "self_test.evidence_refs": facts.evidenceRefs,
    "self_test.failure_codes": facts.failureCodes,
    "self_test.profile": profileId,
    "self_test.redaction_count": facts.redactionCount,
    "self_test.verdict": facts.failureCodes.length === 0 ? "PASS" : "FAIL"
  });
}
