// Deep-doctor diagnostic rules (T72, #13). Like the Self-Test trust domain
// (AD-010), every verdict lives here so it is unit-testable without a
// filesystem, a clock, or a socket. Read-only adapters supply DoctorCheckFacts;
// this module decides the report, and only registered codes may appear in it so
// a raw error, secret, or path can never reach the sealed diagnostic.

import { normalizeDeclaredSet } from "@verchestra/domain";

export type DoctorErrorCode =
  | "VES_DOCTOR_CHECK_CATALOG_INVALID"
  | "VES_DOCTOR_CHECK_FACT_INVALID"
  | "VES_DOCTOR_REMEDIATION_MISSING"
  | "VES_DOCTOR_REMEDIATION_UNKNOWN"
  | "VES_DOCTOR_REPORT_FIELD_UNKNOWN"
  | "VES_DOCTOR_REPORT_CONTENT_PROHIBITED"
  | "VES_DOCTOR_SENTINEL_MUTATION";

export class DoctorError extends Error {
  readonly code: DoctorErrorCode;

  constructor(code: DoctorErrorCode, message: string) {
    super(message);
    this.name = "DoctorError";
    this.code = code;
  }
}

function fail(code: DoctorErrorCode, message: string): never {
  throw new DoctorError(code, message);
}

// The closed catalog of deep-doctor checks. A read-only observer must produce
// exactly one fact per id; the report is sealed against this set so an added or
// missing subsystem is visible in review, not silently absorbed.
export const DOCTOR_CHECK_IDS = Object.freeze([
  "doctor.installation",
  "doctor.contract-schema",
  "doctor.cedar-policy",
  "doctor.sqlite-durable-state",
  "doctor.native-asset",
  "doctor.git",
  "doctor.secret-presence",
  "doctor.clock",
  "doctor.driver",
  "doctor.connector",
  "doctor.probe",
  "doctor.sandbox"
] as const);

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

export type DoctorCheckStatus = "pass" | "fail" | "blocked";

// The capability each check gates. A blocked or failing check names its
// capability so the operator learns exactly what cannot run, never why in raw
// prose.
export const DOCTOR_CAPABILITY_IDS = Object.freeze({
  "doctor.installation": "cli.installed",
  "doctor.contract-schema": "contracts.valid",
  "doctor.cedar-policy": "policy.enforceable",
  "doctor.sqlite-durable-state": "state.durable",
  "doctor.native-asset": "distribution.hermetic",
  "doctor.git": "workspace.git",
  "doctor.secret-presence": "secrets.available",
  "doctor.clock": "clock.monotonic",
  "doctor.driver": "drivers.available",
  "doctor.connector": "connectors.available",
  "doctor.probe": "probes.available",
  "doctor.sandbox": "sandbox.enforced"
} as const satisfies Readonly<Record<DoctorCheckId, string>>);

// The closed remediation registry. A non-passing check must carry one of these
// stable codes; free-text remediation is exactly the raw-error channel the
// redaction rule exists to close (DOC-03).
export const DOCTOR_REMEDIATION_CODES = Object.freeze([
  "reinstall-cli",
  "regenerate-contracts",
  "provision-policy-bundle",
  "initialize-runtime-store",
  "restore-native-asset",
  "install-git",
  "configure-secret",
  "correct-system-clock",
  "install-driver",
  "configure-connector",
  "provision-probe-fixture",
  "enable-sandbox"
] as const);

export type DoctorRemediationCode = (typeof DOCTOR_REMEDIATION_CODES)[number];

const CAPABILITY = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u;
const REMEDIATION_SET: ReadonlySet<string> = new Set(DOCTOR_REMEDIATION_CODES);
const CHECK_SET: ReadonlySet<string> = new Set(DOCTOR_CHECK_IDS);

export interface DoctorCheckFact {
  readonly checkId: string;
  readonly status: DoctorCheckStatus;
  readonly capabilityId: string;
  // Required when status is not "pass"; a registered code, never raw prose.
  readonly remediationCode?: string;
}

const STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "blocked"]);

function assertFactShape(fact: DoctorCheckFact): void {
  if (fact === null || typeof fact !== "object")
    fail("VES_DOCTOR_CHECK_FACT_INVALID", "doctor check fact is malformed");
  if (!CHECK_SET.has(fact.checkId))
    fail("VES_DOCTOR_CHECK_CATALOG_INVALID", `unknown doctor check id: ${String(fact.checkId)}`);
  if (!STATUSES.has(fact.status))
    fail("VES_DOCTOR_CHECK_FACT_INVALID", `doctor check ${fact.checkId} has an invalid status`);
  const expectedCapability = DOCTOR_CAPABILITY_IDS[fact.checkId as DoctorCheckId];
  if (fact.capabilityId !== expectedCapability || !CAPABILITY.test(fact.capabilityId))
    fail("VES_DOCTOR_CHECK_FACT_INVALID", `doctor check ${fact.checkId} reports the wrong capability`);
}

function assertFactRemediation(fact: DoctorCheckFact): void {
  if (fact.status === "pass") {
    if (fact.remediationCode !== undefined)
      fail("VES_DOCTOR_CHECK_FACT_INVALID", `passing doctor check ${fact.checkId} must not carry a remediation`);
    return;
  }
  if (fact.remediationCode === undefined)
    fail("VES_DOCTOR_REMEDIATION_MISSING", `doctor check ${fact.checkId} is ${fact.status} without a remediation code`);
  if (!REMEDIATION_SET.has(fact.remediationCode))
    fail("VES_DOCTOR_REMEDIATION_UNKNOWN", `doctor check ${fact.checkId} names an unregistered remediation`);
}

function assertOneFact(fact: DoctorCheckFact): void {
  assertFactShape(fact);
  assertFactRemediation(fact);
}

// DOC-02: the report requires exactly the registered catalog — every id once,
// none unknown, none duplicated — so partial coverage cannot read as health.
export function assertDoctorCheckFacts(facts: readonly DoctorCheckFact[]): void {
  if (!Array.isArray(facts)) fail("VES_DOCTOR_CHECK_CATALOG_INVALID", "doctor facts are not a list");
  const seen = new Set<string>();
  for (const fact of facts) {
    assertOneFact(fact);
    if (seen.has(fact.checkId)) fail("VES_DOCTOR_CHECK_CATALOG_INVALID", `duplicate doctor check ${fact.checkId}`);
    seen.add(fact.checkId);
  }
  const missing = DOCTOR_CHECK_IDS.filter((checkId) => !seen.has(checkId));
  if (missing.length > 0) fail("VES_DOCTOR_CHECK_CATALOG_INVALID", `doctor catalog is missing: ${missing.join(", ")}`);
}

export type DoctorVerdict = "PASS" | "FAIL" | "BLOCKED";

// The report is JSON by contract; its values are scalars and scalar lists so
// the evidence boundary can seal it.
export type DoctorReportValue = string | number | readonly string[];

export interface DoctorReportPayload {
  readonly [field: string]: DoctorReportValue;
}

export const DOCTOR_REPORT_FIELDS = Object.freeze([
  "doctor.verdict",
  "doctor.check_codes",
  "doctor.failure_codes",
  "doctor.blocked_capabilities",
  "doctor.remediation_codes",
  "doctor.duration_ms"
] as const);

const REPORT_FIELD_SET: ReadonlySet<string> = new Set(DOCTOR_REPORT_FIELDS);
const VERDICTS: ReadonlySet<string> = new Set(["PASS", "FAIL", "BLOCKED"]);
// Positive vocabularies: every string the report can carry is drawn from a
// closed registry, so a value outside these sets — a path, a secret, a database
// blob — cannot appear by construction. A positive allowlist is stronger than
// scanning for forbidden words, and it does not false-positive on a legitimate
// registered id such as "doctor.secret-presence".
const VALID_CHECK_CODES: ReadonlySet<string> = new Set(
  DOCTOR_CHECK_IDS.flatMap((checkId) => ["pass", "fail", "blocked"].map((status) => `${checkId}:${status}`))
);
const VALID_CAPABILITIES: ReadonlySet<string> = new Set(Object.values(DOCTOR_CAPABILITY_IDS));

// CJ4-05: the sealed doctor report's code lists are declared sets, ordered by
// code unit rather than ambient locale.
function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze(normalizeDeclaredSet([...new Set(values)], (value) => value));
}

// DOC-05: the single closed payload both renderers project. Fail dominates
// blocked, so a machine that is both unhealthy and under-provisioned reports the
// stronger signal.
export function buildDoctorReport(facts: readonly DoctorCheckFact[], durationMs: number): DoctorReportPayload {
  assertDoctorCheckFacts(facts);
  if (!Number.isSafeInteger(durationMs) || durationMs < 0)
    fail("VES_DOCTOR_CHECK_FACT_INVALID", "doctor duration is invalid");
  const failed = facts.filter((fact) => fact.status === "fail");
  const blocked = facts.filter((fact) => fact.status === "blocked");
  const verdict: DoctorVerdict = failed.length > 0 ? "FAIL" : blocked.length > 0 ? "BLOCKED" : "PASS";
  const payload: DoctorReportPayload = Object.freeze({
    "doctor.verdict": verdict,
    "doctor.check_codes": sortedUnique(facts.map((fact) => `${fact.checkId}:${fact.status}`)),
    "doctor.failure_codes": sortedUnique(failed.map((fact) => fact.remediationCode as string)),
    "doctor.blocked_capabilities": sortedUnique(blocked.map((fact) => fact.capabilityId)),
    "doctor.remediation_codes": sortedUnique([...failed, ...blocked].map((fact) => fact.remediationCode as string)),
    "doctor.duration_ms": durationMs
  });
  assertDoctorReportPayload(payload);
  return payload;
}

// DOC-06 (rule half): the sealed payload carries only registered fields and no
// prohibited content; the composition redacts, this refuses to seal a leak.
export function assertDoctorReportPayload(payload: DoctorReportPayload): void {
  for (const field of Object.keys(payload))
    if (!REPORT_FIELD_SET.has(field))
      fail("VES_DOCTOR_REPORT_FIELD_UNKNOWN", `report field ${field} is outside the doctor allowlist`);
  for (const field of DOCTOR_REPORT_FIELDS)
    if (!Object.hasOwn(payload, field))
      fail("VES_DOCTOR_REPORT_FIELD_UNKNOWN", `report is missing required field ${field}`);
  if (!VERDICTS.has(payload["doctor.verdict"] as string))
    fail("VES_DOCTOR_REPORT_CONTENT_PROHIBITED", "report verdict is outside PASS, FAIL, BLOCKED");
  const inSet = (values: DoctorReportValue | undefined, allowed: ReadonlySet<string>, label: string): void => {
    if (!Array.isArray(values)) fail("VES_DOCTOR_REPORT_CONTENT_PROHIBITED", `${label} must be a list`);
    for (const entry of values)
      if (typeof entry !== "string" || !allowed.has(entry))
        fail("VES_DOCTOR_REPORT_CONTENT_PROHIBITED", `${label} carry an unregistered value`);
  };
  inSet(payload["doctor.check_codes"], VALID_CHECK_CODES, "check codes");
  inSet(payload["doctor.failure_codes"], REMEDIATION_SET, "failure codes");
  inSet(payload["doctor.remediation_codes"], REMEDIATION_SET, "remediation codes");
  inSet(payload["doctor.blocked_capabilities"], VALID_CAPABILITIES, "blocked capabilities");
  const duration = payload["doctor.duration_ms"];
  if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 0)
    fail("VES_DOCTOR_REPORT_CONTENT_PROHIBITED", "duration is invalid");
}

// DOC-05: stable exit semantics. PASS is 0; a blocked machine and an unhealthy
// machine get distinct non-zero codes so a caller can branch on the difference.
export function doctorExitCode(verdict: DoctorVerdict): 0 | 1 | 4 {
  if (verdict === "PASS") return 0;
  return verdict === "FAIL" ? 1 : 4;
}
